---
status: resolved
trigger: "Po zalogowaniu jako admin (email+hasło) pojawia się od razu 'Brak profilu admina.'"
created: 2026-05-23T00:00:00Z
updated: 2026-05-23T12:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — Live Supabase DB has get_my_role() WITHOUT SECURITY DEFINER. The schema file on disk already has SECURITY DEFINER, but the migration was never re-run against the live database. PostgreSQL evaluates ALL applicable RLS policies (not just the first passing one), so even a self-read (auth.uid() = id passes via profiles_own) still triggers evaluation of profiles_superadmin → get_my_role() → SELECT FROM profiles → RLS evaluated again → infinite recursion.
test: User confirmed actual Postgres error: "infinite recursion detected in policy for relation 'profiles'"
expecting: Re-running get_my_role() DDL with SECURITY DEFINER in Supabase SQL Editor will fix it
next_action: RESOLVED — user must run migration SQL in Supabase Dashboard

## Symptoms

expected: Admin loguje się i widzi Panel Admina
actual: Po zalogowaniu (auth OK, konto istnieje) pojawia się błąd "Brak profilu admina."
errors: "Brak profilu admina." — wyświetlany użytkownikowi po loginAdmin() gdy pErr != null
reproduction: Wpisz email+hasło admina → kliknij Zaloguj → od razu ten błąd
started: Niedawno; wcześniej coś "ruszyło" z adminem, potem pojawił się ten błąd

## Eliminated

- hypothesis: Tabela profiles nie istnieje lub ma inną nazwę
  evidence: SUPABASE_SCHEMA.sql definiuje CREATE TABLE IF NOT EXISTS public.profiles — tabela istnieje i ma kolumnę id UUID REFERENCES auth.users(id)
  timestamp: 2026-05-23

- hypothesis: Kolumna id w profiles nie odpowiada auth.users.id
  evidence: id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY — typ zgodny
  timestamp: 2026-05-23

## Evidence

- timestamp: 2026-05-23
  checked: src/lib/supabase.js loginAdmin() lines 22-27
  found: |
    Auth signInWithPassword → OK
    Then: supabase.from("profiles").select("*").eq("id", data.user.id).single()
    If pErr → returns { error: "Brak profilu admina." }
    The error string is confirmed to match reported symptom.
  implication: pErr is non-null — query fails. Two possible causes: (A) no row exists, (B) RLS blocks the query.

- timestamp: 2026-05-23
  checked: SUPABASE_SCHEMA.sql — profiles table RLS policies
  found: |
    Two policies on profiles:
    1. "profiles_own": FOR ALL USING (auth.uid() = id)
    2. "profiles_superadmin": FOR ALL USING (get_my_role() = 'superadmin')
    
    get_my_role() is defined as:
      SELECT role FROM public.profiles WHERE id = auth.uid()
    
    CRITICAL: get_my_role() queries the profiles table.
    The "profiles_superadmin" policy calls get_my_role() which queries profiles.
    PostgreSQL evaluates RLS policies when querying profiles.
    This creates an INFINITE RECURSION:
      Query profiles → evaluate policies → get_my_role() → query profiles → evaluate policies → ...
    
    However: "profiles_own" policy (auth.uid() = id) does NOT recurse.
    Postgres evaluates policies with OR — if either passes, access is granted.
    So for a city_admin or superadmin reading their OWN row: profiles_own should pass.
    RLS recursion would only bite for superadmin trying to read OTHER people's rows.
  implication: RLS recursion is NOT the cause for a user reading their own profile row. profiles_own (auth.uid() = id) handles self-reads without recursion.

- timestamp: 2026-05-23
  checked: useAuth.js — onAuthStateChange subscription
  found: |
    loginAdmin() calls supabase.auth.signInWithPassword().
    This FIRES onAuthStateChange with event="SIGNED_IN".
    useAuth's onAuthStateChange handler ALSO queries profiles:
      supabase.from("profiles").select("*").eq("id", session.user.id).single()
    This is a parallel read — not the cause of the login error.
    The loginAdmin() function does its own independent profiles query.
  implication: No interference, but two simultaneous profiles reads happen on login.

- timestamp: 2026-05-23
  checked: App.jsx line 321 — onSuccess callback
  found: |
    <AdminLogin onBack={...} onSuccess={(u) => setScreen("admin")} />
    onSuccess ignores the returned user data (u) and just sets screen to "admin".
    admin user comes from useAuth() hook, not from the loginAdmin() return value.
    So even if loginAdmin() fails and returns { error }, the onSuccess path only
    runs if no error — correct behavior.
  implication: The admin state doesn't depend on loginAdmin()'s returned data.
    The real admin object comes from useAuth() via onAuthStateChange.

