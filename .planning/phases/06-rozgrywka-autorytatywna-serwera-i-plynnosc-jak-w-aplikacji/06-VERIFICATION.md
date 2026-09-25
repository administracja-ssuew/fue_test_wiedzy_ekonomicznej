---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
verified: 2026-09-25T20:19:37Z
status: gaps_found
score: 7/14 must-haves verified (7/7 kryteriów ROADMAP SC1–SC6 + P6-FLUID; 0/7 prawd z bramki 06-09 i sondy 06-10)
gaps:
  - truth: "G1: Poprawna odpowiedź jest widoczna na telefonie 10 s po zamknięciu pytania, zanim ruszy odliczanie do następnego"
    status: failed
    reason: "REVEAL_SECONDS = 6 (src/lib/gameLogic.js:11) i stała 6000 w build_session_plan (SUPABASE_FIXES.sql:1412). Bramka odsłony to closes + 1,5 s, więc poprawna odpowiedź jest widoczna ok. 4,5 s. Użytkownik: wygląda jak mignięcie."
    artifacts:
      - path: "src/lib/gameLogic.js"
        issue: "REVEAL_SECONDS = 6"
      - path: "SUPABASE_FIXES.sql"
        issue: "build_session_plan: v_r := v_c + 6000 (sekcja 39.4); komentarz o stałych 10/30/4/6"
      - path: "src/lib/plan.fixtures.json"
        issue: "fixture'y JS↔SQL liczone przy reveal 6 s"
    missing:
      - "Ustalić z użytkownikiem interpretację: 10 s WIDOCZNOŚCI poprawnej odpowiedzi (okno reveal = 1,5 s bramki + 10 s = 11,5 s) czy okno reveal = 10 s (widoczność 8,5 s). Decyzja w 06-09-DEPLOY.md mówi o widoczności 10 s."
      - "Zmiana REVEAL w src/lib/gameLogic.js/plan.js i w nowej sekcji SQL (42) z CREATE OR REPLACE build_session_plan o tej samej sygnaturze (addytywnie, SC6); dotyczy tylko nowych sesji, zamrożone plany bez zmian"
      - "Aktualizacja plan.fixtures.json + plan.test.js + npm run verify-plan (parzystość JS↔SQL)"
      - "Aktualizacja oczekiwań sondy (widoczność pytania = tpq + reveal, dziś 26 s przy tpq 20) i komentarzy o 10 s przerwy między pytaniami"
      - "Opcjonalnie: potwierdzić pod obciążeniem, że bramka 1,5 s jest stała (zegar serwera, niezależna od liczby osób)"
  - truth: "G2: Pauza wciśnięta w fazie reveal albo countdown nie pomija żadnego pytania — po wznowieniu faza, pytanie i licznik są takie jak przed pauzą"
    status: failed
    reason: "Użytkownik zaobserwował na telefonach, że po pauzie w reveal/countdown wygląda, jakby jedno pytanie zostało pominięte. Sonda sprawdza pauzę wyłącznie w fazie quiz (scripts/probe-gameplay.js:587, warunek ph === 'quiz'), więc ten scenariusz nie ma pokrycia. Statyczny odczyt SQL (admin_pause_session / admin_resume_session) i plan.js (resumeAnchor) nie pokazuje oczywistego błędu, więc przyczyny trzeba szukać w dynamice klienta/panelu."
    artifacts:
      - path: "scripts/probe-gameplay.js"
        issue: "brak trybu pauzy w reveal i w countdown"
      - path: "src/hooks/useParticipantGame.js"
        issue: "hipoteza: snapshot wysłany przed zatwierdzeniem pauzy/wznowienia wraca po zdarzeniu Realtime i nadpisuje nowszy stan sesji (applySnapshot nie porównuje świeżości)"
      - path: "src/screens/AdminPanel.jsx"
        issue: "hipoteza: auto-skrót (shouldEndEarly) jest aktywny dla modułów z tpq ≥ 45 s (dziś 60 i 75 s); goToNextQuestion bierze idx z planPos() w chwili wywołania, a nie idx ocenionego przed await (linie 733–754, 994–997). Do tego confirm() przed pauzą opóźnia moment pauzy"
      - path: "src/hooks/useLiveProjection.js"
        issue: "hipoteza (percepcja): w pauzie w countdown podgląd i nagłówek panelu pokazują już numer NASTĘPNEGO pytania (plan_position zwraca kolejny item przed jego otwarciem)"
    missing:
      - "/gsd:debug z odtworzeniem: pauza w reveal pytania N i w countdown przed N+1, na modułach z tpq 20 s i z tpq ≥ 45 s (auto-skrót)"
      - "Nowy tryb sondy (np. PROBE_PAUSE_PHASE=reveal|countdown): pauza w zadanej fazie, asercja, że po wznowieniu t1/t2 mają tę samą fazę, pytanie i licznik (±1 s), żadne pytanie nie ma czasu widoczności < tpq, a current_question_idx w bazie idzie po kolei"
      - "Poprawka przyczyny i test regresyjny Vitest (plan.js / participantState.js) dla pauzy na granicach faz"
  - truth: "G3: Po module 2 i po module 4 quiz sam zatrzymuje się na przerwie i czeka na ręczne „Wznów” admina (bez stałej długości przerwy)"
    status: failed
    reason: "Nie zaimplementowane. Zgodnie z wcześniejszą decyzją w 06-CONTEXT.md przerwy nie były w planie (ręczna pauza admina). Użytkownik zmienił decyzję w 06-09. build_session_plan i buildPlanItems nie znają przerw, zamiatacz nigdy sam nie pauzuje, a Break.jsx ma nieużywany tryb „Przerwa – Moduł X rozpocznie się za chwilę” (App zawsze przekazuje isAdminPause)."
    artifacts:
      - path: "src/lib/plan.js"
        issue: "brak znacznika przerwy w items i brak fazy przerwy w planPosition/sweepDecision"
      - path: "SUPABASE_FIXES.sql"
        issue: "build_session_plan / sweep_decision / advance_due_sessions bez automatycznego zatrzymania po module 2 i 4"
      - path: "src/App.jsx"
        issue: "case 'paused' zawsze renderuje Break z isAdminPause (brak rozróżnienia przerwy planowej)"
    missing:
      - "Model przerwy w planie: np. znacznik hold na ostatnim pytaniu modułu 2 i 4 (albo na pierwszym pytaniu modułu 3 i 5), plus idempotentny sposób zapamiętania, że przerwa została już zwolniona (np. nullable kolumna holds_released albo przesunięcie kotwicy przy wznowieniu, bez ponownego zatrzymania)"
      - "Zamiatacz ustawia plan_paused_at dokładnie na granicy (anchor + r ostatniego pytania modułu), status 'paused'; wznowienie = istniejący admin_resume_session (przesunięcie kotwicy)"
      - "Lustro w plan.js + fixture'y + verify-plan; migracja addytywna (nowa sekcja SQL, SC6)"
      - "Telefon w przerwie planowej: ekran „Przerwa” z numerem następnego modułu (Break.jsx ma gotowy tryb), panel admina: wyraźny przycisk „Wznów” po przerwie"
      - "Konfigurowalność: po których modułach przerwa (dziś 2 i 4) — stała w planie albo pole modułu"
  - truth: "G4: Po ostatnim pytaniu telefony same pokazują ekran końcowy „Koniec testu” z wynikiem uczestnika; podium na rzutniku odsłania ręcznie admin"
    status: partial
    reason: "Częściowo jest. Po ostatnim reveal telefon pokazuje WaitingResults („Koniec testu!”, bez wyniku, tekst „Za chwilę administrator ogłosi wyniki”). Po ok. 1–1,3 s zamiatacz ustawia status 'results' i telefon przechodzi na Ended („Ukończyłeś Test!” + poprawne/łącznie). Mianownik w Ended to jednak liczba własnych wierszy odpowiedzi (allAnswers.length), a nie liczba pytań w planie (patrz G6). Użytkownik zgłosił to w teście jako niespełnione, a nie wiemy, co dokładnie zobaczył: czy telefon utknął na „czekam na ogłoszenie”, czy chodziło o tekst albo brak wyniku."
    artifacts:
      - path: "src/screens/WaitingResults.jsx"
        issue: "„Koniec testu!” bez wyniku, komunikat o oczekiwaniu na admina"
      - path: "src/screens/Ended.jsx"
        issue: "totalQ = allAnswers.length (nie długość planu); nagłówek „Ukończyłeś Test!” zamiast „Koniec testu”"
      - path: "src/App.jsx"
        issue: "case 'finished' → WaitingResults; case 'results' → Ended z allAnswers z myAnswers"
    missing:
      - "Jeden ekran końcowy „Koniec testu” + wynik (poprawne / liczba pytań w planie) pokazywany automatycznie od fazy finished/results, bez żadnego kroku admina"
      - "Wynik liczony po bramce ostatniego pytania (poprawność z serwera; finished może wymagać snapshotu z correct_total po closes+1,5 s ostatniego pytania)"
      - "Podium (Podium.jsx / broadcast podium) bez zmian — ręcznie z panelu"
      - "Potwierdzenie z użytkownikiem, co dokładnie było nie tak w teście"
  - truth: "G5: W zakładce Historia admin pobiera dla sesji z archiwum XLSX z raportem per uczestnik (czas i poprawność każdej odpowiedzi)"
    status: failed
    reason: "HistoriaTab (src/screens/AdminPanel.jsx:1637–1723) ma tylko ranking i eksport CSV. XLSX (exportResultsXlsx, linie 878–957) działa tylko dla bieżącej sesji. Pułapka: get_session_detailed_results (SUPABASE_FIXES.sql:1164) bierze uczestników z participant_codes.session_id = p_session_id, a mark_code_used (sekcja 24) przepina session_id na NAJNOWSZĄ sesję. Dla sesji z archiwum (i dla testu właściwego po próbie, jeśli ktoś potem wszedł na inną sesję) uczestnicy znikną z raportu. Pytania są brane z bieżącej puli miasta, a nie z planu sesji."
    artifacts:
      - path: "src/screens/AdminPanel.jsx"
        issue: "HistoriaTab bez przycisku XLSX; logika XLSX zaszyta w SesjaTab"
      - path: "SUPABASE_FIXES.sql"
        issue: "get_session_detailed_results: uczestnicy z participant_codes.session_id, pytania z questions miasta, nie z session_plans"
    missing:
      - "Wydzielić budowę skoroszytu (ranking + płasko + arkusz per uczestnik) do funkcji wielokrotnego użytku (np. src/lib/resultsXlsx.js) z testem Vitest"
      - "Przycisk „📥 XLSX” w HistoriaTab dla wybranej sesji"
      - "Nowy/rozszerzony RPC (addytywnie, nowa nazwa albo ta sama sygnatura): uczestnicy z answers.session_id (DISTINCT participant_code), pytania i kolejność z session_plans.items dla sesji z planem (fallback: pula miasta dla sesji bez planu), brak wiersza = brak odpowiedzi"
  - truth: "G6: Brak odpowiedzi liczy się jako błędna — kolumna „Pytań” (i suma) w rankingu, eksportach i na ekranie końcowym = liczba pytań w planie sesji"
    status: failed
    reason: "get_session_results (SUPABASE_FIXES.sql:928–941) liczy total_count = COUNT(*) wierszy answers uczestnika. Kto odpadł w trakcie (albo telefon nie wysłał pustego zapisu po terminie), ma mniejszy mianownik. To samo w Ended.jsx (allAnswers.length), w eksporcie CSV/XLSX (r.total) i w HistoriaTab."
    artifacts:
      - path: "SUPABASE_FIXES.sql"
        issue: "get_session_results: COUNT(*) z answers zamiast jsonb_array_length(session_plans.items)"
      - path: "src/screens/Ended.jsx"
        issue: "totalQ = allAnswers.length"
      - path: "src/screens/AdminPanel.jsx"
        issue: "ranking/CSV/XLSX: r.total z get_session_results"
    missing:
      - "Nowa sekcja SQL: get_session_results z total_count = liczba pytań w planie sesji (dla sesji bez planu: liczba pytań miasta albo dotychczasowe zachowanie), ta sama sygnatura RETURNS TABLE (SC6), ranking bez zmian (poprawne DESC, śr. czas ASC)"
      - "Średni czas: decyzja, czy brak odpowiedzi wchodzi do średniej jako tpq (dziś pusty zapis ma response_time_ms = tpq*1000, a brak wiersza nie wchodzi wcale)"
      - "Ended: mianownik = gamePlan.length; skuteczność % w XLSX liczona od planu"
  - truth: "G7: Start każdego pytania na telefonach mieści się w 1,5 s od planu w każdym przebiegu sondy (brak niestabilności)"
    status: failed
    reason: "06-10, przebieg 1 sondy podstawowej na prod: pytanie 2 wystartowało na obu telefonach testowych 1,9–2,8 s po planie (limit 1,5 s), widoczność 23,2 s zamiast 26 s, kod 1. Baza była zgodna z planem (89/89), więc opóźnienie powstało po stronie klienta. Powtórka przeszła (kod 0). Przyczyna nie jest znana, a opóźnienie dotknęło obu telefonów naraz."
    artifacts:
      - path: "src/hooks/useParticipantGame.js"
        issue: "hipotezy: (a) pushView przez document.startViewTransition + flushSync odkłada setView do asynchronicznego callbacku, co może opóźnić zmianę fazy o klatki/sekundy przy zdławionym renderowaniu; (b) addClockSample ze snapshotu przesuwa offset serverNow(); (c) stary snapshot nadpisuje świeższy stan (to samo co w G2)"
      - path: "scripts/probe-gameplay.js"
        issue: "brak śladu (PROBE_TRACE) z przebiegu, który padł; brak zapisu offsetu zegara telefonu w chwili opóźnienia"
    missing:
      - "Zbadać razem z G2 w jednym /gsd:debug: powtarzalne przebiegi sondy (N ≥ 5) z PROBE_TRACE=1, zapis serverNow-offset i momentu zmiany data-fue-phase vs moment startViewTransition na obu telefonach"
      - "Jeśli przyczyną jest View Transition: przełączenie fazy nie może czekać na callback (np. setView natychmiast, animacja tylko kosmetyczna) albo pominięcie przejścia, gdy poprzednie jeszcze trwa"
      - "Kryterium zamknięcia: 5 kolejnych przebiegów sondy podstawowej + PROBE_ADMIN_EXIT z kodem 0"
