/**
 * FUE Quiz — Odtworzenie kont adminów na świeżym projekcie Supabase
 *
 * Tworzy (idempotentnie) konta w Authentication + wiersze w public.profiles oraz
 * zasiewa tabelę modules. Potrzebne po założeniu NOWEGO projektu Supabase — stare
 * UUID-y adminów nie mają znaczenia, bo profiles.id to FK do auth.users.id, a nowy
 * projekt nadaje nowe identyfikatory. Skrypt mapuje po EMAILU i podpina świeże UUID.
 *
 *   1. Skopiuj scripts/admins.local.example.json → scripts/admins.local.json
 *      i wypełnij realnymi danymi (plik jest w .gitignore — hasła NIE trafiają do repo).
 *   2. Upewnij się, że w .env są VITE_SUPABASE_URL i SUPABASE_SERVICE_KEY nowego projektu.
 *   3. npm run seed-admins          → podgląd (dry-run, nic nie zapisuje)
 *      npm run seed-admins -- --yes → faktyczny zapis
 *
 * UWAGA: celuje w projekt z VITE_SUPABASE_URL (czyli PRODUKCJĘ, jeśli tak masz w .env).
 * Dlatego wypisuje adres i wymaga jawnego --yes.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { MODULES, CITIES } from "../src/data/questions.js";

const URL     = process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const CONFIRM = process.argv.includes("--yes");

if (!URL || !SERVICE) {
  console.error("❌ Brak VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY w .env.");
  console.error("   Service key: Supabase → Project Settings → API → service_role (secret).");
  process.exit(1);
}

const here    = dirname(fileURLToPath(import.meta.url));
const cfgPath = resolve(here, "admins.local.json");

let admins;
try {
  admins = JSON.parse(readFileSync(cfgPath, "utf8"));
} catch (e) {
  console.error(`❌ Nie mogę odczytać ${cfgPath}`);
  console.error("   Skopiuj scripts/admins.local.example.json → scripts/admins.local.json i uzupełnij dane.");
  process.exit(1);
}

// ─── Walidacja konfiguracji (zanim cokolwiek dotkniemy w bazie) ───────────────
const CITY_NAMES = CITIES.map((c) => c.name);
const problems = [];
if (!Array.isArray(admins) || !admins.length) problems.push("plik musi zawierać niepustą tablicę adminów");
admins.forEach((a, i) => {
  const at = `admins[${i}] (${a?.email || "brak email"})`;
  if (!a?.email || !a.email.includes("@"))       problems.push(`${at}: brak poprawnego email`);
  if (!a?.password || a.password.length < 8)     problems.push(`${at}: hasło musi mieć min. 8 znaków`);
  if (!a?.full_name)                             problems.push(`${at}: brak full_name`);
  if (!["city_admin", "superadmin"].includes(a?.role))
    problems.push(`${at}: role musi być 'city_admin' lub 'superadmin' (CHECK w schemacie)`);
  if (a?.role === "city_admin" && !CITY_NAMES.includes(a?.city))
    problems.push(`${at}: city musi być dokładnie jednym z: ${CITY_NAMES.join(", ")}`);
  if (a?.role === "superadmin" && a?.city != null)
    problems.push(`${at}: superadmin musi mieć city = null (NULL = wszystkie miasta)`);
});
const dupes = admins.map((a) => a?.email).filter((e, i, arr) => e && arr.indexOf(e) !== i);
if (dupes.length) problems.push(`zduplikowane emaile: ${[...new Set(dupes)].join(", ")}`);

if (problems.length) {
  console.error("❌ Błędy w scripts/admins.local.json:");
  problems.forEach((p) => console.error(`   • ${p}`));
  process.exit(1);
}

const supa = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function findUserByEmail(email) {
  // supabase-js v2 nie ma getUserByEmail — przeglądamy strony listUsers.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (!data?.users?.length || data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  console.log(`🌐 Cel: ${URL}`);
  console.log(`👥 Adminów w konfiguracji: ${admins.length}`);
  admins.forEach((a) => console.log(`   • ${a.email} — ${a.role}${a.city ? ` (${a.city})` : " (wszystkie miasta)"}`));

  if (!CONFIRM) {
    console.log("\n🔍 DRY-RUN — nic nie zapisano. Konfiguracja wygląda poprawnie.");
    console.log("   Uruchom ponownie z --yes, aby zapisać:  npm run seed-admins -- --yes");
    return;
  }

  // ─── Moduły ────────────────────────────────────────────────────────────────
  // OBOWIĄZKOWE na świeżym projekcie: submit_answer waliduje okno czasu przez
  // COALESCE(modules.time_per_q, 60). Pusta tabela = 60 s dla każdego modułu, więc
  // w module 1 (90 s) serwer odrzucałby odpowiedzi po 60 s mimo widocznego czasu.
  const moduleRows = MODULES.map((m) => ({
    id: m.id, name: m.name, icon: m.icon, color: m.color,
    time_per_q: m.timePerQ, description: m.desc, sort_order: m.id,
  }));
  const { error: mErr } = await supa.from("modules").upsert(moduleRows);
  if (mErr) { console.error("❌ modules upsert:", mErr.message); process.exit(1); }
  console.log(`\n✅ Moduły zasiane: ${moduleRows.length} (${MODULES.map((m) => `${m.id}:${m.timePerQ}s`).join(", ")})`);

  // ─── Konta + profile ───────────────────────────────────────────────────────
  let created = 0, updated = 0;
  for (const a of admins) {
    let userId;
    const { data: madeUser, error: cErr } = await supa.auth.admin.createUser({
      email: a.email, password: a.password, email_confirm: true,
    });

    if (cErr) {
      const existing = await findUserByEmail(a.email);
      if (!existing) { console.error(`❌ ${a.email}: ${cErr.message}`); process.exit(1); }
      userId = existing.id;
      const { error: uErr } = await supa.auth.admin.updateUserById(userId, {
        password: a.password, email_confirm: true,
      });
      if (uErr) { console.error(`❌ ${a.email} update: ${uErr.message}`); process.exit(1); }
      updated++;
      console.log(`ℹ️  ${a.email} — konto istniało, zaktualizowano hasło`);
    } else {
      userId = madeUser.user.id;
      created++;
      console.log(`✅ ${a.email} — utworzono konto`);
    }

    // Service role omija RLS, a trigger prevent_profile_privilege_change przepuszcza
    // kontekst serwerowy (auth.uid() IS NULL) — upsert roli/miasta działa.
    const { error: pErr } = await supa.from("profiles").upsert({
      id: userId, full_name: a.full_name, city: a.city ?? null, role: a.role,
    });
    if (pErr) { console.error(`❌ ${a.email} profiles: ${pErr.message}`); process.exit(1); }
    console.log(`   ↳ profil: ${a.role}${a.city ? ` / ${a.city}` : " / wszystkie miasta"} (uid ${userId})`);
  }

  console.log(`\n🎉 Gotowe. Utworzono: ${created}, zaktualizowano: ${updated}.`);
  console.log("   Zweryfikuj logowanie w aplikacji, a potem ZMIEŃ HASŁA użyte przy seedowaniu.");
}

main().catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
