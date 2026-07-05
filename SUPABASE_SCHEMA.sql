-- ════════════════════════════════════════════════════════════════
--  FUE Quiz — Supabase Schema v3
--  Run in: Supabase Dashboard → SQL Editor → Run
-- ════════════════════════════════════════════════════════════════

-- Pozwól tworzyć funkcje, które odwołują się do tabel definiowanych NIŻEJ
-- (get_my_role/get_my_city używają public.profiles, która powstaje dalej).
-- Bez tego świeża baza wywala: relation "public.profiles" does not exist.
-- Ciało funkcji i tak waliduje się przy wywołaniu — wtedy tabela już istnieje.
SET check_function_bodies = off;

-- ─── HELPERS ─────────────────────────────────────────────────────
-- IMPORTANT: SECURITY DEFINER is required on both functions.
-- Without it, calling get_my_role() inside an RLS policy on "profiles"
-- causes infinite recursion (Postgres evaluates ALL policies, not short-circuit).
-- SET search_path = public prevents search_path injection with SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_city()
RETURNS TEXT LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT city FROM public.profiles WHERE id = auth.uid()
$$;

-- ─── PROFILES (admins only — no participant accounts) ─────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id        UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  city      TEXT,  -- NULL = superadmin (all cities), set for city_admin
  role      TEXT NOT NULL DEFAULT 'city_admin'
              CHECK (role IN ('city_admin', 'superadmin')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- UWAGA BEZPIECZEŃSTWA: NIE nadawaj "FOR ALL USING (auth.uid() = id)" — pozwalałoby to
-- każdemu adminowi zmienić własną rolę na 'superadmin' (UPDATE własnego wiersza).
-- SELECT: własny wiersz (superadmin widzi wszystkie). Pełny zapis: tylko superadmin.
-- Trigger blokuje zmianę role/city przez nie-superadmina (obrona w głąb). Patrz też
-- sekcja 35 w SUPABASE_FIXES.sql.
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
-- wywołującego (w DEFINER bywa NULL, co przepuściłoby eskalację).
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

-- ─── PARTICIPANT CODES ────────────────────────────────────────────
-- Admin generates a code per participant (name + city).
-- No Supabase auth for participants.

CREATE TABLE IF NOT EXISTS public.participant_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT UNIQUE NOT NULL,               -- e.g. 'KRK-4829'
  name       TEXT NOT NULL,
  surname    TEXT NOT NULL,
  city       TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  used       BOOLEAN NOT NULL DEFAULT false,
  session_id UUID,                               -- filled when participant joins
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.participant_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "codes_public_read"  ON public.participant_codes;
DROP POLICY IF EXISTS "codes_admin_insert" ON public.participant_codes;
DROP POLICY IF EXISTS "codes_admin_update" ON public.participant_codes;
DROP POLICY IF EXISTS "codes_admin_delete" ON public.participant_codes;
CREATE POLICY "codes_public_read"   ON public.participant_codes FOR SELECT USING (true);
CREATE POLICY "codes_admin_insert"  ON public.participant_codes FOR INSERT
  WITH CHECK (get_my_role() IN ('city_admin', 'superadmin'));
CREATE POLICY "codes_admin_update"  ON public.participant_codes FOR UPDATE
  USING (get_my_role() IN ('city_admin', 'superadmin'));
CREATE POLICY "codes_admin_delete"  ON public.participant_codes FOR DELETE
  USING (get_my_role() IN ('city_admin', 'superadmin'));

-- ─── QUESTIONS ────────────────────────────────────────────────────
-- Each city has its own question bank managed by its admin.

CREATE TABLE IF NOT EXISTS public.questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city        TEXT NOT NULL,
  module      INT NOT NULL CHECK (module BETWEEN 1 AND 5),
  q           TEXT NOT NULL,
  opts        TEXT[] NOT NULL,
  ans         INT NOT NULL CHECK (ans BETWEEN 0 AND 3),
  exp         TEXT,
  is_practice BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Migrations for existing installations:
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT false;
-- Fix module constraint to allow module 5 (Aktualności gospodarcze):
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_module_check;
ALTER TABLE public.questions ADD CONSTRAINT questions_module_check CHECK (module BETWEEN 1 AND 5);

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "questions_admin_select"      ON public.questions;
DROP POLICY IF EXISTS "questions_city_admin_write"  ON public.questions;
DROP POLICY IF EXISTS "questions_superadmin"        ON public.questions;
DROP POLICY IF EXISTS "questions_anon_select"       ON public.questions;
CREATE POLICY "questions_anon_select"       ON public.questions FOR SELECT USING (true);
CREATE POLICY "questions_admin_select"      ON public.questions FOR SELECT
  USING (get_my_role() IN ('city_admin', 'superadmin'));
CREATE POLICY "questions_city_admin_write"  ON public.questions FOR ALL
  USING (get_my_role() = 'city_admin' AND city = get_my_city());
CREATE POLICY "questions_superadmin"        ON public.questions FOR ALL
  USING (get_my_role() = 'superadmin');
GRANT SELECT ON public.questions TO anon;

-- ─── QUIZ SESSIONS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quiz_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'waiting'
                          CHECK (status IN ('waiting','running','paused','results','ended')),
  current_question_idx  INT NOT NULL DEFAULT 0,
  q_started_at          TIMESTAMPTZ,
  is_practice           BOOLEAN NOT NULL DEFAULT false,
  bg                    TEXT,                        -- per-city background (desktop)
  bg_mobile             TEXT,                        -- per-city background (mobile, falls back to bg)
  created_by            UUID REFERENCES public.profiles(id),
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Migrations for existing databases (idempotent — safe to run on any installation):
ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS bg TEXT;
ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS bg_mobile TEXT;

ALTER TABLE public.quiz_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_select_all"  ON public.quiz_sessions;
DROP POLICY IF EXISTS "sessions_admin_write" ON public.quiz_sessions;
CREATE POLICY "sessions_select_all"   ON public.quiz_sessions FOR SELECT USING (true);
CREATE POLICY "sessions_admin_write"  ON public.quiz_sessions FOR ALL
  USING (get_my_role() IN ('city_admin', 'superadmin'));

-- ─── ANSWERS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.answers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID REFERENCES public.quiz_sessions(id) ON DELETE CASCADE NOT NULL,
  participant_code TEXT NOT NULL,                -- references participant_codes.code
  participant_name TEXT NOT NULL,
  city            TEXT NOT NULL,
  question_id     UUID REFERENCES public.questions(id),
  module          INT,
  chosen          INT,
  is_correct      BOOLEAN,
  points          INT NOT NULL DEFAULT 0,
  answered_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, participant_code, question_id)
);