---

# Phase 6: Rozgrywka autorytatywna serwera i płynność jak w aplikacji — raport weryfikacji

**Cel fazy:** Rozgrywka mechanicznie nie do podważenia: przebieg quizu wynika z planu zamrożonego w bazie przy starcie i zegara serwera, przejścia wykonuje baza, a odświeżenie, wygaszenie ekranu czy zamknięcie przeglądarki admina niczego nie zmieniają. Do tego płynność „jak w aplikacji” na natywnych API.
**Zweryfikowano:** 2026-09-25T20:19:37Z
**Status:** gaps_found
**Ponowna weryfikacja:** nie, to pierwsza weryfikacja

## Osiągnięcie celu

Jeśli liczyć tylko formalne kryteria ROADMAP (SC1–SC6 i P6-FLUID), rdzeń fazy jest zrobiony i działa na produkcji. Plan jest zamrażany w `session_plans`, fazę liczy `plan_position`/`planPosition` (parzystość JS↔SQL 29/29), przejścia wykonuje `advance_due_sessions` z pg_cron co 1 s (zamiatacz żyje, ostatni przebieg 0,5 s temu), a front nie zapisuje żadnych przejść. Produkcja serwuje ten sam bundle co lokalny build HEAD (`index-D2z1WioU.js`, czyli razem z 06-11).

