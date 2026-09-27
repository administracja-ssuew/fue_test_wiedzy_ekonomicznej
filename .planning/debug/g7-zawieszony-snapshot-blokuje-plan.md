---
status: awaiting_human_verify
trigger: "g7-zawieszony-snapshot-blokuje-plan — w przebiegu gate-05 (06-17) telefon 2 wszedł w pytanie 1 7,7 s po planie, bo zawieszone żądanie get_participant_state (wysłane w lobby 3,2 s przed startem, odpowiedź po 20,9 s) zablokowało pobranie planu po sygnale startu z Realtime. Dodatkowo: limit 150 ms View Transition z 06-16 w praktyce nie działa."
created: 2026-09-27T20:00:00Z
updated: 2026-09-27T20:00:00Z
---

## Current Focus

hypothesis: POTWIERDZONA (H-A) + H-VT (limit 150 ms nieskuteczny z konstrukcji, gdy przechwycenie VT jest wolne)
test: poprawka wdrożona w kodzie (commity 58b5af0, 308b9c9); lokalnie 214/214 + build
expecting: powtórzona seria sond 06-17: 5 kolejnych przebiegów podstawowych z kodem 0, devDom startu pytań < 1,5 s
next_action: czekamy na zgodę użytkownika na ponowną serię sond 06-17 (produkcja) — orkiestrator

## Symptoms

expected: Po sygnale startu z Realtime (dotarł do telefonu 2 po ~120 ms) telefon pobiera plan w ~1 s i przechodzi w pytanie 1 o planowanym czasie (odchylenie ≤ 1,5 s; zwykle < 0,6 s).
actual: Telefon 2 stał na ekranie loading ~17,5 s; zmiana fazy DOM dla pytania 1 +7731 ms (próbka +7809 ms). Snapshot wysłany w lobby o T−3,2 s dostał odpowiedź po 20,9 s (odpowiedź zawierała już `running` → serwer obsłużył żądanie po starcie, tzn. żądanie utknęło na połączeniu). Hook useParticipantGame.js (~159–227) dopuszcza tylko jeden snapshot w locie i nie ma limitu czasu.
  Dodatkowo: opóźnienia callbacku VT do 565 ms mimo limitu 150 ms; w przebiegu 01 DOM zmienił się dopiero przy callbacku VT po 333 ms. Przebiegi 01–04: start DOM 245–554 ms wobec 8–91 ms w 06-13.
errors: brak (sonda kod 1 na kryterium odchylenia startu).
reproduction: Sonda produkcyjna (nie uruchamiać). Lokalnie: Vitest z wiszącym getParticipantState + wiersz Realtime `running` → asercja: plan w limicie.
started: 2026-09-27, seria 06-17, przebieg 5 z 5. Nie widziane w 11 przebiegach 06-13.

## Eliminated

## Evidence

- timestamp: 2026-09-27T20:00:00Z
  checked: knowledge-base.md
  found: brak dopasowania (jedyny wpis dotyczy RLS profiles)
  implication: brak znanego wzorca

- timestamp: 2026-09-27T20:10:00Z
  checked: src/hooks/useParticipantGame.js snapshot() (159–227) i src/lib/supabase.js getParticipantState (1044–1058)
  found: snapshot jedno-w-locie (inFlightRef) — każde kolejne wywołanie tylko do pendingRef; getParticipantState woła supabase.rpc bez abortSignal i bez limitu; hook też nie ma limitu. Zwolnienie inFlightRef wyłącznie w finally po odpowiedzi.
  implication: jedno zawieszone żądanie blokuje wszystkie kolejne snapshoty (w tym start z includePlan) na czas swojego trwania

- timestamp: 2026-09-27T20:15:00Z
  checked: probe-trace …190258.253Z (przebieg 05), telefon 2, czasy względem kotwicy
  found: snap −8,20→−7,80 (waiting); snap wysłany −3,18, odebrany 17,70 (RTT 20 883, running); wiersz Realtime running 0,116/0,117; faza loading od 0,183 do 17,731 (quiz|1); kolejny snap 17,716→17,975 (to needFresh z H1, bo wiersz przyszedł w trakcie). Telefon 1: snap z planem 0,213→0,344, quiz|1 o 10,042.
  implication: dokładnie mechanizm z GATE — start-snapshot (jitter 0–1 s po wierszu) czekał w pendingRef ~17 s. Snap −3,18 to siatka bezpieczeństwa (15 s, losowy start).

