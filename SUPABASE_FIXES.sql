-- ════════════════════════════════════════════════════════════════
--  FUE Quiz — Database Fixes
--  Run this ONCE in: Supabase Dashboard → SQL Editor → Run
--  All statements are idempotent (safe to re-run).
-- ════════════════════════════════════════════════════════════════

-- ─── 1. ADD MISSING COLUMNS ──────────────────────────────────────
-- These were added to the schema but may be missing in existing DBs.

ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS bg TEXT;

ALTER TABLE public.answers
  ADD COLUMN IF NOT EXISTS response_time_s INT;

-- ─── 2. mark_code_used RPC ───────────────────────────────────────
-- Participants (anon) cannot directly UPDATE participant_codes because
-- the only UPDATE policy requires admin role. This SECURITY DEFINER
-- function bypasses RLS so anon participants can mark their own code
-- as used when they join the lobby.

DROP FUNCTION IF EXISTS public.mark_code_used(TEXT, UUID);
CREATE OR REPLACE FUNCTION public.mark_code_used(p_code TEXT, p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.participant_codes
  SET used = true, session_id = p_session_id
  WHERE code = p_code AND used = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_code_used(TEXT, UUID) TO anon, authenticated;

-- ─── 3. ANSWERS — grant anon INSERT + fix upsert ─────────────────
-- Ensure anon can INSERT answers (upsert requires INSERT grant).
GRANT INSERT ON public.answers TO anon;

-- ─── 4. FIX violations TABLE ─────────────────────────────────────
-- Old INSERT policy blocked anon when used=false (circular with mark_code_used).
-- Simplify: any code that exists in participant_codes can insert a violation.

DROP POLICY IF EXISTS "violations_anon_insert" ON public.violations;
CREATE POLICY "violations_anon_insert" ON public.violations FOR INSERT
  WITH CHECK (participant_code IN (SELECT code FROM public.participant_codes));

-- Grant anon INSERT (was missing entirely).
GRANT INSERT ON public.violations TO anon;

-- ─── 5. ADD violations TO REALTIME PUBLICATION ───────────────────
-- Admin panel subscribes to violations in real time; table must be published.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'violations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.violations;
  END IF;
END $$;

-- Ensure quiz_sessions and participant_codes are also published (idempotent guard).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'quiz_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_sessions;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'participant_codes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.participant_codes;
  END IF;
END $$;

-- ─── 6. ENSURE ALL REQUIRED GRANTS ──────────────────────────────
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT ON public.quiz_sessions TO anon;
GRANT SELECT ON public.participant_codes TO anon;
GRANT SELECT ON public.questions TO anon;
GRANT SELECT ON public.modules TO anon;
GRANT INSERT ON public.answers TO anon;
GRANT INSERT ON public.violations TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_results(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.advance_session_question(UUID, INT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_quiz_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_code_used(TEXT, UUID) TO anon, authenticated;

-- ─── 7. ENSURE UNIQUE CONSTRAINT ON answers ──────────────────────
-- Required for upsert (onConflict). Skip if already exists.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'answers_session_id_participant_code_question_id_key'
      AND conrelid = 'public.answers'::regclass
  ) THEN
    ALTER TABLE public.answers
      ADD CONSTRAINT answers_session_id_participant_code_question_id_key
      UNIQUE (session_id, participant_code, question_id);
  END IF;
END $$;

-- ─── 8. bg_mobile COLUMN ─────────────────────────────────────────
-- Separate background for mobile participants (phones).
-- Falls back to bg (desktop) when not set.

ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS bg_mobile TEXT;

-- ─── 9. get_live_answer_count RPC ────────────────────────────────
-- LiveView runs as anon; answers_admin_select blocks SELECT for anon.
-- This SECURITY DEFINER function returns only the count — no row data exposed.

DROP FUNCTION IF EXISTS public.get_live_answer_count(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_live_answer_count(p_session_id UUID, p_question_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT FROM public.answers
  WHERE session_id = p_session_id AND question_id = p_question_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_live_answer_count(UUID, UUID) TO anon, authenticated;

-- ─── 10. STORAGE — backgrounds bucket ───────────────────────────
-- Create the bucket (public so URLs work without signed tokens).
-- ON CONFLICT DO NOTHING is safe to re-run.

INSERT INTO storage.buckets (id, name, public)
VALUES ('backgrounds', 'backgrounds', true)
ON CONFLICT (id) DO NOTHING;

-- Drop any stale policies then recreate them cleanly.
DROP POLICY IF EXISTS "backgrounds_public_read" ON storage.objects;
DROP POLICY IF EXISTS "backgrounds_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "backgrounds_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "backgrounds_auth_delete" ON storage.objects;

CREATE POLICY "backgrounds_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'backgrounds');

CREATE POLICY "backgrounds_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'backgrounds');

CREATE POLICY "backgrounds_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'backgrounds');

CREATE POLICY "backgrounds_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'backgrounds');

-- ─── 11. pause_elapsed_s COLUMN ─────────────────────────────────
-- Stores seconds elapsed when admin pauses mid-question.
-- On resume the admin back-dates q_started_at by this amount so
-- participants see remaining time (not full time) after resuming.

ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS pause_elapsed_s INT;

-- ─── 12. get_admin_question_stats RPC ───────────────────────────
-- Admin panel polls this for live correct/total count + full answer list.
-- SECURITY DEFINER bypasses answers_admin_select RLS — works even if the
-- admin's JWT has unusual claims or the RLS policy evaluates unexpectedly.

DROP FUNCTION IF EXISTS public.get_admin_question_stats(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_admin_question_stats(p_session_id UUID, p_question_id UUID)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total',    COUNT(*)::INT,
    'correct',  COUNT(*) FILTER (WHERE is_correct = true)::INT,
    'avg_time', COALESCE(ROUND(AVG(response_time_s))::INT, 0),
    'answers',  COALESCE(
      json_agg(
        json_build_object(
          'code',         participant_code,
          'name',         participant_name,
          'isCorrect',    is_correct,
          'points',       points,
          'responseTime', response_time_s
        ) ORDER BY answered_at
      ),
      '[]'::json
    )
  )
  FROM public.answers
  WHERE session_id = p_session_id AND question_id = p_question_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_question_stats(UUID, UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════════
--  Done. Verify by checking that no errors appeared above.
-- ════════════════════════════════════════════════════════════════