Test na prawdziwych telefonach (06-09) wykazał jednak 6 problemów z decyzjami użytkownika, a sonda w 06-10 raz dała niestabilny wynik. Błąd pauzy (G2) i spóźniony start pytania (G7) podważają „mechaniczną niepodważalność” w oczach użytkownika. G1, G3, G4, G5 i G6 to wymagania wydarzenia TWE, których dziś brakuje. Dlatego status to **gaps_found**.

### Obserwowalne prawdy

| # | Prawda | Status | Dowód |
|---|--------|--------|-------|
| 1 | SC1: admin zamyka przeglądarkę po starcie, a wszystkie pytania i przejście do wyników idą na czas | ✓ ZWERYFIKOWANE | `advance_due_sessions` + `cron.schedule('fue-advance-due','1 seconds')` (SQL:1906, 2004). Zamiatacz żyje (verify-prod dziś: 0,5 s). W `src` brak zapisu przejść (grep `advance_session_question` = 0, w `dist` 0). Sonda ADMIN_EXIT kod 0 w 06-08, 06-09 (na wdrożeniu) i 06-11 |
| 2 | SC2: refresh w każdej fazie przywraca fazę i licznik (≤ 1 s), odpowiedź zostaje zablokowana | ✓ ZWERYFIKOWANE | `initialGame` z `fue_game_cache` (w tym `myAnswers`), snapshot `get_participant_state`, cache w localStorage. Sonda REFRESH w 06-08: 5 faz, różnica 0 s, blokada od 1. klatki. Po 06-11 nie było ponownego przebiegu, ale 06-11 nie ruszał hooka uczestnika |
| 3 | SC3: 10 s offline w pytaniu → po powrocie od razu właściwa faza | ✓ ZWERYFIKOWANE | Projekcja lokalna z planu + `online`/`visibilitychange` → snapshot (useParticipantGame.js:240–247). Sonda OFFLINE kod 0 (06-08), pełna zgodność 135 ms po powrocie |
| 4 | SC4: czas pytania z planu sesji, nie z modułów klienta | ✓ ZWERYFIKOWANE | Quiz.jsx: `item.tpq`. `timePerQ` = 0 trafień w App/Quiz/useParticipantGame. useLiveProjection: `planTpq ?? 0`. Panel: `pos.item.tpq` |
| 5 | SC5: poprawna odpowiedź nie trafia do klienta przed końcem czasu; punktacja zegarem serwera | ✓ ZWERYFIKOWANE | `submit_answer_v2` zwraca tylko `{accepted, duplicate, chosen}` i liczy czas z `clock_timestamp()`. Snapshot i summary v2 bramkują `c + 1500`. Sekcja 41 utwardza stare RPC (verify-prod: `schema_marker_41` ✅). Sonda: 21 asercji SC5 OK w każdym przebiegu |
| 6 | SC6: migracje addytywne, stary front działa do wdrożenia nowego | ✓ ZWERYFIKOWANE | Sekcje 39–41: nowe tabele/kolumny nullable, CREATE OR REPLACE z tymi samymi sygnaturami. verify-prod 45 OK (w tym stare sygnatury). Regresja starego buildu w 06-03 bez zmian względem stanu sprzed SQL |
| 7 | P6-FLUID: Wake Lock, pasek CSS z terminu, vibrate, View Transitions, prefetch, szkielet, reduced-motion | ✓ ZWERYFIKOWANE (kod) / ogólna akceptacja na telefonach | useWakeLock.js (`wakeLock.request`, `visibilitychange`), global.css (`fueDrain`/`fueRing`, `::view-transition`, `prefers-reduced-motion`), Quiz.jsx (`animationDelay`, `navigator.vibrate`), hook (`startViewTransition`, `new Image()`), App (`QuizSkeleton`). Użytkownik: „działa dobrze”, bez rozbicia na platformy |
| 8 | G1: poprawna odpowiedź widoczna 10 s | ✗ NIEZREALIZOWANE | REVEAL 6 s → widoczność ok. 4,5 s |
| 9 | G2: pauza w reveal/countdown nie pomija pytania | ✗ NIEZREALIZOWANE | zgłoszenie użytkownika; sonda nie pokrywa tego scenariusza |
| 10 | G3: automatyczne przerwy po modułach 2 i 4, wznowienie ręczne | ✗ NIEZREALIZOWANE | brak w planie i zamiataczu |
| 11 | G4: telefony same pokazują „Koniec testu” + wynik | ⚠️ CZĘŚCIOWO | WaitingResults bez wyniku → Ended z wynikiem po `results` od zamiatacza; zły mianownik |
| 12 | G5: XLSX per uczestnik w Historii | ✗ NIEZREALIZOWANE | Historia ma tylko CSV rankingu |
| 13 | G6: brak odpowiedzi = błędna, mianownik = plan | ✗ NIEZREALIZOWANE | `total_count = COUNT(*)` z answers |
| 14 | G7: stabilny start pytań (≤ 1,5 s) w każdym przebiegu | ✗ NIEZREALIZOWANE | 06-10 przebieg 1: 1,9–2,8 s na obu telefonach |