- timestamp: 2026-05-23
  checked: Most probable root cause — missing profiles row
  found: |
    The SUPABASE_SCHEMA.sql SEED section says:
      -- INSERT INTO public.profiles(id, full_name, city, role)
      --   VALUES ('UUID_FROM_AUTH', 'Jan Kowalski', 'Kraków', 'city_admin');
    These are COMMENTED OUT. The schema does NOT auto-create profile rows.
    Admin accounts are created manually in Supabase Auth → then profile must be
    inserted manually. If this INSERT was never run, pErr will be:
      "JSON object requested, multiple (or no) rows returned" (PGRST116)
    which causes pErr to be non-null → "Brak profilu admina."
    
    Additionally: even if the row exists, there's one more scenario:
    Supabase .single() returns pErr when 0 rows are returned by the query.
    With RLS enabled, if the authenticated user's JWT is NOT yet propagated
    to auth.uid() at query time... but this is extremely unlikely.
    
    MOST LIKELY: The profiles row for this admin simply doesn't exist in the DB.
  implication: Root cause is almost certainly a missing INSERT in public.profiles.

- timestamp: 2026-05-23T12:00:00Z
  checked: Previous analysis of RLS recursion was wrong — re-evaluated after user confirmed actual Postgres error
  found: |
    User received real PostgreSQL error: "infinite recursion detected in policy for relation 'profiles'"
    
    Previous analysis dismissed RLS recursion because it assumed Postgres short-circuits
    policy evaluation when the first passing policy is found. THIS IS WRONG.
    PostgreSQL evaluates ALL applicable policies before granting access.
    
    The recursion chain:
      1. loginAdmin() queries profiles table
      2. Postgres evaluates ALL FOR ALL policies on profiles:
         - "profiles_own": auth.uid() = id  → no recursion, would pass
         - "profiles_superadmin": get_my_role() = 'superadmin'
             → get_my_role() executes: SELECT role FROM public.profiles WHERE id = auth.uid()
             → this triggers RLS evaluation on profiles AGAIN
             → both policies evaluated again → infinite loop → ERROR
      3. Postgres throws "infinite recursion detected" before returning any rows
      4. pErr is non-null → loginAdmin() returns { error: "Błąd bazy danych: ..." }
    
    SCHEMA FILE vs LIVE DB MISMATCH:
    SUPABASE_SCHEMA.sql lines 8-11 ALREADY has SECURITY DEFINER:
      CREATE OR REPLACE FUNCTION public.get_my_role()
      RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT role FROM public.profiles WHERE id = auth.uid()
      $$;
    
    The schema file is correct. The live Supabase database still has the OLD version
    of get_my_role() WITHOUT SECURITY DEFINER — the file was updated but the
    migration was never re-run against the live DB.
    
    SECURITY DEFINER makes the function execute with the OWNER's privileges (bypassing
    RLS entirely for the function's own query), which breaks the recursion.
  implication: TRUE root cause is the live DB having get_my_role() without SECURITY DEFINER.
    Fix: re-run the CREATE OR REPLACE FUNCTION statement in Supabase SQL Editor.
    No code changes needed — SUPABASE_SCHEMA.sql is already correct.

## Resolution

root_cause: |
  Live Supabase database has get_my_role() function defined WITHOUT SECURITY DEFINER.
  
  The "profiles_superadmin" RLS policy calls get_my_role() which executes
  SELECT FROM public.profiles. PostgreSQL evaluates ALL applicable RLS policies
  (not short-circuit), so even a simple self-read hits this recursion:
  
    Query profiles → evaluate policies → profiles_superadmin → get_my_role()
    → SELECT FROM profiles → evaluate policies → profiles_superadmin → ...
    → PostgreSQL throws: "infinite recursion detected in policy for relation 'profiles'"
  
  The schema file (SUPABASE_SCHEMA.sql) already has the correct SECURITY DEFINER
  definition, but the live database was never updated with this version of the function.
  SECURITY DEFINER causes the function to run with the owner's privileges, bypassing
  RLS for the function's own query, which breaks the recursion.

fix: |
  Run the following SQL in Supabase Dashboard → SQL Editor:
  
  -- Step 1: Fix the infinite recursion (PRIMARY FIX)
  CREATE OR REPLACE FUNCTION public.get_my_role()
  RETURNS TEXT LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid()
  $$;
  
  -- Also fix get_my_city() for consistency (same pattern, same risk)
  CREATE OR REPLACE FUNCTION public.get_my_city()
  RETURNS TEXT LANGUAGE sql STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT city FROM public.profiles WHERE id = auth.uid()
  $$;
  
  -- Step 2: If profiles row doesn't exist yet for your admin account, also run:
  -- (Replace values with actual admin data)
  INSERT INTO public.profiles (id, full_name, city, role)
  VALUES (
    (SELECT id FROM auth.users WHERE email = 'ADMIN_EMAIL_HERE'),
    'Imię Nazwisko',
    NULL,
    'superadmin'
  )
  ON CONFLICT (id) DO NOTHING;

verification: |
  After running the SQL migration:
  1. Open the app in browser
  2. Go to admin login
  3. Enter email + password
  4. Should land on Admin Panel without error
  
  SUPABASE_SCHEMA.sql already contains the correct SECURITY DEFINER definition —
  no changes needed to the schema file or any JS code.
  src/lib/supabase.js already uses .maybeSingle() (from a previous fix).

files_changed: []
