-- ════════════════════════════════════════════════════════════════
--  FUE Quiz — Supabase Schema v3
--  Run in: Supabase Dashboard → SQL Editor → Run
-- ════════════════════════════════════════════════════════════════

-- ─── HELPERS ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_city()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
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

CREATE POLICY "profiles_own"       ON public.profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "profiles_superadmin" ON public.profiles FOR ALL USING (get_my_role() = 'superadmin');

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
  module      INT NOT NULL,
  q           TEXT NOT NULL,
  opts        TEXT[] NOT NULL,
  ans         INT NOT NULL CHECK (ans BETWEEN 0 AND 3),
  exp         TEXT,
  is_practice BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Add is_practice to existing installations:
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "questions_admin_select" ON public.questions FOR SELECT
  USING (get_my_role() IN ('city_admin', 'superadmin'));
CREATE POLICY "questions_city_admin_write" ON public.questions FOR ALL
  USING (get_my_role() = 'city_admin' AND city = get_my_city());
CREATE POLICY "questions_superadmin" ON public.questions FOR ALL
  USING (get_my_role() = 'superadmin');

-- ⚠️  APPLY IN SUPABASE SQL EDITOR if not already applied:
-- Allow anonymous participants to read questions (required for quiz to work)
CREATE POLICY "questions_anon_select" ON public.questions FOR SELECT USING (true);
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
  bg                    TEXT,                        -- per-city background gradient
  created_by            UUID REFERENCES public.profiles(id),
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- Migration for existing databases (run if table already exists):
-- ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT false;
-- ALTER TABLE public.quiz_sessions ADD COLUMN IF NOT EXISTS bg TEXT;

ALTER TABLE public.quiz_sessions ENABLE ROW LEVEL SECURITY;

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

-- ⚠️  APPLY IN SUPABASE SQL EDITOR if not already applied:
ALTER TABLE public.answers ADD CONSTRAINT answers_points_range CHECK (points BETWEEN 0 AND 1000);

ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

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

-- ⚠️  APPLY IN SUPABASE SQL EDITOR if not already applied:
CREATE POLICY "violations_anon_insert" ON public.violations FOR INSERT
  WITH CHECK (participant_code IN (SELECT code FROM public.participant_codes WHERE used = true));
CREATE POLICY "violations_admin_select"  ON public.violations FOR SELECT
  USING (get_my_role() IN ('city_admin', 'superadmin'));

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

CREATE POLICY "modules_admin_all" ON public.modules FOR ALL
  USING (get_my_role() IN ('city_admin', 'superadmin'));
CREATE POLICY "modules_anon_select" ON public.modules FOR SELECT
  USING (true);

GRANT SELECT ON public.modules TO anon;

-- ─── REALTIME ─────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='quiz_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_sessions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='participant_codes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.participant_codes;
  END IF;
END $$;

-- ─── GRANTS ───────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.quiz_sessions, public.participant_codes TO anon;
GRANT INSERT ON public.answers TO anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_city() TO authenticated;

-- ─── SEED: create admin accounts manually in Supabase Auth, then: ─
-- INSERT INTO public.profiles(id, full_name, city, role)
--   VALUES ('UUID_FROM_AUTH', 'Jan Kowalski', 'Kraków', 'city_admin');
-- INSERT INTO public.profiles(id, full_name, city, role)
--   VALUES ('UUID_FROM_AUTH', 'Mikołaj Radliński', NULL, 'superadmin');