**Wynik:** 7/14 prawd (7/7 kryteriów ROADMAP; 0/7 prawd z bramki i sondy, w tym 1 częściowa)

### Wymagane artefakty

| Artefakt | Oczekiwane | Status | Szczegóły |
|----------|------------|--------|-----------|
| `src/lib/plan.js` | czysta logika planu (lustro SQL) | ✓ | 134 linie, importowany przez hook, useLiveProjection, AdminPanel, supabase.js (DEMO) |
| `src/lib/plan.fixtures.json` + `plan.test.js` | kontrakt JS↔SQL | ✓ | 60 testów; verify-plan 29/29 |
| `SUPABASE_FIXES.sql` §39–41 | plan, RPC v2, akcje admina, zamiatacz, pg_cron, utwardzenie | ✓ | wgrane (verify-prod 45 OK) |
| `src/lib/participantState.js` | localStorage + snapshot/merge | ✓ | 16 testów |
| `src/hooks/useParticipantGame.js` | jedyne źródło fazy uczestnika | ✓ | użyty w App.jsx:45 |
| `src/App.jsx` / `Quiz.jsx` / `Break.jsx` / `WaitingResults.jsx` | routing i ekrany z planu | ✓ | `data-fue-*` ustawiane (App.jsx:125–129) |
| `src/hooks/useLiveProjection.js` | LiveView z planu, reveal po bramce | ✓ | `getSessionPlan`, `getAnswerSummaryV2` |
| `src/screens/AdminPanel.jsx` | akcje v2, brak kierowcy, baner zamiatacza | ✓ | 5 wywołań v2; brak `advanceSessionQuestion` |
| `src/hooks/useWakeLock.js`, `src/styles/global.css` | płynność | ✓ | użyte w App / Quiz |
| `scripts/probe-gameplay.js` | tryby ADMIN_EXIT/REFRESH/OFFLINE, SC5 | ✓ | brak trybu pauzy w reveal/countdown (G2) |
| `scripts/verify-plan.js`, `scripts/verify-prod.js`, `scripts/check-planless.js` | weryfikacja prod | ✓ | uruchomione dziś: kod 0 |

