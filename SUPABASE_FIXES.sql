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

-- ════════════════════════════════════════════════════════════════
--  Done. Verify by checking that no errors appeared above.
-- ════════════════════════════════════════════════════════════════

