# Faza 6 / Plan 09 — Bramka wdrożenia nowego frontu (DEPLOY)

**Status:** bramka zaliczona. Front wdrożony, sondy na wdrożeniu zielone, test na telefonach przyjęty, zgoda na utwardzenie jest (sześć uwag do domknięcia luk poniżej).
**Przygotowano:** 2026-09-25

## Commit do wdrożenia

- **Wdrożony commit:** `0f6c512` (HEAD `main`). Push `fdc3bee..0f6c512` wykonał orkiestrator na prośbę użytkownika 2026-09-25.
- **Ostatnia zmiana frontu (src/, public/, index.html, vite.config.js, package*.json, vercel.json):** `1c340e4` (fix(06-08): refresh bez mignięcia poczekalni i z blokadą odpowiedzi od pierwszej klatki). Po nim są tylko zmiany w dokumentacji i skryptach.
- **Push:** 44 commity fazy 6, z czego 17 zmienia front. Poprzedni `origin/main` = `fdc3bee` (2026-09-24).
- **Sposób wdrożenia:** push na `main` → Vercel (integracja z GitHub, `vercel.json`: `npm run build` → `dist/`) buduje produkcję automatycznie.
- **NIE wdrażać w trakcie wydarzenia:** Service Worker (`registerType: autoUpdate`) przełącza bundle na telefonach w trakcie gry.

## URL

- **Produkcja:** https://fue-quiz.vercel.app/
- **Potwierdzenie, że wdrożenie jest aktywne (2026-09-25 ~09:15 UTC):** `index.html` na produkcji ładuje `/assets/index-CyWam0UR.js`. To ta sama nazwa (hash treści) co w lokalnym `dist/` zbudowanym z `1c340e4`+. Bundle zawiera znaczniki v2: `get_participant_state`, `submit_answer_v2`, `data-fue-phase`. Status „Ready” wynika z tego, że Vercel serwuje nowy bundle; użytkownik nie potwierdził go osobno.

## Sesje bez planu (przed wdrożeniem / po wdrożeniu)

Kontrola: `npx vite-node scripts/check-planless.js` (produkcja `ytbwmmqwbfcugouourih`, service key, tylko SELECT; `status IN (running, paused) AND plan_anchor_at IS NULL`).

| Moment | Data (UTC) | Kod | Wynik |
|---|---|---|---|
| Przed wdrożeniem | 2026-09-25 09:11 | **0** | ✅ brak sesji running/paused bez planu |
| Po wdrożeniu | 2026-09-25 09:16 | **0** | ✅ brak sesji running/paused bez planu |
| Po sondach | 2026-09-25 10:08 | **0** | ✅ brak sesji running/paused bez planu |

## Sonda na wdrożeniu

Cel: produkcja `ytbwmmqwbfcugouourih`, aplikacja `https://fue-quiz.vercel.app` (`PROBE_TARGET=prod PROBE_CONFIRM=1 PROBE_APP_URL=https://fue-quiz.vercel.app`). Kraków, 2 telefony, 3 pytania × 20 s. Sonda sprawdza, czy bundle łączy się z tym samym projektem Supabase (po adresie socketu Realtime). Rozjazd przerwałby przebieg.

- **`npm run verify-prod` (2026-09-25 09:16 UTC):** kod **0**, „PRODUKCJA GOTOWA pod kątem SQL (40 OK)”.

| Przebieg (2026-09-25, UTC) | Kod | Widoczność pytań (plan 26 s) | Telefon vs telefon | Start pytań vs plan (maks.) | Idx w bazie vs plan | `results` od zamiatacza | SC5 | Socket t1 | Sprzątanie |
|---|---|---|---|---|---|---|---|---|---|
| podstawowy, 09:16–09:18 | **0** | 25,9 / 25,5 / 25,4 s | ≤ 1 s | 493 ms (limit 1500) | 96/96 | +1222 ms | OK (21 asercji, submit_answer_v2 ×3) | 1 otwarcie, 0 zamknięć, 9 zdarzeń / 3 pyt. | pytania 0, kody 0, plany 0 |
| ADMIN_EXIT, 09:27–09:29 | **0** | 25,9 / 25,7 / 25,6 s | 0 s | 142 ms (limit 1500) | 96/96 | +1122 ms (bez admina) | OK (21, ×3) | 1 / 0, 9 zdarzeń / 3 pyt. | 0 / 0 / 0 |

