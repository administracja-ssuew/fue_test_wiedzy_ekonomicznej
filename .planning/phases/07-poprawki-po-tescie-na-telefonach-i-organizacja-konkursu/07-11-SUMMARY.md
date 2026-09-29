---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 11
subsystem: admin-sesja, raport-xlsx
tags: [lista-uczestnikow, kto-utknal, zwolnienie-kodu, naruszenia, xlsx, sredni-czas, vitest, tdd, ui-spec-7]
requires:
  - "07-05: getViolationSummary, VIOLATION_LABELS, wzorzec soft-fallbacku PGRST202"
  - "07-07: downloadResultsXlsx({ …, violations })"
  - "07-10: stan AdminPanel.jsx po zmianie kolejności pytań"
provides:
  - "src/lib/roster.js: ROSTER_STATES, CONFLICT_WINDOW_MS, CLOSED_GRACE_MS, lastClosedIndex, classifyParticipant, sortRoster, summarizeRoster, conflictLabel"
  - "src/components/ParticipantRoster.jsx: karta „👥 Uczestnicy — N” (UI-SPEC §7)"
  - "supabase.js: getRecentCodeConflicts(city), getQuestionAnswerPresence(sessionId, questionId)"
  - "SesjaTab: lista kto utknął + 🔓; średnia 2 miejsca; XLSX z naruszeniami (sesja i Historia)"
affects: [07-12]
tech-stack:
  added: []
  patterns:
    - "Żywotność uczestnika z wiersza answers zamkniętego pytania zamiast presence w grze (1 RPC / pytanie, cache po indeksie)"
    - "Stan nieznany (null) ≠ rozłączony — przy błędzie nikt nie dostaje fałszywego „Rozłączony”"
key-files:
  created:
    - src/lib/roster.js
    - src/lib/roster.test.js
    - src/components/ParticipantRoster.jsx
  modified:
    - src/lib/supabase.js
    - src/screens/AdminPanel.jsx
decisions:
  - "lastClosedIndex z zapasem 4,5 s po closes (pusty zapis telefonu 0–1 s + bramka 1,5 s + sieć); pauza zamraża czas"
  - "getQuestionAnswerPresence zwraca null (stan nieznany) przy błędzie innym niż PGRST202 oraz gdy fallback get_admin_question_stats nic nie zwrócił — panel ponawia w następnym tiku zamiast oznaczać całą salę jako rozłączoną"
  - "Na telefonie status schodzi pod nazwisko przez kolumnę (imię+status), 🔓 zostaje po prawej, min. 44×44"
  - "Sesje bez planu (stary panel, brak plan_anchor_at) — brak zamkniętego pytania, więc wszyscy „W grze”; konflikty kodu działają niezależnie"
  - "Zmiana sesji zeruje cache zamkniętego pytania, konflikty i wynik presence odpowiedzi; odpowiedź RPC dla starej sesji jest odrzucana"
metrics:
  duration: 35min
  completed: 2026-09-29
  tasks: 3
  files: 5
---

# Faza 07 Plan 11: Lista „kto utknął”, średnia z 2 miejscami i naruszenia w XLSX — podsumowanie

W SesjaTab (waiting/running/paused) zamiast siatki nazwisk jest karta „👥 Uczestnicy — N”: każdy uczestnik ma kod i stan (W poczekalni / W grze / Brak odpowiedzi na bieżące pytanie / Rozłączony / Inny telefon próbuje wejść · n min temu), filtr „Tylko problemy” i przycisk 🔓 zwalniający kod z telefonu. Sygnałem żywotności jest wiersz w `answers` ostatniego zamkniętego pytania (jedno RPC na pytanie), a konflikty kodu idą lekkim zapytaniem co 6 s — bez presence w grze. Dodatkowo „Wyniki końcowe” pokazują średni czas z 2 miejscami, a eksport XLSX (sesja i Historia) dostaje naruszenia z bazy.

## Zadania

| # | Zadanie | Commity | Pliki |
|---|---------|---------|-------|
| 1 | roster.js + testy (TDD) i wrappery supabase.js | `e105be4` (RED), `b0370f2` (GREEN) | src/lib/roster.js, src/lib/roster.test.js, src/lib/supabase.js |
| 2 | ParticipantRoster.jsx + podpięcie w SesjaTab | `75f0b5a` | src/components/ParticipantRoster.jsx, src/screens/AdminPanel.jsx |
| 3 | Średnia 2 miejsca, naruszenia w XLSX, etykiety | `7b1c10a` | src/screens/AdminPanel.jsx |

## Co powstało

**roster.js** (19 testów, 33 asercje `expect(`)
- `ROSTER_STATES` z etykietami, skrótami, kolorami, flagami `problem`/`pulse` wg UI-SPEC §7; komentarz, dlaczego bez presence w grze.
- `lastClosedIndex(items, anchorMs, pausedAtMs, nowMs, graceMs = 4500)` — największe `i` z `c + grace ≤ t`, pauza zamraża czas, brak planu/kotwicy → `null`.
- `classifyParticipant` — świeży konflikt (≤ 5 min) ma pierwszeństwo; waiting: `inLobby === false` → rozłączony, `null` (nieznane) → w poczekalni; running/paused: `answered`/`empty`/`missing`/`null` → W grze / brak odpowiedzi / rozłączony / W grze.
- `sortRoster` (kopia; konflikt → rozłączony → brak odpowiedzi → reszta, w grupie `localeCompare` kodów), `summarizeRoster`, `conflictLabel` (minuty w dół, nie mniej niż 0).