### Weryfikacja kluczowych powiązań

Narzędzie `gsd-tools verify key-links` zgłosiło fałszywe negatywy: podwójnie escapowane regexy i źródła, które są opisem, a nie plikiem. Każde powiązanie sprawdzono ręcznie:

| Od | Do | Przez | Status |
|----|----|-------|--------|
| plan.test.js | plan.fixtures.json | import (11 trafień) | ✓ WIRED |
| plan.js | gameLogic.js | import REVEAL/INTRO/LEAD (plan.js:1) | ✓ WIRED |
| cron `fue-advance-due` | `advance_due_sessions()` | SQL:2004 | ✓ WIRED (sweeper_status żywy) |
| `advance_due_sessions` | `sweep_decision` → `plan_position` | SQL:1917, 1364 | ✓ WIRED |
| verify-plan.js | fixtures + RPC | import (l. 16) | ✓ WIRED |
| useParticipantGame | `getParticipantState`, `addClockSample` | l. 154, 164 | ✓ WIRED |
| App.jsx | useParticipantGame / `dataset.fuePhase` | l. 45, 125 | ✓ WIRED |
| useLiveProjection | `getSessionPlan` / `getAnswerSummaryV2` | l. 70, 142 | ✓ WIRED |
| AdminPanel | `adminSkip/Pause/Resume/Repeat` | l. 996, 1124, 1144, 1154 | ✓ WIRED |
| App.jsx | useWakeLock | l. 59 | ✓ WIRED |
| stary `submit_answer` | `submit_answer_v2` | SQL:2074 | ✓ WIRED |
| AdminPanel | `advanceSessionQuestion` (ma NIE istnieć) | — | ✓ usunięte |