DO $$ BEGIN
  ALTER TABLE public.answers ADD CONSTRAINT answers_points_range CHECK (points BETWEEN 0 AND 1000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migration: add response time column (seconds from question start to answer)
ALTER TABLE public.answers ADD COLUMN IF NOT EXISTS response_time_s INT;

ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "answers_public_insert" ON public.answers;
DROP POLICY IF EXISTS "answers_admin_select"  ON public.answers;
CREATE POLICY "answers_public_insert" ON public.answers FOR INSERT WITH CHECK (true);
CREATE POLICY "answers_admin_select"  ON public.answers FOR SELECT
  USING (get_my_role() IN ('city_admin', 'superadmin'));

-- ─── VIOLATIONS (anti-cheat) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.violations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_code TEXT NOT NULL,
  session_id       UUID REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('tab_switch','screenshot_attempt')),
  count            INT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.violations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "violations_anon_insert"  ON public.violations;
DROP POLICY IF EXISTS "violations_admin_select" ON public.violations;
-- Allow any code that exists in participant_codes (not requiring used=true to avoid circular dependency).
CREATE POLICY "violations_anon_insert"  ON public.violations FOR INSERT
  WITH CHECK (participant_code IN (SELECT code FROM public.participant_codes));
CREATE POLICY "violations_admin_select" ON public.violations FOR SELECT
  USING (get_my_role() IN ('city_admin', 'superadmin'));

GRANT INSERT ON public.violations TO anon;

-- ─── MODULES (dynamic — overrides hardcoded fallback) ────────────

