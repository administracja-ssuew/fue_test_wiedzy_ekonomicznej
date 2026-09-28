---
phase: 7
slug: poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-28
---

# Phase 7 — Validation Strategy

> Kontrakt walidacji fazy: jak sprawdzamy postępy w trakcie wykonania. Źródło: `07-RESEARCH.md`, sekcja „Architektura walidacji”.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 + @testing-library/react 16 + jsdom 24 |
| **Config file** | `vite.config.js` (`test.environment: "jsdom"`), `src/test-setup.js` |
| **Quick run command** | `npx vitest run <dotknięty plik .test.js/.test.jsx>` |
| **Full suite command** | `npm test` + `npm run build` |
| **Prod (read-only / samosprzątające)** | `npm run verify-prod`, `npm run verify-plan`, `npm run verify-code-limit` (nowy) |
| **Sonda gry (za zgodą)** | `$env:PROBE_TARGET="prod"; $env:PROBE_CONFIRM="1"; $env:PROBE_TRACE="1"; npm run sonda` |
| **Estimated runtime** | ~17 s (npm test) + ~20 s (build) |

---

## Sampling Rate

- **After every task commit:** quick run dla dotkniętego pliku testów
- **After every plan wave:** `npm test` + `npm run build`
- **Po wgraniu sekcji 44 (checkpoint użytkownika):** `npm run verify-prod` + `npm run verify-code-limit` + `npm run verify-plan`
- **Before `/gsd:verify-work`:** pełny zestaw zielony; seria sond (5× podstawowa + ADMIN_EXIT) za zgodą, z kontrolą resztek `[SONDA]` i blokadą uśpienia; ręczna lista iPhone (Safari + Chrome); projektor po końcu testu
- **Max feedback latency:** 40 s

---

## Per-Task Verification Map