### Śledzenie przepływu danych (poziom 4)

| Artefakt | Zmienna | Źródło | Prawdziwe dane | Status |
|----------|---------|--------|----------------|--------|
| App → Quiz | `gv` (faza, item, secondsLeft) | `projectPlanState` z planu i kotwicy ze snapshotu `get_participant_state` | tak (tabela session_plans + quiz_sessions) | ✓ FLOWING |
| Quiz | `correctAns` | `revealAnsFor(revealed_*, reveal)` z Realtime/snapshotu po bramce | tak | ✓ FLOWING |
| Ended | `allAnswers` / `totalQ` | `game.myAnswers` | tak, ale mianownik = liczba odpowiedzi, nie plan (G6) | ⚠️ częściowo |
| LiveView | faza/timer | `projectPlanState` + `getSessionPlan` | tak | ✓ FLOWING |
| HistoriaTab | `results` | `get_session_results` | tak; `total` = liczba wierszy (G6) | ⚠️ częściowo |

### Sprawdzenia behawioralne

| Zachowanie | Komenda | Wynik | Status |
|------------|---------|-------|--------|
| Testy jednostkowe | `npm test` | 5 plików, 112 testów zielonych | ✓ PASS |
| Build produkcyjny | `npm run build` | kod 0, `index-D2z1WioU.js` | ✓ PASS |
| Kontrakt SQL na prod (read-only) | `npm run verify-prod` | „PRODUKCJA GOTOWA pod kątem SQL (45 OK)”, zamiatacz 0,5 s | ✓ PASS |
| Parzystość JS↔SQL | `npm run verify-plan` | 29/29 | ✓ PASS |
| Wdrożenie = HEAD | GET https://fue-quiz.vercel.app/ | `assets/index-D2z1WioU.js` = lokalny dist | ✓ PASS |
| Sondy e2e (zapisują na prod) | — | nie uruchamiane (zakaz); wyniki z SUMMARY 06-08/09/10/11 | ? SKIP |

