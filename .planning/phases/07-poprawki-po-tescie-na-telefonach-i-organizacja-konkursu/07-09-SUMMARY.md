---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 09
subsystem: admin-kody
tags: [kody-4-cyfrowe, csv, import, admin-panel, ui-spec-5]
requires:
  - "07-05: codeFormat.js (CITY_PREFIX, parseCodesCsv, assignNumbers, takenNumbersFromCodes), generateParticipantCode({ number }) z conflict"
provides:
  - "KodyTab: pole „Kod (opcjonalnie)” z prefiksem miasta w formularzu ręcznym"
  - "KodyTab: import CSV Imię;Nazwisko;Kod z podglądem błędów wierszy, losowaniem pustych numerów i raportem po imporcie"
affects: [07-12]
tech-stack:
  added: []
  patterns:
    - "UI tylko woła czyste funkcje z codeFormat.js — cała walidacja wierszy poza komponentem"
key-files:
  created: []
  modified:
    - src/screens/AdminPanel.jsx
decisions:
  - "Błąd generateParticipantCode w formularzu ręcznym → komunikat, pola NIE są czyszczone (admin poprawia numer)"
  - "Import: błędy inne niż konflikt 23505 (np. sieć) też trafiają do raportu po imporcie jako „Wiersz {nr}: {Imię Nazwisko} — {błąd}”, żeby nikt nie zniknął po cichu"
  - "Podwójne kliknięcie chronione: generate() wraca, gdy busy; importCsv() wraca, gdy csvImporting"
metrics:
  duration: 12min
  completed: 2026-09-28
  tasks: 2
  files: 1
---

# Faza 07 Plan 09: Zakładka Kody — kody 4-cyfrowe z pliku i pole Kod — podsumowanie

Zakładka Kody w panelu admina obsługuje teraz numery nadawane przez koordynatorów: formularz ręczny ma opcjonalne pole „Kod (opcjonalnie)” ze stałym prefiksem miasta, a import CSV `Imię;Nazwisko;Kod` pokazuje przed importem podsumowanie „Do importu / Błędy”, pierwsze 5 poprawnych wierszy (pusty kod jako `KRK-····` (losowy)) i wszystkie błędne wiersze z powodem. Importują się tylko poprawne wiersze, puste kody dostają losowy wolny numer, a wyścig 23505 jest raportowany per wiersz bez ponawiania.

## Zadania

| # | Zadanie | Commit | Pliki |
|---|---------|--------|-------|
| 1 | Formularz ręczny z polem „Kod (opcjonalnie)” | `6867cb2` | src/screens/AdminPanel.jsx |
| 2 | Import CSV Imię;Nazwisko;Kod — podgląd z błędami i import z numerami | `0d2475b` | src/screens/AdminPanel.jsx |

## Co się zmieniło (tylko `KodyTab`)

**Formularz ręczny**
- Trzecie pole po „Nazwisko”: `C.lbl` „Kod (opcjonalnie)”, w kontenerze `C.input` stały prefiks `{PREFIX}-` (14 px `#9B89CC`) i pole `inputMode="numeric"`, `maxLength={4}`, `placeholder="losowy"`; znaki inne niż cyfry odrzucane przy wpisywaniu; Enter wysyła.
- Walidacja klienta: niepełne 4 cyfry → „Kod musi mieć 4 cyfry (np. 0042) — albo zostaw pole puste, a numer zostanie wylosowany.”
- `generateParticipantCode({ …, number: form.number || null })`; błąd (w tym „Kod KRK-1111 jest już zajęty w mieście Kraków.”) pokazany z `role="alert"`, pola zostają; sukces czyści pola i przeładowuje listę.
- Przycisk „🎟️ Generuj kod”.

