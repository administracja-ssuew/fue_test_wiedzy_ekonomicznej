---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 09
subsystem: deploy-gate
tags: [deploy, vercel, production, probe, sc1, sc5, devices, consent, gate]
requires: ["06-08"]
provides:
  - "Nowy front (plan sesji, zamiatacz, snapshot, płynność) wdrożony na https://fue-quiz.vercel.app/ (commit 0f6c512)"
  - "scripts/check-planless.js — kontrola sesji running/paused bez planu (prod, service key, read-only; kod 0/1/2)"
  - "06-09-DEPLOY.md — zapis bramki: URL, commit, sesje bez planu ×3, sondy na wdrożeniu, test na telefonach, ZGODA NA UTWARDZENIE: TAK, 6 uwag do domknięcia luk"
affects: [06-10, 06-11]
tech-stack:
  added: []
  patterns: ["weryfikacja wdrożenia po nazwie bundla z hashem treści (lokalny dist == produkcja)", "process.exitCode zamiast process.exit() w skryptach vite-node na Windows"]
key-files:
  created: [scripts/check-planless.js, .planning/phases/06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji/06-09-DEPLOY.md]
  modified: []
key-decisions:
  - "ZGODA NA UTWARDZENIE: TAK — zgoda słowami użytkownika („lecimy dalej z płynnością i planem”), nie dosłowną frazą; odblokowuje 06-10 (sekcja 41) i 06-11 (usunięcie legacy)"
  - "Reveal: poprawna odpowiedź widoczna 10 s po zamknięciu pytania (plan.js + build_session_plan; tylko nowe sesje)"
  - "Przerwy planowe po module 2 i 4: automatyczny stop, ręczne „Wznów” admina"
  - "Koniec quizu: telefony same pokazują „Koniec testu” + wynik; podium na rzutniku ręcznie"
  - "Brak odpowiedzi = błędna; mianownik „Pytań” = liczba pytań w planie sesji"
requirements-completed: [P6-SC1, P6-SC6, P6-FLUID]
duration: ~1 dzień (z oczekiwaniem na wdrożenie i test na telefonach)
completed: 2026-09-25
---

# Phase 6 Plan 09: Bramka wdrożenia nowego frontu — Summary

