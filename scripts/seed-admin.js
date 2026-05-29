/**
 * FUE Quiz — Seed staging admin
 *
 * Tworzy (idempotentnie) konto superadmina na projekcie STAGING, żeby npm run bot
 * mógł zalogować się i przetestować pełny przebieg quizu. Działa WYŁĄCZNIE na
 * stagingu (wymaga kluczy *_STAGE) — nigdy nie dotyka produkcji.
 *
 *   npm run seed-admin
 *
 * .env: VITE_SUPABASE_URL_STAGE, SUPABASE_SERVICE_KEY_STAGE
 */

import { createClient } from "@supabase/supabase-js";
import { MODULES } from "../src/data/questions.js";

const URL     = process.env.VITE_SUPABASE_URL_STAGE;
const SERVICE = process.env.SUPABASE_SERVICE_KEY_STAGE;
const EMAIL    = process.env.SEED_ADMIN_EMAIL    || "bot-admin@fue-staging.local";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "BotAdmin12345!";

if (!URL || !SERVICE) {
  console.error("❌ Brak VITE_SUPABASE_URL_STAGE / SUPABASE_SERVICE_KEY_STAGE w .env.");
  console.error("   seed-admin działa tylko na stagingu — nie podpinam produkcji.");
  process.exit(1);
}

const supa = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function main() {
  console.log(`🌐 STAGING: ${URL}`);
  let userId;

  const { data: created, error } = await supa.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  });
  if (error) {
    // Prawdopodobnie już istnieje — znajdź i odśwież hasło.
    const { data: list } = await supa.auth.admin.listUsers({ page: 1, perPage: 200 });
    const u = list?.users?.find((x) => x.email === EMAIL);
    if (!u) { console.error("❌ createUser:", error.message); process.exit(1); }
    userId = u.id;
    await supa.auth.admin.updateUserById(userId, { password: PASSWORD, email_confirm: true });
    console.log("ℹ️  Użytkownik istniał — zaktualizowano hasło.");
  } else {
    userId = created.user.id;
    console.log("✅ Utworzono użytkownika auth.");
  }

  const { error: pErr } = await supa.from("profiles")
    .upsert({ id: userId, full_name: "Bot Admin (staging)", city: null, role: "superadmin" });
  if (pErr) { console.error("❌ profiles upsert:", pErr.message); process.exit(1); }
  console.log(`✅ Superadmin gotowy:\n   email:    ${EMAIL}\n   password: ${PASSWORD}`);

  // Zasiej moduły (na świeżym stagingu tabela modules jest pusta → app używa
  // fallbacku, ale npm run bot testuje CRUD modułów na realnych wierszach).
  const rows = MODULES.map((m) => ({
    id: m.id, name: m.name, icon: m.icon, color: m.color,
    time_per_q: m.timePerQ, description: m.desc, sort_order: m.id,
  }));
  const { error: mErr } = await supa.from("modules").upsert(rows);
  if (mErr) console.error("⚠️  modules upsert:", mErr.message);
  else console.log(`✅ Moduły zasiane/zaktualizowane: ${rows.length}`);
}

main().catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