**Karta importu**
- Przykładowy plik z kolumną Kod (`1111`, `0042`, pusty); opis formatu z podpowiedzią o kolumnie Tekst w Excelu (dokładny tekst UI-SPEC §5, prefiks miasta dynamiczny).
- `handleCsvFile` → `parseCodesCsv(text, { prefix, city, takenNumbers: takenNumbersFromCodes(codes, prefix) })`; stary ręczny parser usunięty.
- Podgląd: „Do importu: N · Błędy: M” (część z błędami tylko przy M > 0), 5 zielonych pigułek z kodem (Bebas Neue 13, `#C4B5FD`), „… i N−5 więcej”, wszystkie błędy w bloku `maxHeight: 240` („Wiersz {nr}: {Imię Nazwisko} — {powód}”), ostrzeżenie `#F5C518`, przyciski „✅ Importuj {N} poprawnych” (nieaktywny przy N = 0 + komunikat „Brak wierszy do importu — popraw plik i wgraj ponownie.”) i „Odrzuć plik”.
- `importCsv`: `assignNumbers(valid, takenNumbersFromCodes(codes, prefix))` → pętla `generateParticipantCode({ …, number })`; `conflict` → lista `raced`; licznik `ok`; postęp „Importuję {i}/{N}…”.
- Raport po imporcie: „Zaimportowano {ok}.” oraz wiersze „Wiersz {nr}: kod {KRK-1111} został zajęty w międzyczasie — dodaj tę osobę ręcznie.”
- Lista kodów, liczniki, 🔓 i ✕ bez zmian. Inne zakładki nietknięte.

## Weryfikacja

- `vitest run` — 13 plików, 284/284.
- `vite build` — kod 0.
- Wszystkie kryteria akceptacji `grep` z obu zadań spełnione (`Kod (opcjonalnie)` = 1, `placeholder="losowy"` = 1, `🎟️ Generuj kod` = 1, brak `"🎟️ Generuj"`, `number: form.number || null` = 1, `parseCodesCsv(` = 1, `assignNumbers(` = 1, `takenNumbersFromCodes(` = 2, `maxHeight: 240` = 2, brak „✅ Importuj wszystkich”, wszystkie teksty UI-SPEC po 1).
- Jednorazowy test potoku w Node (niecommitowany) dla Krakowa przy zajętym `KRK-0042`: `Piotr;Wiśniewski;` → poprawny, dostał losowy numer; `1111` ×2 → oba wiersze „powtarza się w pliku (wiersze 2 i 8)”; `0042` → „jest już zajęty w mieście Kraków”; `111` → „musi mieć 4 cyfry — jeśli w Excelu…”; `WAR-1111` → „należy do innego miasta”; brak nazwiska → „brak imienia lub nazwiska”.
- Test ręczny w przeglądarce (import `Jan;Kowalski;1111` → `KRK-1111` itd.) zostaje w bramce 07-12, zgodnie z planem.

## Odchylenia od planu

### Poprawki automatyczne

**1. [Reguła 2 — brakująca obsługa błędów] Raport błędów importu innych niż wyścig 23505**
- **Znalezione w:** zadaniu 2
- **Problem:** plan raportował tylko `conflict`. Inny błąd `generateParticipantCode` (np. sieć, RLS) po cichu pomijałby osobę, a admin widziałby tylko mniejszą liczbę w „Zaimportowano N.”.
- **Poprawka:** lista `failed` w `importReport`, wyświetlana pod wyścigami w tym samym stylu: „Wiersz {nr}: {Imię Nazwisko} — {treść błędu}”, plus `console.error`.
- **Pliki:** src/screens/AdminPanel.jsx
- **Commit:** `0d2475b`

**2. [Reguła 1 — błąd] Ochrona przed podwójnym wywołaniem**
- `generate()` wraca przy `busy` (Enter w polu omijał `disabled` przycisku), `importCsv()` wraca przy `csvImporting`.
- **Commity:** `6867cb2`, `0d2475b`

Drobne: nieaktywny przycisk importu ma też `cursor: not-allowed`; klucze wierszy błędów to `${line}-${i}` (dla pewności przy wielu błędach jednej linii).

### Uwaga środowiskowa (nie dotyczy kodu)
Worktree startował na `272dbf0` — wykonano `git merge --ff-only main` do `a753183`. Pierwsze uruchomienie `vite build` nie znalazło modułu, bo `node_modules` głównego repo był akurat przepisywany (znacznik czasu 21:42); po chwili build przeszedł bez żadnych zmian z mojej strony. Nie uruchamiałem `npm install`. Nic nie było uruchamiane na produkcyjnym Supabase.

## Known Stubs

Brak.

## Self-Check: PASSED

- FOUND: src/screens/AdminPanel.jsx
- FOUND commits: 6867cb2, 0d2475b