- Podstawowy: host vs telefon 0,0% rozbieżnych próbek; najdłuższy czas w pytaniu bez zmiany 19,7 s (limit 23 s).
- **SC1 (ADMIN_EXIT):** przeglądarka admina zamknięta zaraz po starcie. „Bez admina: wszystkie pytania na czas ✅”, „Bez admina: wyniki ustawione przez zamiatacz ✅”.
- **SC5:** w żadnym przebiegu nie wyciekła poprawność przed bramką (ścieżka v2).
- **Wynik bramki SC1/SC5 na wdrożeniu: ZALICZONA.**

## Urządzenia

Test na realnych telefonach wykonał użytkownik 2026-09-25 na wdrożonym froncie (https://fue-quiz.vercel.app/). Ocena ogólna: **działa dobrze, przyjęte.** Słowa użytkownika: „nawet dobrze to działa z tego co sprawdziłem”.

Użytkownik nie przekazał osobnych wyników punktów 2–7 dla każdej platformy (Wake Lock, pasek/pierścień, wibracja, View Transitions, refresh, reduced-motion, zamknięcie karty admina). Przyjęto je łącznie w ocenie ogólnej. Szczegółowe spostrzeżenia z testu są niżej, w sekcji „Uwagi z testu na telefonach”.

## Uwagi z testu na telefonach (do domknięcia luk)

Test przyjęty, ale użytkownik zgłosił poniższe problemy i podjął decyzje. Te punkty mają domknąć plany luk (gap closure) po 06-11.

1. **Reveal za krótki.** Poprawna odpowiedź jest widoczna ok. 4,5 s i wygląda jak mignięcie. Użytkownik pytał, czy 1,5-sekundowa bramka rośnie z liczbą uczestników. **Nie rośnie:** to stała bramka liczona zegarem serwera, niezależna od liczby osób. Trzeba to jeszcze potwierdzić pod obciążeniem.
   **DECYZJA:** poprawna odpowiedź ma być widoczna **10 s** po zamknięciu pytania, zanim ruszy odliczanie do następnego. Zmiana czasu REVEAL w `src/lib/plan.js` i w SQL `build_session_plan`. Dotyczy tylko nowych sesji; zamrożone plany zostają bez zmian.
2. **Błąd pauzy.** Czasami po pauzie wygląda, jakby jedno pytanie zostało pominięte. Działo się to, gdy pauzę wciśnięto w fazie **reveal / countdown**, a nie w czasie pytania.
   **DECYZJA:** debug oraz nowy tryb sondy z pauzą w reveal i w countdown.
3. **Przerwy planowe po module 2 i po module 4.**
   **DECYZJA:** quiz sam zatrzymuje się na przerwie po module 2 i po module 4 i czeka, aż admin wciśnie „Wznów”. Wznowienie jest ręczne, przerwa nie ma stałej długości.
4. **Koniec quizu.**
   **DECYZJA:** po ostatnim pytaniu telefony same pokazują ekran końcowy („Koniec testu” + wynik uczestnika). Podium na rzutniku nadal odsłania ręcznie admin.
5. **Archiwum (zakładka Historia) nie ma raportu per uczestnik.** Brakuje pobrania XLSX z czasem i poprawnością każdej odpowiedzi. Obecnie XLSX jest tylko dla bieżącej sesji (`exportResultsXlsx` w AdminPanel), a Historia ma tylko ranking w CSV.
   **Do zrobienia:** indywidualny raport XLSX dla sesji z archiwum.
6. **Brak odpowiedzi ma liczyć się jako błędna.** Kolumna rankingu „Pytań” (i suma) ma być liczbą pytań w planie sesji, a nie liczbą wierszy odpowiedzi. Dziś uczestnik, który odpadł w trakcie, ma mniej pytań w mianowniku.
   **Do zrobienia:** mianownik z `session_plans`.

## Zgoda

**ZGODA NA UTWARDZENIE: TAK**

Zgoda nie padła dosłowną frazą „approved — zgoda na utwardzenie”. Użytkownik napisał (2026-09-25): „nawet dobrze to działa z tego co sprawdziłem; ... i lecimy dalej z płynnością i planem”. Orkiestrator zinterpretował „lecimy dalej … z planem” jako zgodę na sekcję 41 (06-10) i usunięcie kodu legacy (06-11).

Uwaga (SC5): przy `ZGODA NA UTWARDZENIE: NIE` kryterium SC5 pozostaje NIESPEŁNIONE dla starych RPC — `submit_answer`, `get_participant_answers` i `get_admin_answer_summary` nadal mogą ujawnić poprawność anonowi przed końcem czasu (stary bundle w cache, ręczne wywołanie RPC). SC5 jest wtedy spełnione wyłącznie dla ścieżki v2 nowego frontu; pełne SC5 zamyka dopiero sekcja 41 (06-10).