Wiersze po wymaganiach. Identyfikatory zadań uzupełni planista i wykonawca (`{N}-{plan}-{task}`).

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| P7-PROJ-END | `projectorIdlePhase`: results/ended → ended; lobby/legacy/brak planu → waiting | unit | `npx vitest run src/lib/projector.test.js` | ❌ W0 | ⬜ pending |
| P7-IOS-WAKE | prośba tylko w geście; odmowa → fallback mp4 (bez `muted`/`loop`); release przy `!active`; nasłuch zdjęty przy `held` | unit | `npx vitest run src/lib/wakeLock.test.js` | ❌ W0 | ⬜ pending |
| P7-IOS-HAPTIC | nakładka tylko gdy `HAS_SWITCH_HAPTICS && !answered && picked===null`; klik → `onPick` dokładnie raz | unit RTL | `npx vitest run src/screens/Quiz.test.jsx` | ❌ W0 | ⬜ pending |
| P7-VT-SMOOTH | `shouldStartViewTransition` / strikes / stableFrames | unit | `npx vitest run src/lib/viewTransition.test.js` | ✅ rozszerzyć | ⬜ pending |
| P7-VT-SMOOTH | devDom ≤ 1500 ms (cel < 400) w 5 przebiegach | sonda prod | seria podstawowa ×5 | ✅ skrypt | ⬜ pending |
| P7-CODE-4 | `parseCodesCsv` (BOM, `;`/`,`, nagłówek, `="0042"`, zły prefiks, 3 cyfry, `12a4`, duplikat, zajęty, pusty → losowy) + `pickFreeNumbers` | unit | `npx vitest run src/lib/codeFormat.test.js` | ❌ W0 | ⬜ pending |
| P7-CODE-DASH | `formatCodeInput` (auto-myślnik, backspace, wklejenie, 6 cyfr OK) | unit + RTL | `npx vitest run src/lib/codeFormat.test.js src/screens/CodeEntry.test.jsx` | ❌ W0 | ⬜ pending |
| P7-CODE-RATE | 5× `not_found` z urządzenia A → 6. `rate_limited`; urządzenie B OK; po 60 s A znów może; sprzątanie | integracja prod | `npm run verify-code-limit` | ❌ W0 | ⬜ pending |
| P7-VIOL-REPORT | `summarizeViolations` + kolumna „Naruszenia” i karta uczestnika w `buildResultsSheets` | unit | `npx vitest run src/lib/violations.test.js src/lib/resultsXlsx.test.js` | ❌ W0 / ✅ | ⬜ pending |
| P7-VIOL-REPORT | licznik trwały po remount; dosłanie po oknie; ≤ 1 zapis / 10 s / typ | unit hook | `npx vitest run src/hooks/useAntiCheat.test.js` | ❌ W0 | ⬜ pending |
| P7-AVG-2DP | `secs(12345)=12.35`; styles.xml z formatem „0.00”, komórka czasu `s="1"` | unit | `npx vitest run src/lib/xlsx.test.js src/lib/resultsXlsx.test.js` | ✅ zaktualizować | ⬜ pending |
| P7-AVG-2DP | brak `toFixed(1)` przy średnim czasie w panelu | grep | `grep -n "toFixed(1)" src/screens/AdminPanel.jsx` | — | ⬜ pending |
| P7-Q-REORDER | `moveItem`, gęsta numeracja; plan z nowej kolejności | unit | `npx vitest run src/lib/reorder.test.js src/lib/plan.test.js` | ❌ W0 / ✅ | ⬜ pending |
| P7-Q-REORDER | RPC: city_admin innego miasta → błąd; parzystość planu JS↔SQL | integracja prod | `npm run verify-plan` + krok w `verify-prod` | ✅ rozszerzyć | ⬜ pending |
| P7-ADMIN-STUCK | `classifyParticipant` na tablicy przypadków | unit | `npx vitest run src/lib/roster.test.js` | ❌ W0 | ⬜ pending |
| SC10 (addytywność) | stary bundel działa po sekcji 44 | sonda na starym buildzie | wzorzec 06-03 | ✅ wzorzec | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/projector.test.js` — P7-PROJ-END
- [ ] `src/lib/wakeLock.test.js` — P7-IOS-WAKE
- [ ] `src/screens/Quiz.test.jsx` — P7-IOS-HAPTIC (pojedynczy `onPick`)
- [ ] `src/lib/codeFormat.test.js`, `src/screens/CodeEntry.test.jsx` — P7-CODE-4 / P7-CODE-DASH
- [ ] `scripts/verify-code-limit.js` + skrypt `npm run verify-code-limit` — P7-CODE-RATE
- [ ] `src/lib/violations.test.js`, `src/hooks/useAntiCheat.test.js` — P7-VIOL-REPORT
- [ ] `src/lib/reorder.test.js` — P7-Q-REORDER
- [ ] `src/lib/roster.test.js` — P7-ADMIN-STUCK
- [ ] aktualizacja `src/lib/xlsx.test.js` (8 wpisów ZIP) i `src/lib/resultsXlsx.test.js` (`secs` 2 miejsca)

Framework: bez luk (Vitest + RTL + jsdom zainstalowane).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Projektor pokazuje „Koniec testu” aż do podium | P7-PROJ-END | wizualne, cały przebieg | zakończ test → projektor = koniec → 🏆 Podium → podium |
| Ekran nie gaśnie (lobby 2 × Auto-Lock, pytanie, po odświeżeniu z paskiem „dotknij”) | P7-IOS-WAKE | WebKit na prawdziwym iPhonie | iPhone, Safari i Chrome, Auto-Lock 30 s |
| Odczuwalne tyknięcie przy wyborze odpowiedzi | P7-IOS-HAPTIC | haptyka sprzętowa | iPhone iOS 18+, Safari i Chrome |
| Nagłówek IP niepodrabialny (przed włączeniem klucza IP) | P7-CODE-RATE | zależne od infrastruktury Supabase | curl z podrobionym `x-forwarded-for` do funkcji echo |
| Telefon w trybie samolotowym w trakcie pytania → „rozłączony” po reveal; 🔓 działa | P7-ADMIN-STUCK | sieć i dwa urządzenia | 2 telefony, panel sesji |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 40 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
