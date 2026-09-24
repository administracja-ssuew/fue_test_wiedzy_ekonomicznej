---
phase: 6
slug: rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-24
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 (jsdom, `globals: true`) + Playwright (sonda produkcyjna `scripts/probe-gameplay.js`) + skrypty `vite-node` read-only (`verify-prod`, nowy `verify-plan`) |
| **Config file** | `vite.config.js` sekcja `test` (setup `src/test-setup.js`, wyklucza `e2e/`) |
| **Quick run command** | `npx vitest run src/lib/plan.test.js src/lib/gameLogic.test.js src/lib/serverClock.test.js` |
| **Full suite command** | `npm test && npm run build && npm run verify-prod && npm run verify-plan` |
| **Estimated runtime** | ~5 s (quick), ~60 s (full, bez sondy) |

Sonda (bramka fazy, PowerShell): `npm run build; npm run preview` (osobny terminal), potem `$env:PROBE_TARGET="prod"; $env:PROBE_CONFIRM="1"; $env:PROBE_ADMIN_EXIT="1"; npm run sonda` — analogicznie `PROBE_REFRESH`, `PROBE_OFFLINE`.

---

## Sampling Rate

- **After every task commit:** `npx vitest run`
- **After every plan wave:** `npm test && npm run build`; po falach z SQL dodatkowo `npm run verify-prod` i `npm run verify-plan` (po ręcznym wgraniu sekcji)
- **Before `/gsd:verify-work`:** pełny zestaw zielony + sonda w trzech trybach + sonda na STARYM buildzie (SC6)
- **Max feedback latency:** 5 s (unit)

---

## Per-Task Verification Map

| ID | Kryterium | Zachowanie | Typ | Komenda | Plik istnieje | Status |
|----|-----------|------------|-----|---------|---------------|--------|
| V-01 | SC1 | Fazy/terminy z planu dla każdej chwili; `finished`/`results` po ostatnim reveal | unit | `npx vitest run src/lib/plan.test.js` | ❌ W0 | ⬜ pending |
| V-02 | SC1 | Decyzja zamiatacza `sweepDecision(row, items, now)` jako specyfikacja SQL | unit | `npx vitest run src/lib/plan.test.js -t "zamiatacz"` | ❌ W0 | ⬜ pending |
| V-03 | SC1 | JS `planPosition` == SQL `plan_position` na wspólnych fixture'ach | integracja read-only | `npm run verify-plan` | ❌ W0 | ⬜ pending |
| V-04 | SC1 | Zamiatacz żyje (ostatni przebieg < 5 s) | smoke read-only | `npm run verify-prod` | ❌ rozszerzenie | ⬜ pending |
| V-05 | SC1 | Quiz kończy się bez admina | e2e prod | `PROBE_ADMIN_EXIT=1 npm run sonda` | ❌ tryb | ⬜ pending |
| V-06 | SC2 | Pauza w każdej fazie → wznowienie → ta sama faza i remaining | unit | `npx vitest run src/lib/plan.test.js -t "pauza"` | ❌ W0 | ⬜ pending |
| V-07 | SC2 | Refresh zachowuje fazę ±1 s i blokadę odpowiedzi | e2e prod | `PROBE_REFRESH=1 npm run sonda` | ❌ tryb | ⬜ pending |
| V-08 | SC2 | Offset z próbki snapshotu; filtr mediany nie psuje min-RTT | unit | `npx vitest run src/lib/serverClock.test.js` | ✅ rozszerzyć | ⬜ pending |
| V-09 | SC3 | Offline 10 s → natychmiastowa zgodność fazy | e2e prod | `PROBE_OFFLINE=1 npm run sonda` | ❌ tryb | ⬜ pending |
| V-10 | SC4 | Projekcja ignoruje `modules` przy sesji z planem | unit | `npx vitest run src/lib/plan.test.js -t "moduły"` | ❌ W0 | ⬜ pending |
| V-11 | SC4 | Brak `timePerQ` w ścieżkach renderu dla sesji z planem | statyczny | `rg -n "timePerQ" src/screens/Quiz.jsx src/hooks/useLiveProjection.js src/App.jsx` | — | ⬜ pending |
| V-12 | SC5 | Skip/Powtórz/pauza przesuwają kotwicę; odpowiedź w tolerancji = zero bonusu | unit | `npx vitest run src/lib/plan.test.js -t "przesunięcie"` | ❌ W0 | ⬜ pending |
| V-13 | SC5 | `submit_answer_v2` bez `is_correct`/`correct_ans`; snapshot/summary v2 zwracają NULL przed `closes_at + 1,5 s` | integracja prod | `npm run sonda` (asercja wbudowana) | ❌ | ⬜ pending |
| V-14 | SC6 | Stare RPC i sygnatury wdrożonego frontu istnieją i działają | smoke read-only | `npm run verify-prod` | ✅ rozszerzyć | ⬜ pending |
| V-15 | SC6 | Sesja bez planu działa po staremu (regresja) | e2e prod | sonda na starym buildzie (`87e7c20`) po wgraniu 39–40 | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/plan.js` + `src/lib/plan.test.js` — SC1, SC2, SC4, SC5 (logika)
- [ ] `src/lib/plan.fixtures.json` — wspólne przypadki JS/SQL
- [ ] `scripts/verify-plan.js` + `"verify-plan": "vite-node scripts/verify-plan.js"` w `package.json`
- [ ] Rozszerzenie `scripts/verify-prod.js` o sekcje 39–41
- [ ] Atrybuty `data-fue-*` w nowym UI (warunek trybów sondy)

Framework: bez instalacji (Vitest, Playwright, vite-node już są).

---

## Manual-Only Verifications

| Behavior | Kryterium | Why Manual | Test Instructions |
|----------|-----------|------------|-------------------|
| Wgranie sekcji SQL 39–41 | SC1, SC6 | Brak CLI/hasła DB — tylko SQL Editor | Wkleić sekcję w SQL Editor projektu `ytbwmmqwbfcugouourih`, uruchomić, potem `npm run verify-prod` |
| Wersja Postgres/pg_cron | SC1 | Wymóg ≥ 15.1.1.61 dla harmonogramu sekundowego | `select version();` w SQL Editorze przed sekcją 40 |
| Wake Lock / wibracja / View Transitions na realnym telefonie | płynność | Zależne od urządzenia (iOS PWA ≥ 18.4) | Otworzyć quiz na Androidzie i iPhonie, ekran nie gaśnie w lobby i quizie |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
