-- ════════════════════════════════════════════════════════════════
--  FUE Quiz — Supabase Schema v2
--  Run in: Supabase Dashboard → SQL Editor → Run
--  Run this AFTER setting JWT Expiry to 14400s in Auth settings.
-- ════════════════════════════════════════════════════════════════

-- ─── SECURITY DEFINER HELPERS (avoids RLS recursion) ────────────

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_city()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT city FROM public.profiles WHERE id = auth.uid()
$$;

-- ─── PROFILES ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name    TEXT NOT NULL,
  city         TEXT NOT NULL,
  university   TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'participant'
                 CHECK (role IN ('participant', 'city_admin', 'global_admin')),
  verified     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_own_select"  ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_own_insert"  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_own_update"  ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "profiles_city_admin_select" ON public.profiles FOR SELECT
  USING (get_my_role() = 'city_admin' AND city = get_my_city());

CREATE POLICY "profiles_city_admin_update" ON public.profiles FOR UPDATE
  USING (get_my_role() = 'city_admin' AND city = get_my_city());

CREATE POLICY "profiles_city_admin_delete" ON public.profiles FOR DELETE
  USING (get_my_role() = 'city_admin' AND city = get_my_city());

CREATE POLICY "profiles_global_admin" ON public.profiles FOR ALL
  USING (get_my_role() = 'global_admin');

-- ─── QUIZ SESSIONS ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quiz_sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code              CHAR(6) UNIQUE NOT NULL,
  stage                  TEXT NOT NULL CHECK (stage IN ('regional', 'national')),
  city                   TEXT,
  status                 TEXT NOT NULL DEFAULT 'waiting'
                           CHECK (status IN ('waiting', 'active', 'question_open', 'question_closed', 'results', 'podium', 'finished')),
  current_question_index INT NOT NULL DEFAULT 0,
  q_started_at           TIMESTAMPTZ,
  created_by             UUID REFERENCES public.profiles(id),
  created_at             TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.quiz_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_all"    ON public.quiz_sessions FOR SELECT USING (true);
CREATE POLICY "sessions_admin_insert"  ON public.quiz_sessions FOR INSERT
  WITH CHECK (get_my_role() IN ('city_admin', 'global_admin'));
CREATE POLICY "sessions_admin_update"  ON public.quiz_sessions FOR UPDATE
  USING (get_my_role() IN ('city_admin', 'global_admin'));
CREATE POLICY "sessions_admin_delete"  ON public.quiz_sessions FOR DELETE
  USING (get_my_role() IN ('city_admin', 'global_admin'));

-- ─── PARTICIPANTS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.participants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID REFERENCES public.quiz_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  joined_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, user_id)
);

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participants_own"        ON public.participants FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "participants_admin_read" ON public.participants FOR SELECT
  USING (get_my_role() IN ('city_admin', 'global_admin'));

-- ─── ANSWERS (structure only — populated in Phase 3) ────────────

CREATE TABLE IF NOT EXISTS public.answers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID REFERENCES public.quiz_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id       UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  question_id   TEXT NOT NULL,
  chosen        INT,
  is_correct    BOOLEAN,
  response_time FLOAT,
  points        INT NOT NULL DEFAULT 0,
  answered_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, user_id, question_id)
);

ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "answers_own"         ON public.answers FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "answers_admin_read"  ON public.answers FOR SELECT
  USING (get_my_role() IN ('city_admin', 'global_admin'));

-- ─── GRANT PERMISSIONS ──────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_city() TO authenticated;

-- ─── PROMOTE USER TO ADMIN (run manually after first user registers) ──
-- UPDATE public.profiles SET role = 'global_admin' WHERE id = 'YOUR_USER_UUID';
-- UPDATE public.profiles SET role = 'city_admin'   WHERE id = 'YOUR_USER_UUID';