### Pokrycie wymagań

REQUIREMENTS.md nie zawiera identyfikatorów P6-*. Są to robocze ID z ROADMAP (faza 6). Każde ID występuje w `requirements:` co najmniej jednego planu, więc żadne wymaganie nie jest osierocone.

| Wymaganie | Plany | Opis | Status | Dowód |
|-----------|-------|------|--------|-------|
| P6-SC1 | 01,02,03,05,06,08,09,11 | admin zamyka przeglądarkę → quiz idzie dalej | ✓ SPEŁNIONE | prawda 1 |
| P6-SC2 | 01,04,05,08 | refresh przywraca fazę, odpowiedź zablokowana | ✓ SPEŁNIONE | prawda 2 |
| P6-SC3 | 04,05,08 | 10 s offline | ✓ SPEŁNIONE | prawda 3 |
| P6-SC4 | 01,02,05,06,11 | czas z planu | ✓ SPEŁNIONE | prawda 4 |
| P6-SC5 | 01,02,04,06,08,10 | brak wycieku poprawności, zegar serwera | ✓ SPEŁNIONE | prawda 5 |
| P6-SC6 | 02,03,09,10 | migracje addytywne | ✓ SPEŁNIONE | prawda 6 |
| P6-FLUID | 07,09 | płynność na natywnych API | ✓ SPEŁNIONE (kod) / ? szczegóły per platforma | prawda 7 |

Luki G1–G7 nie mają jeszcze ID wymagań. Proponowane robocze ID dla planów gap closure: P6-GAP-REVEAL10, P6-GAP-PAUSE, P6-GAP-BREAKS, P6-GAP-ENDSCREEN, P6-GAP-HISTXLSX, P6-GAP-DENOM, P6-GAP-FLAKY.

### Znalezione antywzorce