**Nowy front działa na produkcji (https://fue-quiz.vercel.app/, commit `0f6c512`). Produkcja serwuje dokładnie ten sam bundle co lokalny build. Obie sondy przeciw wdrożonemu adresowi, podstawowa i ADMIN_EXIT (SC1/SC5), skończyły się kodem 0. Przed wdrożeniem, po nim i po sondach nie było żadnej sesji running/paused bez planu. Użytkownik przyjął test na realnych telefonach i dał zgodę na utwardzenie (06-10/06-11). Z testu wynikło 6 uwag z decyzjami do domknięcia luk.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Kontrola sesji bez planu, zapis bramki, wdrożenie (push wykonał orkiestrator na prośbę użytkownika) | 0f6c512 (wdrożony) |
| 2 | Sondy przeciw wdrożonemu URL + check-planless po wdrożeniu i po sondach | 0eb77fc |
| 3 | Test na realnych telefonach + zgoda na utwardzenie + uwagi | (ten commit, razem z SUMMARY) |

## Wyniki

- **Weryfikacja wdrożenia:** `index.html` na produkcji ładuje `/assets/index-CyWam0UR.js`, tę samą nazwę (hash treści) co lokalny `dist/`. Bundle zawiera `get_participant_state`, `submit_answer_v2` i `data-fue-phase`.
- **check-planless:** kod 0 w trzech punktach (09:11 przed wdrożeniem, 09:16 po wdrożeniu, 10:08 UTC po sondach).
- **verify-prod:** kod 0 (40 OK).
- **Sonda podstawowa:** kod 0.
  - Widoczność pytań 25,4–25,9 s przy planie 26 s.
  - Telefon vs telefon ≤ 1 s.
  - Start pytań vs plan maks. 493 ms.
  - Idx w bazie 96/96.
  - `results` od zamiatacza +1222 ms.
  - SC5 OK (21 asercji).
  - Sprzątanie czyste.
- **Sonda ADMIN_EXIT:** kod 0.
  - Wszystkie pytania na czas bez admina.
  - Telefon vs telefon 0 s.
  - Start vs plan maks. 142 ms.
  - 96/96.
  - `results` od zamiatacza +1122 ms.
  - SC5 OK.
  - Sprzątanie czyste.
- **Telefony:** ocena ogólna „działa dobrze”, przyjęte.
- **Zgoda:** `ZGODA NA UTWARDZENIE: TAK`. Zgoda padła słowami użytkownika, nie dosłowną frazą; szczegóły w DEPLOY.md.

## Luki do domknięcia (gap closure) — z testu na telefonach

Pełny opis jest w `06-09-DEPLOY.md`, w sekcji „Uwagi z testu na telefonach (do domknięcia luk)”.

1. **Reveal za krótki** (~4,5 s, wygląda jak mignięcie). **Decyzja:** poprawna odpowiedź widoczna 10 s po zamknięciu pytania, przed odliczaniem do następnego. Zmiana REVEAL w `src/lib/plan.js` i w SQL `build_session_plan`, tylko nowe sesje. Bramka 1,5 s NIE rośnie z liczbą uczestników (stała, zegar serwera); trzeba to potwierdzić pod obciążeniem.
2. **Błąd pauzy:** po pauzie wciśniętej w reveal/countdown wygląda, jakby jedno pytanie zostało pominięte. **Do zrobienia:** debug i tryb sondy z pauzą w reveal i w countdown.
3. **Przerwy planowe po module 2 i 4.** **Decyzja:** automatyczny stop, a wznowienie tylko ręcznie przez „Wznów” admina (przerwa bez stałej długości).
4. **Koniec quizu.** **Decyzja:** po ostatnim pytaniu telefony same pokazują „Koniec testu” i wynik uczestnika; podium na rzutniku zostaje ręczne.
5. **Historia bez raportu per uczestnik:** brak XLSX (czas i poprawność każdej odpowiedzi) dla sesji z archiwum. Dziś XLSX jest tylko dla bieżącej sesji (`exportResultsXlsx`), a Historia ma ranking w CSV.
6. **Brak odpowiedzi = błędna:** „Pytań” i suma w rankingu mają wynikać z liczby pytań w planie sesji, a nie z liczby wierszy odpowiedzi. Dziś uczestnicy, którzy odpadli, mają mniejszy mianownik.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] check-planless kończył się kodem 127 na Windows**
- **Found during:** Task 1 (pierwsze uruchomienie; wynik merytoryczny był poprawny: 0 sesji)
- **Issue:** `process.exit()` w trakcie zamykania uchwytów fetch kończył się asercją libuv (`UV_HANDLE_CLOSING`), więc skrypt zwracał kod 127
- **Fix:** `process.exitCode` zamiast `process.exit()` (jak w `verify-order.js`)
- **Files modified:** scripts/check-planless.js
- **Commit:** 0f6c512

### Inne odstępstwa

- **Wdrożenie:** push `fdc3bee..0f6c512` wykonał orkiestrator na prośbę użytkownika. Status „Ready” na Vercel nie został potwierdzony osobno. Potwierdziła go identyczność bundla produkcji z lokalnym buildem i obecność znaczników v2.
- **Zgoda:** zapisana na podstawie słów użytkownika („lecimy dalej z płynnością i planem”), a nie frazy „approved — zgoda na utwardzenie”. Interpretacja orkiestratora jest odnotowana w DEPLOY.md.
- **Urządzenia:** kryterium „wyniki punktów 2–7 dla obu platform” jest spełnione ogólną oceną użytkownika („działa dobrze”), bez rozbicia na punkty i platformy. Konkretne spostrzeżenia trafiły do listy luk.

## Verification

- `grep -c "pozostaje NIESPEŁNIONE dla starych RPC" 06-09-DEPLOY.md` = 1
- `grep -c "ZGODA NA UTWARDZENIE: TAK" 06-09-DEPLOY.md` = 1
- Obie sondy na wdrożeniu: kod 0. check-planless ×3: kod 0. verify-prod: kod 0.

## Known Stubs

Brak.

## Next

Gotowe do 06-10 (sekcja 41: utwardzenie starych RPC) i 06-11 (usunięcie kodu legacy). Sześć luk z testu na telefonach czeka na plany gap closure.

## Self-Check: PASSED
- FOUND: scripts/check-planless.js, 06-09-DEPLOY.md
- FOUND: commity 0f6c512 (na origin/main), 0eb77fc
