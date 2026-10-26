# Quick 261026-o0s — CLI bazy przez Management API — PODSUMOWANIE

**Commit:** `9edb3c9`

## Co powstało
- `scripts/lib/db-cli.js` — czyste funkcje (`parseEnv`, `upsertEnv`, `projectRefFromUrl`, `extractSection`, `isReadOnlySql`, `parseArgs`), testy `scripts/lib/db-cli.test.js` (10).
- `scripts/db.js` — podkomendy `login`, `status`, `query`, `sql` przez `https://api.supabase.com/v1` (`POST /projects/{ref}/database/query`).
- `package.json`: `db:login`, `db:status`, `db:query`, `db:sql` (zwykły `node`, bez vite-node).

## Zasady bezpieczeństwa
- Token `SUPABASE_ACCESS_TOKEN` tylko w `.env` (w `.gitignore`); token daje dostęp do wszystkich projektów konta.
- Domyślnie produkcja; `--stage` = `VITE_SUPABASE_URL_STAGE`.
- Zapis na prod (każde `db:sql` i `db:query`, które nie jest czystym SELECT/WITH) wymaga wpisania `PROD`; `--yes` pomija pytanie. Bez terminala (TTY) pytanie zwraca pustą odpowiedź → przerwanie.
- `db:sql` najpierw pokazuje podgląd (pierwsze 15 linii), token sprawdza dopiero potem.

## Weryfikacja
- `npm test` — 371/371 (21 plików).
- Bez tokenu: `db:status` / `db:query` / `db:sql` → „Brak SUPABASE_ACCESS_TOKEN — uruchom najpierw: npm run db:login”, nic nie wysłane.
- `db:sql -- --section 45` → podgląd linii 3040–3062 `SUPABASE_FIXES.sql` (dokładnie sekcja 45).
- Wywołanie API z prawdziwym tokenem — niesprawdzone (token tworzy użytkownik przez `npm run db:login`).