CREATE TABLE IF NOT EXISTS public.modules (
  id          INT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '📚',
  color       TEXT NOT NULL DEFAULT '#6B21E8',
  time_per_q  INT  NOT NULL DEFAULT 60,
  description TEXT,
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "modules_admin_all"   ON public.modules;
DROP POLICY IF EXISTS "modules_anon_select" ON public.modules;
CREATE POLICY "modules_anon_select" ON public.modules FOR SELECT USING (true);
CREATE POLICY "modules_admin_all"   ON public.modules FOR ALL
  USING (get_my_role() IN ('city_admin', 'superadmin'));

GRANT SELECT ON public.modules TO anon;

-- ─── INDEXES (performance for 500 concurrent users) ──────────────

CREATE INDEX IF NOT EXISTS idx_answers_session_question
  ON public.answers(session_id, question_id);
CREATE INDEX IF NOT EXISTS idx_answers_session_participant
  ON public.answers(session_id, participant_code);
CREATE INDEX IF NOT EXISTS idx_participant_codes_city_used
  ON public.participant_codes(city, used);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_city_status
  ON public.quiz_sessions(city, status);

-- ─── REALTIME ─────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='quiz_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_sessions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='participant_codes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.participant_codes;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='violations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.violations;
  END IF;
END $$;

-- ─── RPC FUNCTIONS ───────────────────────────────────────────────

-- Allows anon participants to mark their code as used when joining the lobby.
-- Direct UPDATE is blocked by RLS (only admins can update); SECURITY DEFINER bypasses it.
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

-- Returns aggregated session results (one row per participant).
-- Uses SECURITY DEFINER to bypass RLS row-count limits on answers table.
CREATE OR REPLACE FUNCTION public.get_session_results(p_session_id UUID)
RETURNS TABLE (
  participant_code      TEXT,
  participant_name      TEXT,
  city                  TEXT,
  total_points          BIGINT,
  avg_response_time_s   INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    participant_code,
    participant_name,
    city,
    SUM(points)::BIGINT AS total_points,
    ROUND(AVG(response_time_s))::INT AS avg_response_time_s
  FROM public.answers
  WHERE session_id = p_session_id
  GROUP BY participant_code, participant_name, city
  ORDER BY total_points DESC, avg_response_time_s ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_session_results(UUID) TO authenticated, anon;

-- Advances quiz to the next question using a server-generated timestamp.
-- Optimistic locking: only updates if current_question_idx matches expected_idx,
-- so exactly one client wins the race and all others are no-ops.
-- SECURITY DEFINER bypasses the sessions_admin_write RLS policy so anon participants
-- can call this; the function itself enforces business logic instead.
CREATE OR REPLACE FUNCTION public.advance_session_question(
  p_session_id    UUID,
  p_expected_idx  INT,   -- current index the caller thinks is active (optimistic lock)
  p_next_idx      INT    -- index to advance to
)
RETURNS TIMESTAMPTZ      -- returns the server-side q_started_at, or NULL if no-op
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  UPDATE public.quiz_sessions
  SET
    current_question_idx = p_next_idx,
    q_started_at         = v_now,
    status               = 'running'
  WHERE id                   = p_session_id
    AND current_question_idx = p_expected_idx   -- optimistic lock: only wins once
    AND status               = 'running';       -- only advance while quiz is active
  IF FOUND THEN
    RETURN v_now;
  ELSE
    RETURN NULL;  -- another client already advanced, caller should sync via Realtime
  END IF;
END;
$$;

-- ─── GRANTS ───────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.quiz_sessions TO anon;
GRANT SELECT ON public.participant_codes TO anon;
GRANT SELECT ON public.questions TO anon;
GRANT SELECT ON public.modules TO anon;
GRANT INSERT ON public.answers TO anon;
GRANT INSERT ON public.violations TO anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_city() TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_session_question(UUID, INT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_code_used(TEXT, UUID) TO anon, authenticated;

-- Starts the quiz from 'waiting' state, sets q_started_at using the server clock.
-- Using clock_timestamp() (not now()) ensures the timestamp reflects the actual
-- moment of the call, not the transaction start.
-- Called only by admin (authenticated); participants call advance_session_question.
CREATE OR REPLACE FUNCTION public.start_quiz_session(p_session_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE public.quiz_sessions
  SET status = 'running', q_started_at = v_now, current_question_idx = 0
  WHERE id = p_session_id AND status = 'waiting';
  IF FOUND THEN RETURN v_now; ELSE RETURN NULL; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_quiz_session(UUID) TO authenticated;

-- Returns only the answer count for a question — safe for anon (LiveView).
-- SECURITY DEFINER bypasses answers_admin_select RLS without exposing row data.
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

-- ─── SEED: create admin accounts manually in Supabase Auth, then: ─
-- INSERT INTO public.profiles(id, full_name, city, role)
--   VALUES ('UUID_FROM_AUTH', 'Jan Kowalski', 'Kraków', 'city_admin');
-- INSERT INTO public.profiles(id, full_name, city, role)
--   VALUES ('UUID_FROM_AUTH', 'Mikołaj Radliński', NULL, 'superadmin');
