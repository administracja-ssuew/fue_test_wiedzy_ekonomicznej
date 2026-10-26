/**
 * FUE Quiz — CLI bazy przez Supabase Management API (bez Supabase CLI, psql i hasła do bazy)
 *
 *   npm run db:login                          zapisuje osobisty token dostępu do .env
 *   npm run db:status [-- --stage]            projekt, Postgres, wgrane sekcje, połączenia
 *   npm run db:query -- "select ..." [--stage]
 *   npm run db:sql -- --section 45 [--stage]  sekcja N z SUPABASE_FIXES.sql
 *   npm run db:sql -- plik.sql [--stage]
 *
 * Token (SUPABASE_ACCESS_TOKEN, „sbp_…”) z https://supabase.com/dashboard/account/tokens — daje
 * pełny dostęp do WSZYSTKICH projektów konta; trzymany tylko w .env (plik w .gitignore).
 * Domyślnie produkcja (VITE_SUPABASE_URL); --stage = VITE_SUPABASE_URL_STAGE.
 * Zapis na produkcję wymaga wpisania „PROD” (albo --yes, gdy potwierdzenie padło wcześniej).
 *
 * Kody wyjścia: 0 = OK, 1 = błąd / odmowa / brak tokenu.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseEnv, upsertEnv, projectRefFromUrl, extractSection, isReadOnlySql, parseArgs } from "./lib/db-cli.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const API = "https://api.supabase.com/v1";

const readEnvFile = () => (fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "");
const env = { ...parseEnv(readEnvFile()), ...process.env };

async function ask(question) {
  if (!process.stdin.isTTY) return "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

async function api(token, method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === "object" ? data.message || data.error || JSON.stringify(data) : String(data).slice(0, 300);
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return data;
}

function target(stage) {
  const url = stage ? env.VITE_SUPABASE_URL_STAGE : env.VITE_SUPABASE_URL;
  const ref = projectRefFromUrl(url);
  if (!ref) throw new Error(`Brak ${stage ? "VITE_SUPABASE_URL_STAGE" : "VITE_SUPABASE_URL"} w .env`);
  return { ref, label: stage ? "🧪 TEST" : "🌐 PRODUKCJA", prod: !stage };
}

function token() {
  const t = env.SUPABASE_ACCESS_TOKEN;
  if (!t) throw new Error("Brak SUPABASE_ACCESS_TOKEN — uruchom najpierw: npm run db:login");
  return t;
}

const runSql = (t, ref, query) => api(t, "POST", `/projects/${ref}/database/query`, { query });

async function confirmProd(tg, yes) {
  if (!tg.prod || yes) return true;
  const a = await ask(`\n⚠️  To zmienia PRODUKCJĘ (${tg.ref}). Wpisz PROD, żeby wykonać: `);
  return a === "PROD";
}

function printRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return console.log("(brak wierszy)");
  console.table(rows);
  console.log(`${rows.length} wiersz(y)`);
}

// ─── Podkomendy ───────────────────────────────────────────────────────────────

async function cmdLogin() {
  console.log("Utwórz token: https://supabase.com/dashboard/account/tokens (nazwa np. „fue-quiz CLI”).");
  const t = await ask("Wklej token (sbp_…): ");
  if (!t) throw new Error("Nie podano tokenu (uruchom w zwykłym terminalu, nie w tle).");
  const projects = await api(t, "GET", "/projects");
  fs.writeFileSync(ENV_PATH, upsertEnv(readEnvFile(), "SUPABASE_ACCESS_TOKEN", t));
  console.log(`\n✅ Token działa, zapisany w .env. Projekty na koncie (${projects.length}):`);
  for (const p of projects) console.log(`  - ${p.name}  (${p.id}, ${p.region}, ${p.status})`);
  const known = [projectRefFromUrl(env.VITE_SUPABASE_URL), projectRefFromUrl(env.VITE_SUPABASE_URL_STAGE)].filter(Boolean);
  for (const ref of known) if (!projects.some((p) => p.id === ref)) console.log(`⚠️  Projekt ${ref} z .env NIE jest dostępny tym tokenem.`);
}

async function cmdStatus(a) {
  const t = token(), tg = target(a.stage);
  const p = await api(t, "GET", `/projects/${tg.ref}`);
  console.log(`\n${tg.label}: ${p.name} (${tg.ref}) — ${p.region}, stan: ${p.status}`);
  const [info] = await runSql(t, tg.ref,
    `select split_part(version(), ' ', 2) as postgres,
            (select count(*) from pg_stat_activity) as polaczenia,
            (select setting from pg_settings where name = 'max_connections') as max_polaczen,
            (select string_agg(substring(proname from 15), ',' order by substring(proname from 15)::int)
               from pg_proc where proname ~ '^schema_marker_[0-9]+$') as sekcje`);
  console.log(`Postgres ${info.postgres} · połączenia ${info.polaczenia}/${info.max_polaczen}`);
  console.log(`Wgrane sekcje (schema_marker_*): ${info.sekcje || "—"}`);
}

async function cmdQuery(a) {
  const sql = a.rest.join(" ").trim();
  if (!sql) throw new Error('Podaj zapytanie: npm run db:query -- "select 1"');
  const t = token(), tg = target(a.stage);
  console.log(`${tg.label} (${tg.ref})`);
  if (!isReadOnlySql(sql) && !(await confirmProd(tg, a.yes))) throw new Error("Przerwane — nic nie wykonano.");
  printRows(await runSql(t, tg.ref, sql));
}

async function cmdSql(a) {
  let sql, what;
  if (a.section) {
    const s = extractSection(fs.readFileSync(path.join(ROOT, "SUPABASE_FIXES.sql"), "utf8"), a.section);
    if (!s) throw new Error(`Nie ma sekcji ${a.section} w SUPABASE_FIXES.sql`);
    sql = s.text; what = `sekcja ${a.section} (SUPABASE_FIXES.sql, linie ${s.from}–${s.to})`;
  } else if (a.rest[0]) {
    sql = fs.readFileSync(path.resolve(a.rest[0]), "utf8"); what = a.rest[0];
  } else throw new Error("Podaj plik albo --section N");

  const tg = target(a.stage);
  const lines = sql.split("\n");
  console.log(`${tg.label} (${tg.ref}) ← ${what}, ${lines.length} linii\n`);
  console.log(lines.slice(0, 15).map((l) => `  │ ${l}`).join("\n"));
  if (lines.length > 15) console.log(`  │ … (+${lines.length - 15} linii)`);
  const t = token();
  if (!(await confirmProd(tg, a.yes))) throw new Error("Przerwane — nic nie wykonano.");
  const res = await runSql(t, tg.ref, sql);
  console.log("\n✅ Wykonane.");
  if (Array.isArray(res) && res.length) printRows(res);
}

const HELP = `Użycie:
  npm run db:login
  npm run db:status [-- --stage]
  npm run db:query -- "select ..." [--stage] [--yes]
  npm run db:sql -- --section 45 [--stage] [--yes]
  npm run db:sql -- plik.sql [--stage] [--yes]`;

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmds = { login: cmdLogin, status: cmdStatus, query: cmdQuery, sql: cmdSql };
  if (!cmds[a.cmd]) { console.log(HELP); return a.cmd ? 1 : 0; }
  await cmds[a.cmd](a);
  return 0;
}

// process.exitCode zamiast process.exit(): na Windows process.exit() przy
// zamykanych uchwytach fetch/undici kończy się asercją libuv (kod 127).
main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error(`❌ ${e?.message || e}`); process.exitCode = 1; });