**supabase.js**
- `getRecentCodeConflicts(city)` — RPC `admin_recent_code_conflicts` → `Map(code → lastAtMs)`; DEMO i każdy błąd (w tym PGRST202) → pusta `Map`.
- `getQuestionAnswerPresence(sessionId, questionId)` — RPC `admin_question_answer_presence` → `Map(code → has_choice)`; PGRST202 → fallback `getLiveQuestionStats` (`Map(code → true)`); inny błąd → `null`; DEMO z `fue_answers`.

**ParticipantRoster.jsx**
- Karta 16 px, nagłówek z przełącznikiem „Tylko problemy” / „Pokaż wszystkich” (`aria-pressed`), filtr domyślnie włączony w running/paused, wyłączony w waiting (reset przy zmianie statusu).
- Pigułki liczników > 0, podpis zależny od statusu, lista `maxHeight: 360`, wiersze z kropką (puls tylko W grze / W poczekalni), kodem Bebas Neue, nazwiskiem z wielokropkiem, statusem (na telefonie skrót), 🔓 z `confirm` i `aria-label`; kod bez `device_id` → 🔓 `disabled`, `opacity: .3`.
- Puste stany: „Nikt jeszcze nie dołączył…” i „✓ Wszyscy uczestnicy są w grze.”

**SesjaTab**
- Efekt co 3 s (waiting/running/paused): `rosterNow`, `lastClosedIndex(planRef.current, …, serverNow())`, przy nowym indeksie jedno `getQuestionAnswerPresence` (cache w `closedIdxRef`). Drugi interwał 6 s: `getRecentCodeConflicts(city)`. Sprzątanie w cleanup.
- `lobbyCodes` z listy presence lobby tylko w waiting; pusta lista = nieznane (Pułapka 3).
- `releaseFromRoster` → `releaseCode(p.id)`, błąd → `alert("Nie udało się zwolnić kodu: … Spróbuj ponownie.")`, sukces → przeładowanie uczestników.
- Karta „👥 W poczekalni — N online” bez zmian; w ended/results lista się nie pokazuje.

**Zadanie 3**
- „⏱ 12,35 s” (`toFixed(2).replace(".", ",")`) w „Wyniki końcowe”.
- `exportResultsXlsx` i `HistoriaTab.exportXlsx`: `getViolationSummary(id)` → `downloadResultsXlsx({ …, violations })`.
- Toast naruszenia i blok „⚠️ Naruszenia regulaminu”: `VIOLATION_LABELS[type] ?? type`.

## Weryfikacja

- `npx vitest run src/lib/roster.test.js` — 19/19.
- `npx vitest run` (całość) — 17 plików, 343/343.
- `npx vite build` — kod 0.
- Kryteria `grep` z planu: 5 eksportów funkcji w roster.js; nazwy RPC w supabase.js = 2; `<ParticipantRoster` = 1, brak `Uczestnicy ({participants.length})`; `lastClosedIndex(`, `getQuestionAnswerPresence(`, `getRecentCodeConflicts(` po 1; teksty komponentu 6 wierszy, `title` 2 wiersze, confirm 1; brak `presence`/`.track(` w komponencie; brak `toFixed(1)`; `getViolationSummary(` = 2; `violations,` = 3; brak `"Zmiana zakładki"`/`"Screenshot"`; `VIOLATION_LABELS[` = 2.
- Jednorazowy test renderu komponentu (niecommitowany, usunięty): sortowanie konflikt → rozłączony → W grze, etykieta „· 3 min temu”, przełącznik filtra, `confirm` → `onRelease`, pusty stan waiting.
- Nic nie było uruchamiane na produkcyjnym Supabase. Test na telefonach (tryb samolotowy → „Rozłączony” po reveal, 🔓, XLSX w Excelu) zostaje w bramce 07-12.

## Odchylenia od planu

### Poprawki automatyczne

**1. [Reguła 2 — poprawność] Stan nieznany zamiast fałszywego „Rozłączony” dla całej sali**
- **Znalezione w:** zadaniu 1–2
- **Problem:** `getLiveQuestionStats` przy błędzie zwraca pustą listę odpowiedzi; fallback z planu dałby pustą `Map`, a przy cache „raz na pytanie” cała sala byłaby „Rozłączona” aż do następnego pytania.
- **Poprawka:** pusty wynik fallbacku → `null`; w SesjaTab `null` zeruje `closedIdxRef`, więc pytanie jest pobierane ponownie w następnym tiku (3 s). Odpowiedź dla innej sesji / innego indeksu jest odrzucana.
- **Commity:** `b0370f2`, `75f0b5a`

Drobne w granicach planu: `getQuestionAnswerPresence` bez `sessionId`/`questionId` → `null`; zmiana sesji zeruje też `conflicts`; nieaktywny 🔓 ma `cursor: not-allowed`; efekt listy zależy też od `city`.

### Uwaga środowiskowa (nie dotyczy kodu)
Pierwsza próba edycji przez heredoc z `python -` nie dopasowała polskich znaków (kodowanie stdin); skrypt przeniesiony do pliku w scratchpadzie z `python -X utf8`. Plik źródłowy nie został uszkodzony (sprawdzone).

## Known Stubs

Brak. Przed wgraniem sekcji 44: stan „Inny telefon” się nie pojawia (pusta mapa konfliktów), a „Brak odpowiedzi” nie jest odróżniany od odpowiedzi (fallback bez `has_choice`) — to zamierzone soft-fallbacki, nie zaślepki.

## Self-Check: PASSED

- FOUND: src/lib/roster.js, src/lib/roster.test.js, src/components/ParticipantRoster.jsx, src/lib/supabase.js, src/screens/AdminPanel.jsx
- FOUND commits: e105be4, b0370f2, 75f0b5a, 7b1c10a
