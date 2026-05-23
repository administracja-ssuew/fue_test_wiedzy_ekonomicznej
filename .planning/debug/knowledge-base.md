# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## admin-brak-profilu — RLS infinite recursion on profiles table blocks admin login
- **Date:** 2026-05-23
- **Error patterns:** infinite recursion, profiles, get_my_role, RLS, Brak profilu admina, SECURITY DEFINER, policy, superadmin, profiles_superadmin
- **Root cause:** Live Supabase DB had get_my_role() defined WITHOUT SECURITY DEFINER. The profiles_superadmin RLS policy calls get_my_role() which queries the profiles table. PostgreSQL evaluates ALL applicable RLS policies (not short-circuit), so every SELECT on profiles triggers profiles_superadmin → get_my_role() → SELECT FROM profiles → RLS again → infinite recursion. Postgres throws "infinite recursion detected in policy for relation 'profiles'" which surfaces as pErr in loginAdmin() → "Brak profilu admina." error.
- **Fix:** Re-run CREATE OR REPLACE FUNCTION public.get_my_role() with SECURITY DEFINER and SET search_path = public in Supabase SQL Editor. SECURITY DEFINER makes the function run with the owner's privileges, bypassing RLS for the function's own query and breaking the recursion. Same fix needed for get_my_city(). The schema file SUPABASE_SCHEMA.sql already had the correct definition — the live DB simply hadn't been updated.
- **Files changed:** SUPABASE_SCHEMA.sql (added SET search_path = public and explanatory comment; SECURITY DEFINER was already present)
---