- timestamp: 2026-09-27T20:20:00Z
  checked: node_modules/@supabase/postgrest-js 2.104.1 (supabase-js 2.104.1 zainstalowany)
  found: builder ma .abortSignal(signal); automatyczne ponawianie tylko GET/HEAD/OPTIONS z 520/503 — rpc to POST, więc RTT 20,9 s to jedno żądanie, nie seria ponowień biblioteki
  implication: można anulować żądanie AbortControllerem; ponawianie trzeba zrobić samemu

- timestamp: 2026-09-27T20:25:00Z
  checked: RTT wszystkich snapshotów we wszystkich 16 zrzutach (06-13 + 06-17), ~450 żądań
  found: > 1 s: 1386, 1285, 3946, 4685, 1959, 20883 ms (wszystkie HTTP 200)
  implication: długi ogon realny; limit 4 s ubije 1–2 wolne-ale-udane żądania (tanie ponowienie ~100 ms), 20,9 s — skrajność

- timestamp: 2026-09-27T20:35:00Z
  checked: VT we wszystkich przebiegach podstawowych: spóźnienie wywołania VT względem granicy planu (rAF), cb−call, DOM−call
  found: 06-13 (5 przebiegów): przejścia countdown→quiz spóźnione ≤ 36 ms, cb ≤ 123 ms. 06-17: countdown→quiz spóźnione 88–464 ms (JUŻ przed wywołaniem VT — rAF późno) i cb 109–546 ms; w KAŻDYM przypadku cb > 150 ms zmiana DOM = cb + 2–5 ms (nigdy ~150 ms). Plan identyczny we wszystkich 10 przebiegach. Kod telefonu między 06-13 a 06-17 różni się tylko fccde16 (brak pracy per klatka); sonda — tylko raport i klik pauzy w FULL.
  implication: przed VT wątek/klatki telefonu były już zdławione (rAF późno) — regresja 06-13→06-17 wygląda na środowiskową (obciążenie maszyny sondy), nie na kod 06-16; A/B na produkcji niedozwolony teraz.

- timestamp: 2026-09-27T20:45:00Z
  checked: eksperyment lokalny, headless Chromium (Playwright): startViewTransition + skipTransition
  found: (1) skip przed callbackiem w lekkiej stronie → callback po ~2 ms; (2) zajęty wątek główny 400 ms → timer 150 ms odpala dopiero po 408 ms, callback 409 ms; (3) ciężki raster (400 rozmytych warstw, 3000×3000), wątek wolny: timer 156 ms, applied=false, skipTransition() — a callback dopiero po 24 112 ms; w innej próbie timer odpalił dopiero po 37 393 ms (wątek główny zablokowany przechwytywaniem).
  implication: po wywołaniu startViewTransition skipTransition NIE przyspiesza callbacku, gdy trwa przechwytywanie starego stanu; renderowanie strony jest zamrożone do końca przechwycenia, a wątek główny bywa zablokowany (timer limitu też). Limit 150 ms jest poprawny logicznie, ale nieskuteczny z konstrukcji na wolnym renderze. Jedyna skuteczna ochrona: nie zaczynać VT, gdy render jest wolny (adaptacyjnie).

- timestamp: 2026-09-27T20:57:00Z
  checked: nowy test src/hooks/useParticipantGame.test.js na NIEZMIENIONYM kodzie (Vitest, fałszywe zegary, mock supabase z ręcznie sterowanymi odpowiedziami i handlerem wiersza Realtime)
  found: replika przebiegu 05 FAIL „expected 2 to be ≥ 3” — po wierszu startu przez 1,5 s nie wychodzi żadne nowe żądanie (czeka w pendingRef za zawieszonym); zawieszony snapshot z montażu — brak ponowienia po 4 s; VT: limit 150 ms w logice działa (faza quiz po 150 ms przy callbacku 400 ms), ale kolejne przejście znów startuje VT
  implication: błąd odtworzony lokalnie; logika limitu VT poprawna — brakuje ochrony przed wolnym przechwyceniem (adaptacji)

- timestamp: 2026-09-27T21:00:00Z
  checked: realny klient supabase-js 2.104.1 z wiszącym fetch + AbortController (node)
  found: rpc(...).abortSignal(signal) przekazuje sygnał do fetch; abort po 200 ms → obietnica rozstrzygnięta po 216 ms z error „AbortError: aborted”
  implication: anulowanie w getParticipantState działa naprawdę (zwalnia żądanie), nie tylko w mocku

