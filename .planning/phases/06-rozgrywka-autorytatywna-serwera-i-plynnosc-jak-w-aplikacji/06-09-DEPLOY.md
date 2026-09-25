# Faza 6 / Plan 09 — Bramka wdrożenia nowego frontu (DEPLOY)

**Status:** oczekuje na wdrożenie przez użytkownika (Task 1, checkpoint human-action)
**Przygotowano:** 2026-09-25

## Commit do wdrożenia

- **Ostatnia zmiana frontu (src/, public/, index.html, vite.config.js, package*.json, vercel.json):** `1c340e4` (fix(06-08): refresh bez mignięcia poczekalni i z blokadą odpowiedzi od pierwszej klatki)
- **Wdrażany commit (HEAD `main` w chwili pushu):** commit, który dodaje ten plik i `scripts/check-planless.js`. Względem `1c340e4` zmienia tylko dokumentację i skrypty, bundle jest identyczny. Dokładny hash wdrożenia wpisać po wdrożeniu.
- **Origin:** `origin/main` = `fdc3bee` (2026-09-24). Push na `main` wyśle wszystkie lokalne commity fazy 6 (17 z nich zmienia front).
- **Sposób wdrożenia:** push na `main` → Vercel (integracja z GitHub, `vercel.json`: `npm run build` → `dist/`) buduje produkcję automatycznie. Wdrożenie to decyzja użytkownika.
- **NIE wdrażać w trakcie wydarzenia:** Service Worker (`registerType: autoUpdate`) przełącza bundle na telefonach w trakcie gry.

## URL

_(do uzupełnienia po wdrożeniu: produkcyjny URL + potwierdzenie statusu „Ready” na Vercel)_

## Sesje bez planu (przed wdrożeniem / po wdrożeniu)

Kontrola: `npx vite-node scripts/check-planless.js` (produkcja `ytbwmmqwbfcugouourih`, service key, tylko SELECT; `status IN (running, paused) AND plan_anchor_at IS NULL`).

| Moment | Data (UTC) | Kod | Wynik |
|---|---|---|---|
| Przed wdrożeniem | 2026-09-25 09:11 | **0** | ✅ brak sesji running/paused bez planu |
| Po wdrożeniu | _(Task 2)_ | | |
| Po sondach | _(Task 2)_ | | |

## Sonda na wdrożeniu

_(Task 2: `npm run verify-prod`; sonda podstawowa i `PROBE_ADMIN_EXIT=1` z `PROBE_TARGET=prod PROBE_CONFIRM=1 PROBE_APP_URL=<URL>`. Kody, metryki SC1/SC5, sprzątanie.)_

## Urządzenia

_(Task 3: Android/Chrome i iPhone/Safari. Wake Lock w lobby i w quizie, pasek/pierścień, wibracja, View Transitions, refresh, reduced-motion, zamknięcie karty admina.)_

## Zgoda

_(Task 3: dosłownie `ZGODA NA UTWARDZENIE: TAK` albo `ZGODA NA UTWARDZENIE: NIE — <powód>`)_

Uwaga (SC5): przy `ZGODA NA UTWARDZENIE: NIE` kryterium SC5 pozostaje NIESPEŁNIONE dla starych RPC — `submit_answer`, `get_participant_answers` i `get_admin_answer_summary` nadal mogą ujawnić poprawność anonowi przed końcem czasu (stary bundle w cache, ręczne wywołanie RPC). SC5 jest wtedy spełnione wyłącznie dla ścieżki v2 nowego frontu; pełne SC5 zamyka dopiero sekcja 41 (06-10).
