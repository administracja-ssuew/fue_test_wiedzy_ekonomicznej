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

-- ─── 18. EVENT LOG (telemetria) ─────────────────────────────────
-- Best-effort log of quiz lifecycle, admin actions and client errors.
-- Insert goes through a SECURITY DEFINER RPC (works for anon participants);
-- only admins can read the log.

CREATE TABLE IF NOT EXISTS public.event_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,
  session_id  UUID,
  city        TEXT,
  actor       TEXT,
  detail      JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_log_admin_select" ON public.event_log;
CREATE POLICY "event_log_admin_select" ON public.event_log FOR SELECT
  USING (get_my_role() IN ('city_admin', 'superadmin'));

CREATE INDEX IF NOT EXISTS idx_event_log_session ON public.event_log(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_type    ON public.event_log(type, created_at DESC);

DROP FUNCTION IF EXISTS public.log_event(TEXT, UUID, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.log_event(
  p_type TEXT, p_session_id UUID, p_city TEXT, p_actor TEXT, p_detail TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.event_log (type, session_id, city, actor, detail)
  VALUES (p_type, p_session_id, p_city, p_actor,
          CASE WHEN p_detail IS NULL THEN NULL ELSE p_detail::JSONB END);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_event(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ─── 19. SECURITY: restrict get_session_results to admins ───────
-- Only the admin panel calls this; revoking anon prevents a participant from
-- pulling the full ranking (names + points) mid-quiz with just a session_id.

REVOKE EXECUTE ON FUNCTION public.get_session_results(UUID) FROM anon;

-- ─── 20. SECURITY: city ownership check in session update ───────
-- A city_admin may only modify sessions for their own city; superadmin = all.
-- IMPORTANT: the check is best-effort. If get_my_role() can't resolve the caller
-- (auth.uid() edge cases inside SECURITY DEFINER) we DO NOT block — we fall back
-- to the previous permissive behaviour so pause/end can never silently break.
-- We only ever reject when we positively know it's a city_admin acting on another
-- city. Access to the RPC is still gated by GRANT ... TO authenticated (no anon).

CREATE OR REPLACE FUNCTION public.update_quiz_session_admin(p_session_id UUID, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := get_my_role();
  v_city TEXT := get_my_city();
  v_session_city TEXT;
BEGIN
  IF v_role = 'city_admin' THEN
    SELECT city INTO v_session_city FROM public.quiz_sessions WHERE id = p_session_id;
    IF v_session_city IS DISTINCT FROM v_city THEN
      RAISE EXCEPTION 'Not authorized for this city';
    END IF;
  END IF;
  -- v_role NULL or 'superadmin' → proceed (NULL = permissive fallback, no breakage).
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

-- ─── 21. REALTIME na tabeli answers (instant push licznika) ─────
-- Dodaje answers do publikacji Realtime, by panel admina dostawał INSERT-y
-- natychmiast (push <100ms) zamiast pollingu. RLS answers_admin_select sprawia,
-- że eventy widzi WYŁĄCZNIE admin — anon (uczestnicy/LiveView) ich nie otrzyma,
-- więc żadnych danych odpowiedzi nie wyciekamy.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'answers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.answers;
  END IF;
END $$;

-- ─── 22. advance_session_question — odliczanie między pytaniami ──
-- Start następnego pytania ustawiamy 4 s w przyszłość (jak start_quiz_session),
-- żeby WSZYSTKIE ekrany (uczestnik, LiveView, panel) pokazały to samo odliczanie
-- 3→2→1→START liczone z jednego serwerowego q_started_at — pełna synchronizacja.
-- Timer pytania rusza dopiero po odliczaniu (klienci liczą remaining z q_started_at).

CREATE OR REPLACE FUNCTION public.advance_session_question(
  p_session_id    UUID,
  p_expected_idx  INT,
  p_next_idx      INT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp() + interval '4 seconds';
BEGIN
  UPDATE public.quiz_sessions
  SET current_question_idx = p_next_idx, q_started_at = v_start, status = 'running'
  WHERE id = p_session_id
    AND current_question_idx = p_expected_idx
    AND status = 'running';
  IF FOUND THEN RETURN v_start; ELSE RETURN NULL; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_session_question(UUID, INT, INT) TO anon, authenticated;

-- ─── 23. HARDENING grantów EXECUTE (domyślny PUBLIC) ────────────
-- PostgreSQL przy CREATE FUNCTION domyślnie nadaje EXECUTE roli PUBLIC (więc też
-- anon). Dlatego samo "GRANT TO authenticated" NIE blokuje anona, a "REVOKE FROM
-- anon" nie działa, gdy dostęp idzie przez PUBLIC. Tu jawnie odbieramy PUBLIC+anon
-- z funkcji administracyjnych i zostawiamy anon tylko tam, gdzie jest potrzebny.
-- (Uruchom na produkcji ORAZ na stagingu.)

-- Tylko admin (uczestnik/anon NIE może):
REVOKE EXECUTE ON FUNCTION public.update_quiz_session_admin(UUID, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_quiz_session_admin(UUID, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.start_quiz_session(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_quiz_session(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_session_results(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_session_results(UUID) TO authenticated;

-- Pełne statystyki per-uczestnik (kody, nazwiska, poprawność) — tylko admin.
-- Publiczny LiveView (anon) używa get_admin_answer_summary (same liczby).
REVOKE EXECUTE ON FUNCTION public.get_admin_question_stats(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_question_stats(UUID, UUID) TO authenticated;

-- Celowo dostępne dla anon (uczestnicy / publiczny LiveView):
GRANT EXECUTE ON FUNCTION public.mark_code_used(TEXT, UUID)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_session_question(UUID, INT, INT)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_answer_count(UUID, UUID)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_answer_summary(UUID, UUID)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_participant_answers(UUID, TEXT)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_event(TEXT, UUID, TEXT, TEXT, TEXT)    TO anon, authenticated;

-- ─── 24. mark_code_used — pozwól na re-join do nowej sesji ──────
-- Usuwamy warunek "AND used = false". Po resecie/nowej sesji uczestnik wracający
-- na ten sam kod MUSI zaktualizować session_id — inaczej getParticipantsInSession
-- go nie liczy (licznik uczestników = 0 mimo odpowiadania → "1/0" na przycisku
-- Następne i zablokowanie). Idempotentne, bezpieczne do wielokrotnego uruchomienia.

CREATE OR REPLACE FUNCTION public.mark_code_used(p_code TEXT, p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.participant_codes
  SET used = true, session_id = p_session_id
  WHERE code = p_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_code_used(TEXT, UUID) TO anon, authenticated;

-- ─── 25. get_session_results — ranking wg POPRAWNYCH odpowiedzi ──
-- Bez punktów: kolejność wg liczby poprawnych odpowiedzi, remis → krótszy
-- średni czas. Zmienia typ zwracany, więc DROP + CREATE; grant tylko authenticated
-- (jak w sekcji 23 — anon nie widzi pełnego rankingu).

DROP FUNCTION IF EXISTS public.get_session_results(UUID);
CREATE OR REPLACE FUNCTION public.get_session_results(p_session_id UUID)
RETURNS TABLE (
  participant_code    TEXT,
  participant_name    TEXT,
  city                TEXT,
  correct_count       BIGINT,
  total_count         BIGINT,
  avg_response_time_s INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    participant_code,
    participant_name,
    city,
    COUNT(*) FILTER (WHERE is_correct = true)::BIGINT AS correct_count,
    COUNT(*)::BIGINT AS total_count,
    ROUND(AVG(response_time_s))::INT AS avg_response_time_s
  FROM public.answers
  WHERE session_id = p_session_id
  GROUP BY participant_code, participant_name, city
  ORDER BY correct_count DESC, avg_response_time_s ASC NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION public.get_session_results(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_session_results(UUID) TO authenticated;

-- ─── 26. Zapowiedź modułu 30s (lead konfigurowalny) ─────────────
-- advance_session_question dostaje p_lead_seconds (domyślnie 4 = zwykłe
-- odliczanie 3-2-1). Dla PIERWSZEGO pytania modułu klient podaje 30 → wszyscy
-- (uczestnik + Live View) widzą 30s zapowiedź modułu liczoną z q_started_at.
-- start_quiz_session (MODUŁ 1) używa 10s — krótszy start; moduły 2–5 = 30s.

DROP FUNCTION IF EXISTS public.advance_session_question(UUID, INT, INT);
DROP FUNCTION IF EXISTS public.advance_session_question(UUID, INT, INT, INT);
CREATE OR REPLACE FUNCTION public.advance_session_question(
  p_session_id   UUID,
  p_expected_idx INT,
  p_next_idx     INT,
  p_lead_seconds INT DEFAULT 4
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp() + (GREATEST(p_lead_seconds, 0) || ' seconds')::interval;
BEGIN
  UPDATE public.quiz_sessions
  SET current_question_idx = p_next_idx, q_started_at = v_start, status = 'running'
  WHERE id = p_session_id
    AND current_question_idx = p_expected_idx
    AND status = 'running';
  IF FOUND THEN RETURN v_start; ELSE RETURN NULL; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.advance_session_question(UUID, INT, INT, INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_quiz_session(p_session_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp() + interval '10 seconds';  -- zapowiedź modułu 1
BEGIN
  UPDATE public.quiz_sessions
  SET status = 'running', q_started_at = v_start, current_question_idx = 0
  WHERE id = p_session_id AND status = 'waiting';
  IF FOUND THEN RETURN v_start; ELSE RETURN NULL; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_quiz_session(UUID) TO authenticated;

-- ─── 27. HARDENING — anon NIE czyta całej tabeli participant_codes ──
-- Problem (luka): "codes_public_read USING(true)" + GRANT SELECT ... TO anon
-- pozwala anonimowi pobrać WSZYSTKIE kody i nazwiska wszystkich uczestników.
-- Zamykamy to bez psucia dołączania do quizu:
--   27.1 walidacja kodu      → RPC (definer) zwraca tylko WŁASNY wiersz
--   27.2 code_exists()       → helper (definer) dla polityki INSERT violations,
--                              bo "IN (SELECT code FROM participant_codes)" przestaje
--                              działać dla anon po odebraniu SELECT
--   27.3 licznik uczestników → RPC (definer) zwraca tylko LICZBĘ (Live View X/N)
--   27.4 REVOKE anon SELECT + polityka read tylko dla authenticated (admin)
-- UWAGA: answers_public_insert ma WITH CHECK (true) — NIE zależy od kodów,
-- więc zapis odpowiedzi działa bez zmian.

-- 27.1 — walidacja pojedynczego kodu (anon wpisuje własny kod)
DROP FUNCTION IF EXISTS public.validate_participant_code(TEXT);
CREATE OR REPLACE FUNCTION public.validate_participant_code(p_code TEXT)
RETURNS TABLE (id UUID, code TEXT, name TEXT, surname TEXT, city TEXT, used BOOLEAN, session_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, code, name, surname, city, used, session_id
  FROM public.participant_codes
  WHERE code = upper(btrim(p_code))
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_participant_code(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.validate_participant_code(TEXT) TO anon, authenticated;

-- 27.2 — helper istnienia kodu (definer) dla polityk INSERT
DROP FUNCTION IF EXISTS public.code_exists(TEXT);
CREATE OR REPLACE FUNCTION public.code_exists(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.participant_codes WHERE code = p_code);
$$;
REVOKE EXECUTE ON FUNCTION public.code_exists(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.code_exists(TEXT) TO anon, authenticated;

-- przepnij politykę INSERT violations na helper (nie zależy już od SELECT na tabeli)
DROP POLICY IF EXISTS "violations_anon_insert" ON public.violations;
CREATE POLICY "violations_anon_insert" ON public.violations FOR INSERT
  WITH CHECK (public.code_exists(participant_code));

-- 27.3 — licznik uczestników w sesji (anon Live View) → tylko liczba
DROP FUNCTION IF EXISTS public.count_participants_in_session(TEXT, UUID);
CREATE OR REPLACE FUNCTION public.count_participants_in_session(p_city TEXT, p_session_id UUID)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::INT FROM public.participant_codes
  WHERE city = p_city AND used = true
    AND (p_session_id IS NULL OR session_id = p_session_id);
$$;
REVOKE EXECUTE ON FUNCTION public.count_participants_in_session(TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.count_participants_in_session(TEXT, UUID) TO anon, authenticated;

-- 27.4 — odbierz anon bezpośredni SELECT i zawęź odczyt do authenticated (admin)
REVOKE SELECT ON public.participant_codes FROM anon;
DROP POLICY IF EXISTS "codes_public_read" ON public.participant_codes;
CREATE POLICY "codes_authenticated_read" ON public.participant_codes FOR SELECT
  TO authenticated USING (true);

-- ─── 28. server_now() — wspólny zegar serwera (sync co do sekundy) ──
-- Każdy klient (uczestnik, Live View, admin) liczy pozostały czas z
-- q_started_at MINUS "teraz". Problem: "teraz" to lokalny zegar urządzenia,
-- a telefony bywają rozjechane o kilka sekund → różne timery na ekranach.
-- Rozwiązanie: klient mierzy offset (serwer − lokalny) względem tej funkcji
-- i używa serverNow() = Date.now() + offset wszędzie. Zwraca epoch w ms.
-- VOLATILE + clock_timestamp() = faktyczny czas wywołania (nie start transakcji).

CREATE OR REPLACE FUNCTION public.server_now()
RETURNS BIGINT
LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
$$;
REVOKE EXECUTE ON FUNCTION public.server_now() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.server_now() TO anon, authenticated;

-- ─── 29. PEŁNA WALIDACJA SERWEROWA (integralność wyników + ukrycie ans) ──
-- Zamyka ustalenia audytu:
--   M-1: anon mógł wstawiać dowolne answers (WITH CHECK true) → manipulacja rankingu
--   M-2: poprawna odpowiedź (ans) szła do klienta → dało się zawsze odpowiadać dobrze
--   H-1: każdy 'authenticated' mógł wołać RPC admina (tylko auth.uid(), bez roli)
-- Po wgraniu zapis odpowiedzi idzie WYŁĄCZNIE przez submit_answer (liczy is_correct
-- serwerowo), a anon nie dostaje ans przy pobieraniu pytań.

-- 29.1 — get_quiz_questions: pytania do gry; ans TYLKO dla admina (anon → NULL)
DROP FUNCTION IF EXISTS public.get_quiz_questions(TEXT);
CREATE OR REPLACE FUNCTION public.get_quiz_questions(p_city TEXT)
RETURNS TABLE (id UUID, city TEXT, module INT, q TEXT, opts TEXT[], ans INT, exp TEXT, is_practice BOOLEAN, sort_order INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, city, module, q, opts,
         CASE WHEN public.get_my_role() IN ('city_admin','superadmin') THEN ans ELSE NULL END,
         exp, is_practice, sort_order
  FROM public.questions
  WHERE city = p_city AND is_practice = false
  ORDER BY module, sort_order, id;   -- id = tiebreaker (deterministyczna kolejność!)
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_questions(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_quiz_questions(TEXT) TO anon, authenticated;

-- 29.1b — get_practice_questions: tryb próbny (osobisty, bez rywalizacji) → ans OK.
DROP FUNCTION IF EXISTS public.get_practice_questions(TEXT);
CREATE OR REPLACE FUNCTION public.get_practice_questions(p_city TEXT)
RETURNS TABLE (id UUID, city TEXT, module INT, q TEXT, opts TEXT[], ans INT, exp TEXT, is_practice BOOLEAN, sort_order INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, city, module, q, opts, ans, exp, is_practice, sort_order
  FROM public.questions
  WHERE city = p_city AND is_practice = true
  ORDER BY module, sort_order, id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_practice_questions(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_practice_questions(TEXT) TO anon, authenticated;

-- 29.1c — odbierz anon bezpośredni SELECT na questions (czytałby ans z pominięciem RPC).
-- Gra i praktyka idą teraz przez powyższe RPC (SECURITY DEFINER). Admin (authenticated)
-- ma nadal pełny dostęp z sekcji 6 (GRANT ALL ... TO authenticated).
REVOKE SELECT ON public.questions FROM anon;

-- 29.2 — submit_answer: poprawność liczona SERWEROWO; zwraca correct_ans
-- (bezpiecznie — wiersz jest 'ostateczny' przez ON CONFLICT DO NOTHING, więc znajomość
--  correct_ans po zapisie nie pozwala zmienić odpowiedzi).
DROP FUNCTION IF EXISTS public.submit_answer(UUID, TEXT, TEXT, UUID, INT);
CREATE OR REPLACE FUNCTION public.submit_answer(
  p_session_id UUID, p_code TEXT, p_name TEXT, p_question_id UUID, p_chosen INT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ans INT; v_module INT; v_city TEXT; v_started TIMESTAMPTZ; v_is_correct BOOLEAN; v_rt INT;
BEGIN
  IF NOT public.code_exists(p_code) THEN RAISE EXCEPTION 'invalid code'; END IF;
  SELECT ans, module, city INTO v_ans, v_module, v_city FROM public.questions WHERE id = p_question_id;
  IF v_ans IS NULL THEN RAISE EXCEPTION 'invalid question'; END IF;
  SELECT q_started_at INTO v_started FROM public.quiz_sessions WHERE id = p_session_id;
  v_rt := CASE WHEN v_started IS NOT NULL
            THEN GREATEST(0, FLOOR(EXTRACT(epoch FROM (clock_timestamp() - v_started))))::INT
            ELSE NULL END;
  v_is_correct := (p_chosen IS NOT NULL AND p_chosen = v_ans);
  INSERT INTO public.answers (session_id, participant_code, participant_name, city, question_id, module, chosen, is_correct, points, response_time_s)
  VALUES (p_session_id, p_code, p_name, v_city, p_question_id, v_module, p_chosen, v_is_correct, 0, v_rt)
  ON CONFLICT (session_id, participant_code, question_id) DO NOTHING;
  RETURN json_build_object('is_correct', v_is_correct, 'correct_ans', v_ans);
END; $$;
REVOKE EXECUTE ON FUNCTION public.submit_answer(UUID, TEXT, TEXT, UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_answer(UUID, TEXT, TEXT, UUID, INT) TO anon, authenticated;

-- 29.3 — odbierz anon bezpośredni INSERT na answers (zapis tylko przez submit_answer)
REVOKE INSERT ON public.answers FROM anon;
DROP POLICY IF EXISTS "answers_public_insert" ON public.answers;

-- 29.4 — get_admin_answer_summary: dodaj ans BRAMKOWANE (publiczny LiveView reveal).
-- ans zwracane tylko gdy pytanie 'odsłonięte': minął jego czas (modules.time_per_q)
-- jako bieżące pytanie, albo już je minęliśmy, albo sesja ended/results.
DROP FUNCTION IF EXISTS public.get_admin_answer_summary(UUID, UUID);
CREATE OR REPLACE FUNCTION public.get_admin_answer_summary(p_session_id UUID, p_question_id UUID)
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT status, q_started_at, current_question_idx, city
    FROM public.quiz_sessions WHERE id = p_session_id
  ),
  o AS (
    SELECT q.id, q.ans, COALESCE(m.time_per_q, 60) AS tpq,
           row_number() OVER (ORDER BY q.module, q.sort_order, q.id) - 1 AS gidx
    FROM public.questions q
    LEFT JOIN public.modules m ON m.id = q.module
    WHERE q.is_practice = false AND q.city = (SELECT city FROM s)
  )
  SELECT json_build_object(
    'total',   (SELECT COUNT(*)::INT FROM public.answers WHERE session_id = p_session_id AND question_id = p_question_id),
    'correct', (SELECT COUNT(*) FILTER (WHERE is_correct = true)::INT FROM public.answers WHERE session_id = p_session_id AND question_id = p_question_id),
    'ans', (
      SELECT CASE WHEN
           (SELECT status FROM s) IN ('ended','results')
        OR o.gidx <  (SELECT current_question_idx FROM s)
        OR ( o.gidx = (SELECT current_question_idx FROM s)
             AND (SELECT q_started_at FROM s) IS NOT NULL
             AND clock_timestamp() >= (SELECT q_started_at FROM s) + (o.tpq || ' seconds')::interval )
      THEN o.ans ELSE NULL END
      FROM o WHERE o.id = p_question_id
    )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.get_admin_answer_summary(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_admin_answer_summary(UUID, UUID) TO anon, authenticated;

-- 29.5 — H-1: kontrola ROLI w RPC admina (nie wystarczy 'authenticated').
-- Admini mają poprawne auth.uid()+rolę, więc to bezpieczne (gotcha z auth.uid()=NULL
-- dotyczy funkcji wołanych przez ANON, nie tych admina). [[supabase-auth-uid-null-gotcha]]

CREATE OR REPLACE FUNCTION public.update_quiz_session_admin(p_session_id UUID, p_data JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_my_role() NOT IN ('city_admin','superadmin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.quiz_sessions SET
    status               = CASE WHEN p_data ? 'status'               THEN p_data->>'status'                      ELSE status               END,
    q_started_at         = CASE WHEN p_data ? 'q_started_at'         THEN (p_data->>'q_started_at')::TIMESTAMPTZ  ELSE q_started_at         END,
    pause_elapsed_s      = CASE WHEN p_data ? 'pause_elapsed_s'      THEN (p_data->>'pause_elapsed_s')::INT       ELSE pause_elapsed_s      END,
    current_question_idx = CASE WHEN p_data ? 'current_question_idx' THEN (p_data->>'current_question_idx')::INT  ELSE current_question_idx END
  WHERE id = p_session_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.update_quiz_session_admin(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_quiz_session(p_session_id UUID)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start TIMESTAMPTZ := clock_timestamp() + interval '10 seconds';
BEGIN
  IF public.get_my_role() NOT IN ('city_admin','superadmin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.quiz_sessions
    SET status = 'running', q_started_at = v_start, current_question_idx = 0
    WHERE id = p_session_id AND status = 'waiting';
  IF FOUND THEN RETURN v_start; ELSE RETURN NULL; END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.start_quiz_session(UUID) TO authenticated;

-- get_session_results: ranking widoczny tylko dla admina (filtr roli w WHERE → brak roli = 0 wierszy)
DROP FUNCTION IF EXISTS public.get_session_results(UUID);
CREATE OR REPLACE FUNCTION public.get_session_results(p_session_id UUID)
RETURNS TABLE (participant_code TEXT, participant_name TEXT, city TEXT, correct_count BIGINT, total_count BIGINT, avg_response_time_s INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT participant_code, participant_name, city,
    COUNT(*) FILTER (WHERE is_correct = true)::BIGINT,
    COUNT(*)::BIGINT,
    ROUND(AVG(response_time_s))::INT
  FROM public.answers
  WHERE session_id = p_session_id
    AND public.get_my_role() IN ('city_admin','superadmin')
  GROUP BY participant_code, participant_name, city
  ORDER BY COUNT(*) FILTER (WHERE is_correct = true) DESC, ROUND(AVG(response_time_s)) ASC NULLS LAST;
$$;
REVOKE EXECUTE ON FUNCTION public.get_session_results(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_session_results(UUID) TO authenticated;

-- ─── 30. Masowe usuwanie (admin): wszystkie pytania / kody miasta ──
-- Admin nie ma RLS DELETE na answers, więc kasowanie pytań z odpowiedziami
-- wymaga SECURITY DEFINER. Rola wymagana (city_admin/superadmin).

CREATE OR REPLACE FUNCTION public.admin_delete_city_questions(p_city TEXT, p_practice BOOLEAN)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
  IF public.get_my_role() NOT IN ('city_admin','superadmin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.answers WHERE question_id IN
    (SELECT id FROM public.questions WHERE city = p_city AND is_practice = p_practice);
  WITH d AS (DELETE FROM public.questions WHERE city = p_city AND is_practice = p_practice RETURNING 1)
    SELECT count(*) INTO v_count FROM d;
  RETURN v_count;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_city_questions(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_delete_city_questions(TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_city_codes(p_city TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
  IF public.get_my_role() NOT IN ('city_admin','superadmin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  WITH d AS (DELETE FROM public.participant_codes WHERE city = p_city RETURNING 1)
    SELECT count(*) INTO v_count FROM d;
  RETURN v_count;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_city_codes(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_delete_city_codes(TEXT) TO authenticated;

-- ─── 31. Czas odpowiedzi w MILISEKUNDACH (precyzyjny tie-break) ──
-- response_time_s (sekundy) dawał dużo remisów. Dodajemy response_time_ms i liczymy
-- ranking po średnim czasie w ms (remis dużo rzadszy). Wstecznie: COALESCE z s*1000.

ALTER TABLE public.answers ADD COLUMN IF NOT EXISTS response_time_ms INT;

-- submit_answer: zapisuje też response_time_ms (z clock_timestamp − q_started_at).
CREATE OR REPLACE FUNCTION public.submit_answer(
  p_session_id UUID, p_code TEXT, p_name TEXT, p_question_id UUID, p_chosen INT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ans INT; v_module INT; v_city TEXT; v_started TIMESTAMPTZ; v_is_correct BOOLEAN; v_rt_ms INT;
BEGIN
  IF NOT public.code_exists(p_code) THEN RAISE EXCEPTION 'invalid code'; END IF;
  SELECT ans, module, city INTO v_ans, v_module, v_city FROM public.questions WHERE id = p_question_id;
  IF v_ans IS NULL THEN RAISE EXCEPTION 'invalid question'; END IF;
  SELECT q_started_at INTO v_started FROM public.quiz_sessions WHERE id = p_session_id;
  v_rt_ms := CASE WHEN v_started IS NOT NULL
              THEN GREATEST(0, EXTRACT(epoch FROM (clock_timestamp() - v_started)) * 1000)::INT
              ELSE NULL END;
  v_is_correct := (p_chosen IS NOT NULL AND p_chosen = v_ans);
  INSERT INTO public.answers (session_id, participant_code, participant_name, city, question_id, module, chosen, is_correct, points, response_time_s, response_time_ms)
  VALUES (p_session_id, p_code, p_name, v_city, p_question_id, v_module, p_chosen, v_is_correct, 0,
          CASE WHEN v_rt_ms IS NOT NULL THEN (v_rt_ms / 1000) ELSE NULL END, v_rt_ms)
  ON CONFLICT (session_id, participant_code, question_id) DO NOTHING;
  RETURN json_build_object('is_correct', v_is_correct, 'correct_ans', v_ans);
END; $$;
REVOKE EXECUTE ON FUNCTION public.submit_answer(UUID, TEXT, TEXT, UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_answer(UUID, TEXT, TEXT, UUID, INT) TO anon, authenticated;

-- get_session_results: ranking po liczbie poprawnych, remis → krótszy średni czas w MS.
DROP FUNCTION IF EXISTS public.get_session_results(UUID);
CREATE OR REPLACE FUNCTION public.get_session_results(p_session_id UUID)
RETURNS TABLE (participant_code TEXT, participant_name TEXT, city TEXT, correct_count BIGINT, total_count BIGINT, avg_response_time_ms INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT participant_code, participant_name, city,
    COUNT(*) FILTER (WHERE is_correct = true)::BIGINT,
    COUNT(*)::BIGINT,
    ROUND(AVG(COALESCE(response_time_ms, response_time_s * 1000)))::INT
  FROM public.answers
  WHERE session_id = p_session_id
    AND public.get_my_role() IN ('city_admin','superadmin')
  GROUP BY participant_code, participant_name, city
  ORDER BY COUNT(*) FILTER (WHERE is_correct = true) DESC,
           ROUND(AVG(COALESCE(response_time_ms, response_time_s * 1000))) ASC NULLS LAST;
$$;
REVOKE EXECUTE ON FUNCTION public.get_session_results(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_session_results(UUID) TO authenticated;

-- ─── 32. Usuwanie pojedynczego pytania z odpowiedziami (FK) ──────
-- Pytanie z odpowiedziami nie dawało się usunąć bezpośrednio (FK answers.question_id).
-- RPC usuwa najpierw odpowiedzi, potem pytanie. Rola wymagana.
CREATE OR REPLACE FUNCTION public.admin_delete_question(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_my_role() NOT IN ('city_admin','superadmin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.answers WHERE question_id = p_id;
  DELETE FROM public.questions WHERE id = p_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_question(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_delete_question(UUID) TO authenticated;

-- ─── 33. Historia: nazwa sesji + usuwanie + rename ──────
ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS name TEXT;

CREATE OR REPLACE FUNCTION public.admin_rename_session(p_id UUID, p_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_my_role() NOT IN ('city_admin','superadmin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.quiz_sessions SET name = NULLIF(btrim(p_name), '') WHERE id = p_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_rename_session(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_rename_session(UUID, TEXT) TO authenticated;

-- Usuwa sesję (answers + violations znikają przez ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION public.admin_delete_session(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_my_role() NOT IN ('city_admin','superadmin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.quiz_sessions WHERE id = p_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_session(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_delete_session(UUID) TO authenticated;

-- ─── 34. Wiązanie kodu z URZĄDZENIEM (anty-współdzielenie) ──────
-- IP nie nadaje się (wszyscy w sali = jeden publiczny IP). Wiążemy kod z tokenem
-- urządzenia (localStorage). To samo urządzenie wchodzi ponownie; inne dostaje
-- "kod zajęty". Admin może zwolnić kod (zmiana telefonu itp.).

ALTER TABLE public.participant_codes ADD COLUMN IF NOT EXISTS device_id TEXT;

-- claim: waliduje kod i wiąże z urządzeniem (lub potwierdza to samo). Zwraca
-- {ok:true,data:{...}} albo {ok:false,reason:'not_found'|'taken'}.
DROP FUNCTION IF EXISTS public.claim_participant_code(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.claim_participant_code(p_code TEXT, p_device TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.participant_codes;
BEGIN
  SELECT * INTO v_row FROM public.participant_codes WHERE code = upper(btrim(p_code)) LIMIT 1;
  IF v_row.id IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_row.device_id IS NOT NULL AND p_device IS NOT NULL AND v_row.device_id <> p_device THEN
    RETURN json_build_object('ok', false, 'reason', 'taken');
  END IF;
  IF p_device IS NOT NULL AND v_row.device_id IS DISTINCT FROM p_device THEN
    UPDATE public.participant_codes SET device_id = p_device WHERE id = v_row.id;
  END IF;
  RETURN json_build_object('ok', true, 'data', json_build_object(
    'id', v_row.id, 'code', v_row.code, 'name', v_row.name, 'surname', v_row.surname,
    'city', v_row.city, 'used', v_row.used, 'session_id', v_row.session_id));
END; $$;
REVOKE EXECUTE ON FUNCTION public.claim_participant_code(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_participant_code(TEXT, TEXT) TO anon, authenticated;

-- admin: zwolnij kod (wyczyść powiązanie z urządzeniem) — gdy ktoś zmienił telefon.
CREATE OR REPLACE FUNCTION public.admin_release_code(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_my_role() NOT IN ('city_admin','superadmin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.participant_codes SET device_id = NULL WHERE id = p_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_release_code(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_release_code(UUID) TO authenticated;

-- ─── 35. HARDENING profiles — blokada eskalacji uprawnień ───────
-- LUKA KRYTYCZNA: jedyną polityką na profiles było "profiles_own FOR ALL
-- USING (auth.uid() = id)" — bez WITH CHECK i bez ograniczenia kolumn. W połączeniu
-- z GRANT ALL ... TO authenticated pozwalało to city_adminowi wykonać
--   UPDATE profiles SET role='superadmin', city=NULL WHERE id = auth.uid();
-- i przejąć kontrolę nad wszystkimi miastami. Rozdzielamy politykę: SELECT własnego
-- wiersza (superadmin widzi wszystkie), pełny zapis TYLKO dla superadmina — city_admin
-- traci prawo modyfikacji własnego profilu. Trigger to obrona w głąb: nawet gdyby
-- polityka kiedyś się poluzowała, zmiana role/city przez nie-superadmina jest odrzucana.
-- get_my_role() jest SECURITY DEFINER, więc użycie go w polityce profiles nie powoduje
-- rekurencji RLS (definer omija RLS na profiles).

DROP POLICY IF EXISTS "profiles_own"            ON public.profiles;
DROP POLICY IF EXISTS "profiles_superadmin"     ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own"     ON public.profiles;
DROP POLICY IF EXISTS "profiles_superadmin_all" ON public.profiles;

CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.get_my_role() = 'superadmin');
CREATE POLICY "profiles_superadmin_all" ON public.profiles FOR ALL
  USING (public.get_my_role() = 'superadmin')
  WITH CHECK (public.get_my_role() = 'superadmin');

-- SECURITY INVOKER (bez DEFINER) — auth.uid() musi wiarygodnie wskazywać realnego
-- wywołującego. W SECURITY DEFINER auth.uid() bywa NULL [[supabase-auth-uid-null-gotcha]],
-- co tutaj byłoby groźne: NULL = zaufany kontekst → przepuszczenie eskalacji.
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_change()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Zaufany kontekst serwerowy (service role / SQL editor / migracje): brak auth.uid().
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.get_my_role() = 'superadmin' THEN RETURN NEW; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.city IS DISTINCT FROM OLD.city THEN
    RAISE EXCEPTION 'Zmiana roli lub miasta profilu jest niedozwolona';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_prevent_profile_priv ON public.profiles;
CREATE TRIGGER trg_prevent_profile_priv
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_change();

-- ─── 36. submit_answer — walidacja aktywnego pytania i okna czasu ──
-- Domyka integralność wyników: dotąd submit_answer przyjmował odpowiedź na DOWOLNE
-- pytanie w dowolnym momencie sesji. Ponieważ kolejność pytań jest deterministyczna
-- (ORDER BY module, sort_order, id), a poprawność liczona jest serwerowo, ktoś mógłby
-- przez samo API zapisać odpowiedzi na przyszłe pytania. Teraz wymagamy:
--   • sesja 'running',
--   • pytanie AKTUALNIE aktywne (jego globalny indeks = current_question_idx),
--   • wybór (p_chosen != NULL) w oknie [q_started_at, q_started_at + time_per_q + 1,5 s]
--     (1,5 s zapasu na opóźnienia sieci); pusty zapis (p_chosen NULL — timeout) jest
--     dozwolony także po czasie, bo tylko rejestruje brak odpowiedzi i zwraca correct_ans
--     do reveala (nie da się nim „dostrzelić" poprawnej odpowiedzi).
--   • limit długości participant_name (ochrona przed nadmiarowym wpisem od anon).
CREATE OR REPLACE FUNCTION public.submit_answer(
  p_session_id UUID, p_code TEXT, p_name TEXT, p_question_id UUID, p_chosen INT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ans INT; v_module INT; v_city TEXT; v_started TIMESTAMPTZ; v_is_correct BOOLEAN; v_rt_ms INT;
  v_status TEXT; v_cur_idx INT; v_tpq INT; v_gidx INT; v_name TEXT;
BEGIN
  IF NOT public.code_exists(p_code) THEN RAISE EXCEPTION 'invalid code'; END IF;
  v_name := left(COALESCE(p_name, ''), 120);
  SELECT ans, module, city INTO v_ans, v_module, v_city FROM public.questions WHERE id = p_question_id;
  IF v_ans IS NULL THEN RAISE EXCEPTION 'invalid question'; END IF;
  SELECT status, q_started_at, current_question_idx
    INTO v_status, v_started, v_cur_idx
    FROM public.quiz_sessions WHERE id = p_session_id;
  IF v_status IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'session not running'; END IF;
  -- globalny indeks pytania w obrębie miasta (identyczna kolejność jak get_quiz_questions)
  SELECT o.tpq, o.gidx INTO v_tpq, v_gidx FROM (
    SELECT q.id, COALESCE(m.time_per_q, 60) AS tpq,
           row_number() OVER (ORDER BY q.module, q.sort_order, q.id) - 1 AS gidx
    FROM public.questions q LEFT JOIN public.modules m ON m.id = q.module
    WHERE q.is_practice = false AND q.city = v_city
  ) o WHERE o.id = p_question_id;
  IF v_gidx IS DISTINCT FROM v_cur_idx THEN RAISE EXCEPTION 'question not active'; END IF;
  IF v_started IS NULL OR clock_timestamp() < v_started THEN RAISE EXCEPTION 'question not started'; END IF;
  IF p_chosen IS NOT NULL
     AND clock_timestamp() > v_started + (v_tpq || ' seconds')::interval + interval '1.5 seconds' THEN
    RAISE EXCEPTION 'time is up';
  END IF;
  v_rt_ms := GREATEST(0, EXTRACT(epoch FROM (clock_timestamp() - v_started)) * 1000)::INT;
  v_is_correct := (p_chosen IS NOT NULL AND p_chosen = v_ans);
  INSERT INTO public.answers (session_id, participant_code, participant_name, city, question_id, module, chosen, is_correct, points, response_time_s, response_time_ms)
  VALUES (p_session_id, p_code, v_name, v_city, p_question_id, v_module, p_chosen, v_is_correct, 0,
          CASE WHEN v_rt_ms IS NOT NULL THEN (v_rt_ms / 1000) ELSE NULL END, v_rt_ms)
  ON CONFLICT (session_id, participant_code, question_id) DO NOTHING;
  RETURN json_build_object('is_correct', v_is_correct, 'correct_ans', v_ans);
END; $$;
REVOKE EXECUTE ON FUNCTION public.submit_answer(UUID, TEXT, TEXT, UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_answer(UUID, TEXT, TEXT, UUID, INT) TO anon, authenticated;

-- ─── 37. WYDAJNOŚĆ POD OBCIĄŻENIEM (audyt 02.09.2026) ───────────
-- Trzy zmiany zdejmujące z bazy ruch, który przy 500 uczestnikach działa
-- przeciwko quizowi, plus RPC pod eksport indywidualnych wyników.

-- 37.1 — Zdejmij answers z publikacji Realtime.
-- PRZYCZYNA: 58 pytań × 500 osób = ~29 000 zdarzeń INSERT przechodzących tym samym
-- slotem replikacji, którym idą UPDATE-y quiz_sessions sterujące przejściem pytania.
-- Najgorszy moment jest wbudowany w konstrukcję: gdy timer dobija zera, wszyscy, którzy
-- nie kliknęli, wysyłają pustą odpowiedź w tej samej ćwierćsekundzie — i dokładnie za tą
-- lawiną staje w kolejce komunikat, który musi dojść w <1 s.
-- Panel admina i tak dolicza licznik pollem co 1 s (AdminPanel.jsx), więc ta subskrypcja
-- kupowała sekundę ładniejszego UI kosztem ścieżki krytycznej całej sali.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND tablename = 'answers') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.answers;
  END IF;
  -- participant_codes: nic w kodzie klienta się do niej nie subskrybuje, a mark_code_used
  -- generuje UPDATE per uczestnik przy dołączaniu (500 zdarzeń do zdekodowania bez odbiorcy).
  IF EXISTS (SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND tablename = 'participant_codes') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.participant_codes;
  END IF;
END $$;

-- 37.2 — Indeks pod getViolationsForSession (panel odpytuje co 3 s).
-- Bez niego to skan sekwencyjny po rosnącej tabeli — a violations rośnie szybko,
-- bo visibilitychange odpala się przy każdym zablokowaniu ekranu telefonu.
CREATE INDEX IF NOT EXISTS idx_violations_session
  ON public.violations(session_id, created_at DESC);

-- 37.3 — Zasiej tabelę modules wartościami domyślnymi.
-- PRZYCZYNA usterki "modułów nie da się edytować": przy PUSTEJ tabeli getModules()
-- zwraca FALLBACK_MODULES z src/data/questions.js. Panel pokazuje 5 modułów, ale
-- UPDATE modules WHERE id=1 trafia w 0 wierszy — bez błędu. Po reloadzie znowu widać
-- fallback, więc wygląda to jak niedziałająca edycja. ON CONFLICT DO NOTHING = bezpieczne
-- na bazie, gdzie moduły już są (nie nadpisuje zmian admina).
INSERT INTO public.modules (id, name, icon, color, time_per_q, description, sort_order) VALUES
  (1, 'Obliczenia',              '🧮', '#6B21E8', 90, 'Zadania obliczeniowe',          1),
  (2, 'Terminy',                 '📚', '#1565C0', 30, 'Pojęcia i definicje',           2),
  (3, 'Logika ekonomiczna',      '🧠', '#2E7D32', 60, 'Analiza i wnioskowanie',        3),
  (4, 'Pytania kreatywne',       '💡', '#E65100', 75, 'Scenariusze i dylematy',        4),
  (5, 'Aktualności gospodarcze', '📰', '#880E4F', 45, 'Bieżące wydarzenia ekonomiczne', 5)
ON CONFLICT (id) DO NOTHING;

-- 37.4 — get_session_detailed_results: karta odpowiedzi każdego uczestnika.
-- Zasila eksport XLSX (arkusz per uczestnik). Zwraca iloczyn uczestnicy × pytania,
-- więc uczestnik, który na coś nie odpowiedział, ma widoczny pusty wiersz zamiast
-- brakującego — inaczej w arkuszu nie widać, że ktoś pytanie pominął.
-- Rola wymagana w WHERE (brak roli = 0 wierszy) — ten sam wzorzec co get_session_results.
DROP FUNCTION IF EXISTS public.get_session_detailed_results(UUID);
CREATE OR REPLACE FUNCTION public.get_session_detailed_results(p_session_id UUID)
RETURNS TABLE (
  participant_code TEXT,
  participant_name TEXT,
  city             TEXT,
  q_no             INT,
  module           INT,
  module_name      TEXT,
  question         TEXT,
  chosen_label     TEXT,
  chosen_text      TEXT,
  correct_label    TEXT,
  correct_text     TEXT,
  is_correct       BOOLEAN,
  response_time_ms INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT id, city FROM public.quiz_sessions WHERE id = p_session_id
  ),
  q AS (
    -- Ta sama kolejność co get_quiz_questions i submit_answer — numer pytania
    -- w arkuszu zgadza się z numerem, który uczestnik widział na ekranie.
    SELECT qq.id, qq.module, qq.q, qq.opts, qq.ans,
           (row_number() OVER (ORDER BY qq.module, qq.sort_order, qq.id))::INT AS q_no
    FROM public.questions qq
    WHERE qq.is_practice = false AND qq.city = (SELECT city FROM s)
  ),
  p AS (
    SELECT pc.code, btrim(pc.name || ' ' || pc.surname) AS full_name, pc.city
    FROM public.participant_codes pc
    WHERE pc.session_id = p_session_id AND pc.used = true
  )
  SELECT
    p.code, p.full_name, p.city,
    q.q_no, q.module,
    COALESCE(m.name, 'Moduł ' || q.module),
    q.q,
    CASE WHEN a.chosen IS NOT NULL THEN chr(65 + a.chosen) END,
    CASE WHEN a.chosen IS NOT NULL THEN q.opts[a.chosen + 1] END,
    chr(65 + q.ans),
    q.opts[q.ans + 1],
    COALESCE(a.is_correct, false),
    a.response_time_ms
  FROM p
  CROSS JOIN q
  LEFT JOIN public.answers a
         ON a.session_id = p_session_id
        AND a.participant_code = p.code
        AND a.question_id = q.id
  LEFT JOIN public.modules m ON m.id = q.module
  WHERE public.get_my_role() IN ('city_admin','superadmin')
  ORDER BY p.full_name, p.code, q.q_no;
$$;
REVOKE EXECUTE ON FUNCTION public.get_session_detailed_results(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_session_detailed_results(UUID) TO authenticated;

-- ─── 38. PUBLIKACJA REALTIME — stan pożądany + diagnostyka ──────
-- ZNALEZIONE 02.09.2026 na produkcji (ytbwmmqwbfcugouourih): klient anon wchodzi
-- w SUBSCRIBED, ale UPDATE na quiz_sessions NIE DOCIERA. Czyli postgres_changes nie
-- dostarcza nic. Projekt był migrowany (STATUS.md dokumentuje jeszcze stary
-- dmoydtavstpurqebkngu), a blok DO z SUPABASE_SCHEMA.sql dodający tabele do
-- publikacji najwyraźniej nie wykonał się na nowym projekcie.
--
-- Skutek: uczestnicy dowiadują się o starcie quizu WYŁĄCZNIE z polla w poczekalni,
-- bo Lobby nie ma innej szybkiej ścieżki. Aplikacja działa, ale start jest opóźniony
-- o pełen okres polla i cała synchronizacja opiera się na jednym mechanizmie.
--
-- Stan pożądany publikacji:
--   quiz_sessions      JEST  (kanał sterujący quizem — krytyczny)
--   answers            NIE   (sekcja 37.1 — lawina ~29 000 INSERT-ów)
--   participant_codes  NIE   (sekcja 37.1 — nikt się nie subskrybuje)

DO $$
DECLARE v_all BOOLEAN;
BEGIN
  SELECT puballtables INTO v_all FROM pg_publication WHERE pubname = 'supabase_realtime';

  IF v_all IS NULL THEN
    RAISE NOTICE 'supabase_realtime NIE ISTNIEJE — tworzę z quiz_sessions.';
    CREATE PUBLICATION supabase_realtime FOR TABLE public.quiz_sessions;

  ELSIF v_all THEN
    -- FOR ALL TABLES: nie da się usunąć pojedynczej tabeli. Sekcja 37.1 była wtedy
    -- no-opem, więc lawina answers NADAL blokuje kanał — trzeba przebudować publikację.
    RAISE NOTICE 'supabase_realtime jest FOR ALL TABLES — przebudowuję na listę tabel.';
    DROP PUBLICATION supabase_realtime;
    CREATE PUBLICATION supabase_realtime FOR TABLE public.quiz_sessions;

  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime'
                     AND schemaname = 'public' AND tablename = 'quiz_sessions') THEN
      RAISE NOTICE 'Dodaję quiz_sessions do publikacji (brakowało!).';
      ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_sessions;
    END IF;
  END IF;
END $$;

-- Filtr Lobby to `city=eq.` — kolumna spoza klucza głównego. FULL gwarantuje, że
-- Realtime ma komplet kolumn do dopasowania filtra i do old_record. quiz_sessions ma
-- kilkanaście wierszy, więc koszt w WAL jest bez znaczenia.
ALTER TABLE public.quiz_sessions REPLICA IDENTITY FULL;

-- Diagnostyka — jedyny sposób, żeby SPRAWDZIĆ publikację spoza SQL Editora.
-- Zwraca wyłącznie trzy booleany o tabelach, których nazwy i tak są w bundlu JS,
-- więc nic nie ujawnia; za to `npm run verify-prod` może to odpytać jako anon.
CREATE OR REPLACE FUNCTION public.realtime_publication_status()
RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'publication_exists', EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'),
    'all_tables',         COALESCE((SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime'), false),
    'quiz_sessions',      EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quiz_sessions'),
    'answers',            EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'answers'),
    'participant_codes',  EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'participant_codes')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.realtime_publication_status() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.realtime_publication_status() TO anon, authenticated;

-- ─── 39. PLAN SESJI + ZAMIATACZ — rozgrywka autorytatywna serwera (faza 6) ──
-- Wyłącznie ADDYTYWNIE: nowe tabele/kolumny/funkcje albo CREATE OR REPLACE z tą samą
-- sygnaturą. Sesje bez planu (plan_anchor_at IS NULL) działają dokładnie po staremu.
-- Wgrywać RĘCZNIE w SQL Editorze projektu ytbwmmqwbfcugouourih (testy idą na produkcji).
--
-- Model: przy starcie baza zamraża PLAN (kolejność pytań + czas każdego) jako offsety
-- w ms od KOTWICY plan_anchor_at. Wszystkie terminy = kotwica + offset. Pauza / wznowienie
-- / „⏭ Następne” / „🔁 Powtórz” = jedna zmiana kotwicy. Fazę liczy jedna funkcja
-- plan_position() — lustro planPosition() z src/lib/plan.js (parzystość: npm run verify-plan).

-- 39.1 — tabela planu + kolumny kotwicy.
-- Plan w OSOBNEJ tabeli, bo quiz_sessions ma REPLICA IDENTITY FULL — plan w kolumnie
-- leciałby 2× (new + old) w każdym zdarzeniu Realtime do ~500 subskrybentów.
-- items NIE zawierają `ans` (tylko id, moduł, czasy), więc SELECT dla anona jest bezpieczny.
CREATE TABLE IF NOT EXISTS public.session_plans (
  session_id UUID PRIMARY KEY REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  items      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.session_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "session_plans_read" ON public.session_plans;
CREATE POLICY "session_plans_read" ON public.session_plans FOR SELECT USING (true);
REVOKE ALL ON public.session_plans FROM anon, authenticated;
GRANT SELECT ON public.session_plans TO anon, authenticated;
ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS plan_anchor_at TIMESTAMPTZ;
ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS plan_paused_at TIMESTAMPTZ;
ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS revealed_idx INT;
ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS revealed_ans INT;

-- 39.2 — plan_position: JEDYNE źródło prawdy o fazie po stronie bazy.
-- items = [{ i, id, m, tpq, lead, o, c, r }] (ms od kotwicy); t = (paused_at ?? at) − kotwica.
-- Fazy: paused | finished (t ≥ r[last]) | intro (t < o, lead ≥ 10) | countdown (t < o)
--       | quiz (t < c) | reveal. Funkcja NIE czyta tabel — GRANT anon umożliwia test
-- parzystości JS↔SQL (npm run verify-plan) na tych samych fixture'ach co Vitest.
CREATE OR REPLACE FUNCTION public.plan_position(
  p_items JSONB, p_anchor TIMESTAMPTZ, p_paused_at TIMESTAMPTZ, p_at TIMESTAMPTZ)
RETURNS TABLE (idx INT, phase TEXT, opens_at TIMESTAMPTZ, closes_at TIMESTAMPTZ,
               reveal_until TIMESTAMPTZ, question_id UUID, tpq INT)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (SELECT EXTRACT(epoch FROM (COALESCE(p_paused_at, p_at) - p_anchor)) * 1000 AS ms),
  it AS (
    SELECT (e->>'i')::INT AS i, (e->>'id')::UUID AS id, (e->>'tpq')::INT AS tpq, (e->>'lead')::INT AS lead,
           (e->>'o')::BIGINT AS o, (e->>'c')::BIGINT AS c, (e->>'r')::BIGINT AS r
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) e
  ),
  cur AS (SELECT it.* FROM it, t WHERE t.ms < it.r ORDER BY it.i LIMIT 1),
  lst AS (SELECT it.* FROM it ORDER BY it.i DESC LIMIT 1),
  x   AS (SELECT * FROM cur UNION ALL SELECT * FROM lst WHERE NOT EXISTS (SELECT 1 FROM cur))
  SELECT x.i,
         CASE WHEN p_paused_at IS NOT NULL THEN 'paused'
              WHEN t.ms >= (SELECT r FROM lst) THEN 'finished'
              WHEN t.ms <  x.o THEN CASE WHEN x.lead >= 10 THEN 'intro' ELSE 'countdown' END
              WHEN t.ms <  x.c THEN 'quiz'
              ELSE 'reveal' END,
         p_anchor + x.o * INTERVAL '1 millisecond',
         p_anchor + x.c * INTERVAL '1 millisecond',
         p_anchor + x.r * INTERVAL '1 millisecond',
         x.id, x.tpq
  FROM x, t;
$$;
REVOKE EXECUTE ON FUNCTION public.plan_position(JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.plan_position(JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated;

-- 39.3 — sweep_decision: czysta decyzja zamiatacza (lustro sweepDecision z plan.js).
-- Stan wyprowadzany z kotwicy i zegara, NIE inkrementowany → idempotentna.
-- action: 'none' (nic do zapisu) | 'update' (nowa pozycja/odsłonięcie) | 'finish' (→ results).
-- Odsłonięcie pytania i następuje, gdy t ≥ c[i] + 1500 (bramka reveal = deadline + 1,5 s).
CREATE OR REPLACE FUNCTION public.sweep_decision(
  p_items JSONB, p_anchor TIMESTAMPTZ, p_paused_at TIMESTAMPTZ, p_status TEXT,
  p_cur_idx INT, p_q_started TIMESTAMPTZ, p_revealed_idx INT, p_at TIMESTAMPTZ)
RETURNS TABLE (action TEXT, new_status TEXT, new_idx INT, new_q_started_at TIMESTAMPTZ, new_revealed_idx INT)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  p RECORD; v_t NUMERIC; v_c BIGINT; v_rev INT;
BEGIN
  IF p_status IS DISTINCT FROM 'running' OR p_anchor IS NULL OR p_paused_at IS NOT NULL
     OR p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN QUERY SELECT 'none'::TEXT, NULL::TEXT, NULL::INT, NULL::TIMESTAMPTZ, NULL::INT;
    RETURN;
  END IF;
  SELECT * INTO p FROM public.plan_position(p_items, p_anchor, NULL, p_at);
  v_t   := EXTRACT(epoch FROM (p_at - p_anchor)) * 1000;
  v_c   := (p_items->p.idx->>'c')::BIGINT;
  v_rev := CASE WHEN v_t >= v_c + 1500 THEN p.idx
                WHEN p.idx > 0 THEN p.idx - 1
                ELSE NULL END;
  IF p.phase = 'finished' THEN
    RETURN QUERY SELECT 'finish'::TEXT, 'results'::TEXT, p.idx::INT, p.opens_at::TIMESTAMPTZ, p.idx::INT;
    RETURN;
  END IF;
  IF p.idx IS DISTINCT FROM p_cur_idx
     OR p.opens_at IS DISTINCT FROM p_q_started
     OR v_rev IS DISTINCT FROM p_revealed_idx THEN
    RETURN QUERY SELECT 'update'::TEXT, 'running'::TEXT, p.idx::INT, p.opens_at::TIMESTAMPTZ, v_rev::INT;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'none'::TEXT, NULL::TEXT, NULL::INT, NULL::TIMESTAMPTZ, NULL::INT;
  RETURN;
END; $$;
REVOKE EXECUTE ON FUNCTION public.sweep_decision(JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INT, TIMESTAMPTZ, INT, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.sweep_decision(JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INT, TIMESTAMPTZ, INT, TIMESTAMPTZ) TO anon, authenticated;

-- 39.4 — build_session_plan: zamrożenie kolejności i czasów pytań miasta.
-- Kolejność identyczna z get_quiz_questions: ORDER BY module, sort_order, id.
-- UWAGA (Pułapka 5): stałe 10 / 30 / 4 / 6 MUSZĄ być zgodne z src/lib/plan.js:
--   FIRST_QUESTION_LEAD = 10, MODULE_INTRO_SECONDS = 30, PRE_QUESTION_LEAD = 4, REVEAL_SECONDS = 6.
CREATE OR REPLACE FUNCTION public.build_session_plan(p_city TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_items  JSONB  := '[]'::jsonb;
  v_i      INT    := 0;
  v_prev_m INT    := NULL;
  v_prev_r BIGINT := 0;
  v_lead   INT; v_o BIGINT; v_c BIGINT; v_r BIGINT;
BEGIN
  FOR r IN
    SELECT q.id, q.module, COALESCE(m.time_per_q, 60) AS tpq
    FROM public.questions q
    LEFT JOIN public.modules m ON m.id = q.module
    WHERE q.city = p_city AND q.is_practice = false
    ORDER BY q.module, q.sort_order, q.id
  LOOP
    v_lead := CASE WHEN v_i = 0 THEN 10
                   WHEN r.module IS DISTINCT FROM v_prev_m THEN 30
                   ELSE 4 END;
    v_o := v_prev_r + v_lead * 1000;
    v_c := v_o + r.tpq * 1000;
    v_r := v_c + 6000;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'i', v_i, 'id', r.id, 'm', r.module, 'tpq', r.tpq, 'lead', v_lead,
      'o', v_o, 'c', v_c, 'r', v_r));
    v_prev_r := v_r;
    v_prev_m := r.module;
    v_i := v_i + 1;
  END LOOP;
  RETURN v_items;
END; $$;
REVOKE EXECUTE ON FUNCTION public.build_session_plan(TEXT) FROM PUBLIC, anon, authenticated;

-- 39.5 — start_quiz_session_v2: start sesji z zamrożonym planem.
-- COALESCE na roli: stary wzorzec `get_my_role() NOT IN (...)` przepuszcza NULL (anon).
-- q_started_at = otwarcie pytania 0 (stary kontrakt dla cache'owanych bundli PWA).
CREATE OR REPLACE FUNCTION public.start_quiz_session_v2(p_session_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_city TEXT; v_status TEXT; v_items JSONB;
BEGIN
  IF COALESCE(public.get_my_role(), '') NOT IN ('city_admin','superadmin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT city, status INTO v_city, v_status
    FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not found', 'session', NULL);
  END IF;
  -- kotwica liczona PO uzyskaniu blokady (czekanie na blokadę nie skraca zapowiedzi)
  v_now := clock_timestamp();
  IF v_status IS DISTINCT FROM 'waiting' THEN
    RETURN json_build_object('ok', false, 'reason', 'not waiting',
      'session', (SELECT row_to_json(s) FROM public.quiz_sessions s WHERE s.id = p_session_id));
  END IF;
  v_items := public.build_session_plan(v_city);
  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'no questions',
      'session', (SELECT row_to_json(s) FROM public.quiz_sessions s WHERE s.id = p_session_id));
  END IF;
  INSERT INTO public.session_plans (session_id, items) VALUES (p_session_id, v_items)
  ON CONFLICT (session_id) DO UPDATE SET items = EXCLUDED.items, created_at = clock_timestamp();
  UPDATE public.quiz_sessions SET
    status               = 'running',
    current_question_idx = 0,
    plan_anchor_at       = v_now,
    plan_paused_at       = NULL,
    revealed_idx         = NULL,
    revealed_ans         = NULL,
    pause_elapsed_s      = NULL,
    q_started_at         = v_now + ((v_items->0->>'o')::BIGINT) * INTERVAL '1 millisecond'
  WHERE id = p_session_id;
  RETURN json_build_object('ok', true, 'reason', NULL, 'items', jsonb_array_length(v_items),
    'session', (SELECT row_to_json(s) FROM public.quiz_sessions s WHERE s.id = p_session_id));
END; $$;
REVOKE EXECUTE ON FUNCTION public.start_quiz_session_v2(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_quiz_session_v2(UUID) TO authenticated;

-- 39.6a — submit_answer_v2: aktywne pytanie z PLANU i zegara serwera.
-- clock_timestamp() RAZ na początku (Pułapka 6: now() = start transakcji, a czekanie na
-- blokadę unikalności pod obciążeniem nie może działać na niekorzyść uczestnika).
-- Odpowiedź NIE zawiera poprawności (SC5) — tylko {accepted, duplicate, chosen}.
-- Czas odpowiedzi przycięty do tpq; pusty zapis (timeout) = tpq, zero bonusu.
CREATE OR REPLACE FUNCTION public.submit_answer_v2(
  p_session_id UUID, p_code TEXT, p_name TEXT, p_question_id UUID, p_chosen INT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_name TEXT; v_status TEXT; v_anchor TIMESTAMPTZ; v_paused TIMESTAMPTZ; v_items JSONB;
  v_item JSONB; v_opens TIMESTAMPTZ; v_closes TIMESTAMPTZ; v_tpq INT; v_rt_ms INT;
  v_ans INT; v_module INT; v_city TEXT; v_is_correct BOOLEAN; v_rows INT; v_prev INT;
BEGIN
  IF NOT public.code_exists(p_code) THEN RAISE EXCEPTION 'invalid code'; END IF;
  IF p_chosen IS NOT NULL AND (p_chosen < 0 OR p_chosen > 3) THEN
    RAISE EXCEPTION 'invalid choice';
  END IF;
  v_name := left(COALESCE(p_name, ''), 120);

  SELECT s.status, s.plan_anchor_at, s.plan_paused_at, sp.items
    INTO v_status, v_anchor, v_paused, v_items
    FROM public.quiz_sessions s
    JOIN public.session_plans sp ON sp.session_id = s.id
   WHERE s.id = p_session_id;
  IF NOT FOUND OR v_anchor IS NULL THEN RAISE EXCEPTION 'session has no plan'; END IF;
  IF v_paused IS NOT NULL OR v_status = 'paused' THEN RAISE EXCEPTION 'session paused'; END IF;
  IF v_status IS DISTINCT FROM 'running' THEN RAISE EXCEPTION 'session not running'; END IF;

  SELECT e INTO v_item FROM jsonb_array_elements(v_items) e
   WHERE (e->>'id')::UUID = p_question_id LIMIT 1;
  IF v_item IS NULL THEN RAISE EXCEPTION 'question not in plan'; END IF;

  v_tpq    := (v_item->>'tpq')::INT;
  v_opens  := v_anchor + ((v_item->>'o')::BIGINT) * INTERVAL '1 millisecond';
  v_closes := v_anchor + ((v_item->>'c')::BIGINT) * INTERVAL '1 millisecond';
  IF v_now < v_opens THEN RAISE EXCEPTION 'question not started'; END IF;
  IF p_chosen IS NOT NULL AND v_now > v_closes + INTERVAL '1.5 seconds' THEN
    RAISE EXCEPTION 'time is up';
  END IF;

  v_rt_ms := CASE WHEN p_chosen IS NULL THEN v_tpq * 1000
                  ELSE LEAST(GREATEST(0, EXTRACT(epoch FROM (v_now - v_opens)) * 1000), v_tpq * 1000)::INT
             END;

  SELECT ans, module, city INTO v_ans, v_module, v_city FROM public.questions WHERE id = p_question_id;
  IF v_ans IS NULL THEN RAISE EXCEPTION 'invalid question'; END IF;
  v_is_correct := (p_chosen IS NOT NULL AND p_chosen = v_ans);

  INSERT INTO public.answers (session_id, participant_code, participant_name, city, question_id, module,
                              chosen, is_correct, points, response_time_s, response_time_ms)
  VALUES (p_session_id, p_code, v_name, v_city, p_question_id, v_module,
          p_chosen, v_is_correct, 0, v_rt_ms / 1000, v_rt_ms)
  ON CONFLICT (session_id, participant_code, question_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    SELECT a.chosen INTO v_prev FROM public.answers a
     WHERE a.session_id = p_session_id AND a.participant_code = p_code AND a.question_id = p_question_id;
    RETURN json_build_object('accepted', true, 'duplicate', true, 'chosen', v_prev);
  END IF;
  RETURN json_build_object('accepted', true, 'duplicate', false, 'chosen', p_chosen);
END; $$;
REVOKE EXECUTE ON FUNCTION public.submit_answer_v2(UUID, TEXT, TEXT, UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_answer_v2(UUID, TEXT, TEXT, UUID, INT) TO anon, authenticated;

-- 39.6b — get_participant_state: jeden snapshot dla telefonu uczestnika.
-- Znaczniki czasu jako epoch ms: FLOOR(... * 1000) — zgodność z Date.parse (obcina do ms).
-- Poprawność (is_correct, reveal.ans, correct_total) dopiero po closes_at + 1,5 s
-- czasu efektywnego (z uwzględnieniem pauzy) albo gdy sesja results/ended. Plan BEZ `ans`.
CREATE OR REPLACE FUNCTION public.get_participant_state(
  p_code TEXT, p_session_id UUID DEFAULT NULL, p_include_plan BOOLEAN DEFAULT true)
RETURNS JSON LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now      TIMESTAMPTZ := clock_timestamp();
  v_now_ms   BIGINT;
  v_code     TEXT;
  v_city     TEXT;
  s          public.quiz_sessions%ROWTYPE;
  v_found    BOOLEAN := false;
  v_items    JSONB;
  v_t        NUMERIC;
  v_final    BOOLEAN;
  p          RECORD;
  v_has_pos  BOOLEAN := false;
  v_session  JSON; v_position JSON; v_plan JSON; v_my JSON; v_reveal JSON;
  v_correct  INT := 0;
  v_rev      INT;
  v_rev_ans  INT;
BEGIN
  v_now_ms := FLOOR(EXTRACT(epoch FROM v_now) * 1000)::BIGINT;
  v_code := upper(btrim(COALESCE(p_code, '')));
  SELECT pc.city INTO v_city FROM public.participant_codes pc WHERE pc.code = v_code;
  IF v_city IS NULL THEN
    RETURN json_build_object('server_now', v_now_ms, 'error', 'invalid code');
  END IF;

  -- Sesja przypięta przez klienta (localStorage) …
  IF p_session_id IS NOT NULL THEN
    SELECT * INTO s FROM public.quiz_sessions WHERE id = p_session_id AND city = v_city;
    v_found := FOUND;
    -- … porzucana, gdy jest zakończona, a miasto ma NOWSZĄ niezakończoną sesję.
    -- Klient przypina sessionId w localStorage, a endAndResetSession tworzy NOWE id
    -- (próba → właściwy test, wcześniejsza próba generalna) — bez tej reguły uczestnik
    -- krążyłby w Lobby na starej sesji. Zakończona przypięta sesja BEZ nowszej zostaje
    -- zwrócona (ekran wyników nie znika po 15-s siatce bezpieczeństwa).
    IF v_found AND s.status IN ('results','ended') AND EXISTS (
         SELECT 1 FROM public.quiz_sessions n
          WHERE n.city = v_city AND n.status <> 'ended' AND n.created_at > s.created_at) THEN
      v_found := false;
    END IF;
  END IF;
  IF NOT v_found THEN
    SELECT * INTO s FROM public.quiz_sessions
     WHERE city = v_city AND status <> 'ended'
     ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,
              created_at DESC
     LIMIT 1;
    v_found := FOUND;
  END IF;
  IF NOT v_found THEN
    RETURN json_build_object('server_now', v_now_ms, 'error', NULL, 'session', NULL, 'position', NULL,
      'plan', NULL, 'my_answers', '[]'::json, 'reveal', NULL, 'correct_total', 0);
  END IF;

  IF s.plan_anchor_at IS NOT NULL THEN
    SELECT sp.items INTO v_items FROM public.session_plans sp WHERE sp.session_id = s.id;
    v_t := EXTRACT(epoch FROM (COALESCE(s.plan_paused_at, v_now) - s.plan_anchor_at)) * 1000;
  END IF;
  v_final := s.status IN ('results','ended');

  v_session := json_build_object(
    'id', s.id, 'city', s.city, 'status', s.status, 'is_practice', s.is_practice,
    'bg', s.bg, 'bg_mobile', s.bg_mobile, 'name', s.name,
    'plan_anchor_at', FLOOR(EXTRACT(epoch FROM s.plan_anchor_at) * 1000)::BIGINT,
    'plan_paused_at', FLOOR(EXTRACT(epoch FROM s.plan_paused_at) * 1000)::BIGINT);

  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    SELECT * INTO p FROM public.plan_position(v_items, s.plan_anchor_at, s.plan_paused_at, v_now);
    v_has_pos := FOUND;
    IF v_has_pos THEN
      v_position := json_build_object(
        'idx', p.idx, 'phase', p.phase,
        'opens_at',     FLOOR(EXTRACT(epoch FROM p.opens_at) * 1000)::BIGINT,
        'closes_at',    FLOOR(EXTRACT(epoch FROM p.closes_at) * 1000)::BIGINT,
        'reveal_until', FLOOR(EXTRACT(epoch FROM p.reveal_until) * 1000)::BIGINT);
    END IF;
    IF p_include_plan THEN
      SELECT json_agg(e || jsonb_build_object(
               'q',    COALESCE(q.q, '(pytanie usunięte)'),
               'opts', COALESCE(to_jsonb(q.opts), '[]'::jsonb))
             ORDER BY (e->>'i')::INT)
        INTO v_plan
        FROM jsonb_array_elements(v_items) e
        LEFT JOIN public.questions q ON q.id = (e->>'id')::UUID;
    END IF;
  END IF;

  -- Moje odpowiedzi: is_correct tylko dla pytań odsłoniętych (t_eff ≥ c + 1500) lub po końcu.
  SELECT COALESCE(json_agg(json_build_object(
           'question_id', a.question_id,
           'chosen',      a.chosen,
           'is_correct',  CASE WHEN v_final OR (it.c IS NOT NULL AND v_t >= it.c + 1500)
                              THEN a.is_correct ELSE NULL END)), '[]'::json),
         COUNT(*) FILTER (WHERE a.is_correct = true
                            AND (v_final OR (it.c IS NOT NULL AND v_t >= it.c + 1500)))::INT
    INTO v_my, v_correct
    FROM public.answers a
    LEFT JOIN LATERAL (
      SELECT (e->>'c')::BIGINT AS c
        FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) e
       WHERE (e->>'id')::UUID = a.question_id
       LIMIT 1
    ) it ON true
   WHERE a.session_id = s.id AND a.participant_code = v_code;

  -- Najnowsze odsłonięte pytanie (z poprawną odpowiedzią) — tylko po bramce.
  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    IF v_final THEN
      v_rev := jsonb_array_length(v_items) - 1;
    ELSIF v_has_pos THEN
      v_rev := CASE WHEN v_t >= (v_items->p.idx->>'c')::BIGINT + 1500 THEN p.idx
                    WHEN p.idx > 0 THEN p.idx - 1
                    ELSE NULL END;
    END IF;
    IF v_rev IS NOT NULL THEN
      SELECT q.ans INTO v_rev_ans FROM public.questions q
       WHERE q.id = (v_items->v_rev->>'id')::UUID;
      v_reveal := json_build_object('idx', v_rev, 'ans', v_rev_ans);
    END IF;
  END IF;

  RETURN json_build_object(
    'server_now',    v_now_ms,
    'error',         NULL,
    'session',       v_session,
    'position',      v_position,
    'plan',          v_plan,
    'my_answers',    v_my,
    'reveal',        v_reveal,
    'correct_total', COALESCE(v_correct, 0));
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_participant_state(TEXT, UUID, BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_participant_state(TEXT, UUID, BOOLEAN) TO anon, authenticated;

-- 39.6c — get_answer_summary_v2: licznik odpowiedzi + bramkowana poprawność.
-- Sesja bez planu → stara get_admin_answer_summary (zachowanie bez zmian).
-- total zawsze; correct i ans tylko dla admina, po końcu sesji lub gdy t_eff ≥ c + 1500.
CREATE OR REPLACE FUNCTION public.get_answer_summary_v2(p_session_id UUID, p_question_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s        public.quiz_sessions%ROWTYPE;
  v_items  JSONB;
  v_item   JSONB;
  v_admin  BOOLEAN;
  v_open   BOOLEAN;
  v_t      NUMERIC;
  v_total  INT;
  v_correct INT;
  v_ans    INT;
BEGIN
  SELECT * INTO s FROM public.quiz_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN json_build_object('total', 0, 'correct', NULL, 'ans', NULL);
  END IF;
  IF s.plan_anchor_at IS NULL THEN
    RETURN public.get_admin_answer_summary(p_session_id, p_question_id);
  END IF;

  v_admin := COALESCE(public.get_my_role(), '') IN ('city_admin','superadmin');
  SELECT sp.items INTO v_items FROM public.session_plans sp WHERE sp.session_id = p_session_id;
  SELECT e INTO v_item FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) e
   WHERE (e->>'id')::UUID = p_question_id LIMIT 1;
  v_t := EXTRACT(epoch FROM (COALESCE(s.plan_paused_at, clock_timestamp()) - s.plan_anchor_at)) * 1000;
  v_open := COALESCE(
    v_admin
    OR s.status IN ('results','ended')
    OR (v_item IS NOT NULL AND v_t >= (v_item->>'c')::BIGINT + 1500),
    false);

  SELECT COUNT(*)::INT, COUNT(*) FILTER (WHERE a.is_correct = true)::INT
    INTO v_total, v_correct
    FROM public.answers a
   WHERE a.session_id = p_session_id AND a.question_id = p_question_id;
  IF v_open THEN
    SELECT q.ans INTO v_ans FROM public.questions q WHERE q.id = p_question_id;
  END IF;

  RETURN json_build_object(
    'total',   COALESCE(v_total, 0),
    'correct', CASE WHEN v_open THEN v_correct ELSE NULL END,
    'ans',     CASE WHEN v_open THEN v_ans ELSE NULL END);
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_answer_summary_v2(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_answer_summary_v2(UUID, UUID) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
--  Done. Verify by checking that no errors appeared above.
-- ════════════════════════════════════════════════════════════════

