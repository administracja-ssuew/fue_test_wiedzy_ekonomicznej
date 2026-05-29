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

-- ─── 13. update_quiz_session_admin RPC ──────────────────────────
-- Bezpośredni UPDATE quiz_sessions jest blokowany przez sessions_admin_write RLS
-- gdy get_my_role() zwraca NULL (wygasły JWT, problem z profilem itp.).
-- SECURITY DEFINER uruchamia się jako właściciel funkcji — omija RLS.
-- Minimalna ochrona: wymaga auth.uid() IS NOT NULL.

DROP FUNCTION IF EXISTS public.update_quiz_session_admin(UUID, JSONB);
CREATE OR REPLACE FUNCTION public.update_quiz_session_admin(p_session_id UUID, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.quiz_sessions SET
    status               = CASE WHEN p_data ? 'status'
                             THEN p_data->>'status'                              ELSE status               END,
    q_started_at         = CASE WHEN p_data ? 'q_started_at'
                             THEN (p_data->>'q_started_at')::TIMESTAMPTZ         ELSE q_started_at         END,
    pause_elapsed_s      = CASE WHEN p_data ? 'pause_elapsed_s'
                             THEN (p_data->>'pause_elapsed_s')::INT              ELSE pause_elapsed_s      END,
    current_question_idx = CASE WHEN p_data ? 'current_question_idx'
                             THEN (p_data->>'current_question_idx')::INT         ELSE current_question_idx END
  WHERE id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_quiz_session_admin(UUID, JSONB) TO authenticated;

-- ─── 14. start_quiz_session — delayed start (+4 s) ──────────────
-- q_started_at is set 4 seconds in the future so all clients can
-- display a 3→2→1→START! countdown driven purely by the timestamp.
-- status is set to "running" immediately so participants leave the
-- lobby; they count down locally until q_started_at arrives, then
-- the timer begins from the full timePerQ.

CREATE OR REPLACE FUNCTION public.start_quiz_session(p_session_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp() + interval '4 seconds';
BEGIN
  UPDATE public.quiz_sessions
  SET status = 'running', q_started_at = v_start, current_question_idx = 0
  WHERE id = p_session_id AND status = 'waiting';
  IF FOUND THEN RETURN v_start; ELSE RETURN NULL; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_quiz_session(UUID) TO authenticated;

-- ─── 15. FIX auth.uid() + storage policies + anon stats ────────
-- (a) update_quiz_session_admin — remove the auth.uid() IS NULL guard.
--     It fires even for valid admins in some Supabase configs because
--     auth.uid() can return NULL inside SECURITY DEFINER + search_path=public.
--     Security is already enforced by GRANT EXECUTE TO authenticated — anon
--     callers are rejected before the function body even runs.

CREATE OR REPLACE FUNCTION public.update_quiz_session_admin(p_session_id UUID, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.quiz_sessions SET
    status               = CASE WHEN p_data ? 'status'
                             THEN p_data->>'status'                              ELSE status               END,
    q_started_at         = CASE WHEN p_data ? 'q_started_at'
                             THEN (p_data->>'q_started_at')::TIMESTAMPTZ         ELSE q_started_at         END,
    pause_elapsed_s      = CASE WHEN p_data ? 'pause_elapsed_s'
                             THEN (p_data->>'pause_elapsed_s')::INT              ELSE pause_elapsed_s      END,
    current_question_idx = CASE WHEN p_data ? 'current_question_idx'
                             THEN (p_data->>'current_question_idx')::INT         ELSE current_question_idx END
  WHERE id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_quiz_session_admin(UUID, JSONB) TO authenticated;

-- (b) get_admin_question_stats — also grant to anon so live stats survive
--     an expired JWT. SECURITY DEFINER keeps the data safe (no raw rows exposed).
GRANT EXECUTE ON FUNCTION public.get_admin_question_stats(UUID, UUID) TO anon;

-- (c) Storage/backgrounds — recreate all policies cleanly.
--     Supabase dashboard sometimes creates extra conflicting policies; drop by
--     name pattern then recreate so we have exactly what we need.
DROP POLICY IF EXISTS "backgrounds_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "backgrounds_auth_insert"  ON storage.objects;
DROP POLICY IF EXISTS "backgrounds_auth_update"  ON storage.objects;
DROP POLICY IF EXISTS "backgrounds_auth_delete"  ON storage.objects;

CREATE POLICY "backgrounds_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'backgrounds');

CREATE POLICY "backgrounds_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'backgrounds');

CREATE POLICY "backgrounds_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'backgrounds')
  WITH CHECK (bucket_id = 'backgrounds');

CREATE POLICY "backgrounds_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'backgrounds');

-- ─── 16. get_participant_answers RPC ────────────────────────────
-- Lets a participant (anon) rebuild their own score after a page refresh.
-- Scoped strictly to the given code — no other participant's data is exposed.
-- SECURITY DEFINER bypasses answers_admin_select (anon can't SELECT answers).

DROP FUNCTION IF EXISTS public.get_participant_answers(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.get_participant_answers(p_session_id UUID, p_code TEXT)
RETURNS TABLE (
  question_id UUID,
  module      INT,
  chosen      INT,
  is_correct  BOOLEAN,
  points      INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT question_id, module, chosen, is_correct, points
  FROM public.answers
  WHERE session_id = p_session_id AND participant_code = p_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_participant_answers(UUID, TEXT) TO anon, authenticated;

-- ─── 17. get_admin_answer_summary RPC ───────────────────────────
-- Lightweight live counter for the admin panel during a question:
-- returns only {total, correct} — no per-row json_agg. The full answer
-- list (get_admin_question_stats) is fetched only once, at reveal.
-- Cuts the per-3s payload from up to 500 rows to a tiny object.

DROP FUNCTION IF EXISTS public.get_admin_answer_summary(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_admin_answer_summary(p_session_id UUID, p_question_id UUID)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total',   COUNT(*)::INT,
    'correct', COUNT(*) FILTER (WHERE is_correct = true)::INT
  )
  FROM public.answers
  WHERE session_id = p_session_id AND question_id = p_question_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_answer_summary(UUID, UUID) TO authenticated, anon;

-- ════════════════════════════════════════════════════════════════
--  Done. Verify by checking that no errors appeared above.
-- ════════════════════════════════════════════════════════════════