- timestamp: 2026-09-27T21:01:00Z
  checked: npm test (214/214, w tym 7 nowych testów hooka i 4 czyste VT) + npm run build
  found: wszystko zielone; replika przebiegu 05: nowe żądanie z planem ≤ 1 s po wierszu startu, faza intro, potem quiz o czasie planu; spóźniona odpowiedź zawieszonego żądania nie zmienia stanu (running + plan zostają)
  implication: poprawka zweryfikowana lokalnie; weryfikacja w warunkach rzeczywistych = ponowna seria sond 06-17 (wymaga zgody użytkownika)

## Resolution

root_cause: |
  (G7) useParticipantGame.snapshot() działa w trybie jedno-w-locie i nie miał limitu czasu (ani w hooku, ani w getParticipantState). Snapshot siatki bezpieczeństwa wysłany w lobby o T−3,18 s utknął przed serwerem na 20,9 s. Wiersz Realtime startu dotarł po 0,12 s, ale wywołanie z includePlan (po jitterze) trafiło tylko do pendingRef i czekało na zwolnienie inFlightRef. Bez planu nie ma fazy, więc telefon 2 stał na ekranie ładowania do 17,7 s i wszedł w pytanie 1 z opóźnieniem +7,7 s. Mechanizm istniał przed 06-16. Zmiana H1 z 06-16 (keepControl + needFresh) niczego nie pogorszyła: dołożyła tylko jedno dociągnięcie po 17,7 s.
  (VT, wątek poboczny) Logika limitu 150 ms jest poprawna (test z fałszywymi zegarami), ale nieskuteczna z założenia. Po startViewTransition() render jest zamrożony do końca przechwycenia starego ekranu, a skipTransition() go nie skraca. Przy zdławionym renderze stoi też wątek główny, więc timer limitu odpala późno. W 06-17 wszystkie przypadki cb > 150 ms mają zmianę DOM razem z callbackiem. Gorsze wyniki 06-17 niż 06-13 (countdown→quiz: rAF spóźniony o 88–464 ms już PRZED wywołaniem VT) przy identycznym planie i bez zmian w kodzie ścieżki klatki wskazują na zdławienie środowiska sondy, nie na regresję w kodzie 06-15/06-16. Rozstrzygnięcie wymagałoby A/B na produkcji, którego teraz nie robiono.
fix: |
  1) getParticipantState przyjmuje { signal } → supabase.rpc(...).abortSignal(signal).
  2) snapshot(): wyścig z terminem 4 s (SNAPSHOT_TIMEOUT_MS). Po terminie żądanie jest anulowane, a spóźniona odpowiedź ignorowana, bo obietnica jest już rozstrzygnięta i nie ma commit (gwarancje H1 bez zmian). Termin to zwykły setTimeout, więc sprzątanie w StrictMode go nie kasuje.
  3) Kotwica bez planu i snapshot w locie wysłany PRZED ostatnim wierszem Realtime → termin skracany do „wysłanie + 1,5 s” (STALE_PLAN_WAIT_MS), a oczekujące wywołanie z planem idzie od razu. Zdrowe żądanie wysłane po wierszu nie jest ruszane.
  4) Ponowienie po terminie: bez sesji albo z kotwicą bez planu pierwsze od razu, kolejne z rozrzutem 0–1 s. Poza tym rozrzut z narastającą przerwą 0,5–1 s … do 8 s, żeby nie było burzy ponowień przy 500 telefonach. Przy timeout nie ma „error”, dopóki trwa ponawianie.
  5) VT: nowy src/lib/viewTransition.js (czyste shouldStartViewTransition / isSlowViewTransition). pushView nie startuje przejścia, gdy przerwa między klatkami rAF przekracza 100 ms. Pierwsze przejście ponad limit 150 ms (późny callback albo zadziałanie limitu) wyłącza VT do końca życia hooka. Limit 150 ms zostaje jako siatka.
verification: |
  Lokalnie: test regresyjny (replika przebiegu 05) na starym kodzie FAIL („expected 2 to be ≥ 3”), po poprawce PASS. npm test 214/214, npm run build OK. Abort sprawdzony na prawdziwym kliencie supabase-js. Eksperyment VT w headless Chromium potwierdził mechanizm.
  Do zrobienia: powtórzenie serii sond 06-17 (5 przebiegów podstawowych + tryby pauzy), za zgodą użytkownika.
files_changed:
  - src/lib/supabase.js
  - src/hooks/useParticipantGame.js
  - src/hooks/useParticipantGame.test.js
  - src/lib/viewTransition.js
  - src/lib/viewTransition.test.js
commits: [58b5af0, 308b9c9]