| Plik | Linia | Wzorzec | Waga | Wpływ |
|------|-------|---------|------|-------|
| src/screens/Ended.jsx | 39 | mianownik z `allAnswers.length` | ⚠️ Ostrzeżenie | niepoprawny wynik „X / Y” dla osób, które odpadły (G6) |
| SUPABASE_FIXES.sql | 1195 | `participant_codes.session_id = p_session_id` w raporcie szczegółowym | ⚠️ Ostrzeżenie | uczestnicy przepięci później na inną sesję (mark_code_used §24) znikają z XLSX (G5) |
| src/screens/AdminPanel.jsx | 996 | `planPos()?.idx` liczony w chwili wywołania, a nie idx ocenionego przed `await` | ⚠️ Ostrzeżenie | możliwy wyścig auto-skrótu przy tpq ≥ 45 s (hipoteza G2) |
| src/screens/Break.jsx | 14–31 | nieużywany tryb „Przerwa / Moduł X” | ℹ️ Info | gotowy do G3 |
| src/screens/ModuleIntro.jsx | — | martwy plik (nieimportowany, `mod.timePerQ`) | ℹ️ Info | do usunięcia przy okazji |
| scripts/verify-clock.js | — | celuje w nieistniejący staging | ℹ️ Info | skrypt nie przechodzi (poza zakresem) |

Nie znaleziono blokujących stubów (TODO/placeholder) w plikach fazy.

### Wymagana weryfikacja ręczna

Status wynika z luk, ale po ich domknięciu trzeba powtórzyć test na realnych telefonach:

1. **Reveal 10 s:** czy poprawna odpowiedź nie wygląda już jak mignięcie (iOS + Android).
2. **Pauza w reveal i w countdown:** admin pauzuje w każdej z tych faz, a potem wznawia. Na telefonach nie może zniknąć żadne pytanie.
3. **Przerwa po module 2 i 4:** telefony pokazują „Przerwa”, quiz stoi, dopóki admin nie wciśnie „Wznów”.
4. **Koniec testu:** telefony same pokazują „Koniec testu” i wynik X / liczba pytań w planie. Podium rusza tylko z ręki admina.
5. **Historia → XLSX:** otwarcie pliku w Excelu, arkusz per uczestnik, czasy i poprawność zgodne z bazą.
6. **Punkty 2–7 z 06-09 osobno per platforma:** Wake Lock, pasek/pierścień, wibracja, View Transitions, reduced-motion. Dotąd przyjęte tylko łączną oceną.

### Podsumowanie luk

Mechaniczny rdzeń fazy działa i jest wdrożony. Plan jest w bazie, zamiatacz pg_cron chodzi, front niczego nie przesuwa, refresh, offline i zamknięcie przeglądarki admina są odporne, poprawna odpowiedź nie wycieka, migracje są addytywne. Dziś potwierdzają to testy, build, verify-prod i verify-plan.

Luki biorą się z testu na telefonach i jednej niestabilnej sondy. Proponowane grupowanie do planów gap closure:

- **A. Model planu (G1 + G3):** reveal 10 s i automatyczne przerwy po modułach 2 i 4. Obie zmiany dotykają `plan.js`, `build_session_plan`, zamiatacza, fixture'ów i verify-plan, więc potrzebna jest jedna nowa sekcja SQL (42, addytywna) i jedna aktualizacja sondy. Przed planowaniem trzeba doprecyzować z użytkownikiem, czy chodzi o 10 s widoczności, czy o 10 s okna reveal.
- **B. Debug pauzy i timingu (G2 + G7):** jedno `/gsd:debug` z nowym trybem sondy (pauza w reveal/countdown) i serią przebiegów ze śladem. Hipotezy: stary snapshot nadpisuje nowszy stan, View Transition opóźnia zmianę fazy, wyścig auto-skrótu przy tpq ≥ 45 s, confirm() opóźnia pauzę.
- **C. Wyniki (G4 + G5 + G6):** wspólny mianownik z `session_plans` (ranking SQL, Ended, CSV/XLSX), jeden ekran „Koniec testu” z wynikiem, XLSX w Historii oparty na `answers.session_id` i `session_plans`, a nie na `participant_codes.session_id`.

Uwaga dla wydarzenia: G1 i G3 zmieniają plan tylko dla nowych sesji. Wdrożenie frontu nie może nastąpić w trakcie gry (Service Worker autoUpdate).

---

_Zweryfikowano: 2026-09-25T20:19:37Z_
_Weryfikator: Claude (gsd-verifier)_
