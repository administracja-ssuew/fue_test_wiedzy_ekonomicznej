# Faza 6: Rozgrywka autorytatywna serwera i płynność jak w aplikacji — Research (mapowanie kod → plan)

**Zbadano:** 2026-09-24
**Domena:** Postgres/Supabase (pg_cron, SECURITY DEFINER RPC, Realtime), React 18 (projekcja stanu z planu), Playwright (sonda)
**Pewność ogólna:** HIGH dla stanu kodu i SQL (czytane bezpośrednio, `verify-prod` uruchomione na produkcji), MEDIUM dla pg_cron na Supabase (oficjalne docs + README pg_cron, bez wglądu w wersję Postgresa produkcji)
**Podstawa domenowa:** `.planning/research/PLYNNOSC-ROZGRYWKI.md` — ten dokument jej NIE powtarza, tylko przekłada na konkretne pliki, sekcje SQL, sygnatury i testy.

<user_constraints>
## Ograniczenia użytkownika (z 06-CONTEXT.md — kopia dosłowna)

### Locked Decisions

#### Model czasu
- Plan sesji (kolejność pytań + czas każdego) zamrażany przy `start_quiz_session`. Czas pytania na kliencie pochodzi WYŁĄCZNIE z planu, nie z `ModulesContext`.
- Faza każdego ekranu (uczestnik, LiveView, podgląd admina) = czysta funkcja `(serverNow(), plan, pauzy)` — rozszerzenie istniejącego `projectLiveState`.
- Pauza/wznowienie przesuwa przyszłe terminy jednym zapisem.

#### Przejścia
- Przejścia wykonuje baza: `advance_due_sessions()` wywoływane przez `pg_cron` co 1 s, idempotentne (CAS jak w `advance_session_question`), obejmuje też przejście ostatnie pytanie → wyniki.
- Kierowca w `AdminPanel.jsx` (`driverTick`) i awaryjny kierowca uczestników (`fallbackJitterMs`) do usunięcia po wdrożeniu.
- `submit_answer` wyznacza aktywne pytanie z planu i `clock_timestamp()`, niezależnie od zamiatacza.

#### Przycisk „⏭ Następne"
- **Zostaje** jako przesunięcie planu: skraca bieżące pytanie, serwer przesuwa wszystkie kolejne terminy jednym zapisem; wszyscy przeskakują jednocześnie.

#### Punktacja i uczciwość
- **Czysty zegar serwera**: czas odpowiedzi = moment dotarcia do bazy − otwarcie pytania. Bez korekty o opóźnienie sieci.
- `correct_ans` NIE wraca z `submit_answer`; klient dostaje ją dopiero w fazie reveal (po deadline).
- Odpowiedź w strefie tolerancji po deadline (dziś 1,5 s) przyjęta, ale bez bonusu czasowego.

#### Odświeżenie / reconnect
- Jeden RPC-snapshot (`get_participant_state`): faza, pytanie, terminy, `server_now`, własna odpowiedź na bieżące pytanie, suma punktów. Jedyna ścieżka restore: start, refresh, `visibilitychange → visible`, reconnect socketu.
- Stan uczestnika w `localStorage` (klucz ważny dla `session_id`), nie `sessionStorage`.

#### Płynność (natywne API, bez bibliotek UI — ograniczenie projektu)
- Screen Wake Lock na lobby + quiz, ponawiany przy `visibilitychange`.
- Pasek czasu jako animacja CSS z ujemnym `animation-delay` liczonym z terminu; cyfry z `requestAnimationFrame` + `serverNow()`.
- Optimistic lock-in odpowiedzi + `navigator.vibrate` gdzie dostępne.
- View Transitions API, prefetch następnego pytania w oknie reveal, szkielet ekranu przy refreshu, `prefers-reduced-motion`.

#### Środowisko i bezpieczeństwo wdrożenia
- **Brak stagingu** (`iaehipybmcxrvgyfmcfr` → ENOTFOUND). Testy na PRODUKCJI (`dmoydtavstpurqebkngu`) samosprzątającymi sondami (`PROBE_CONFIRM=1`).
- W konsekwencji: **każda migracja SQL addytywna** — nowe kolumny nullable, nowe RPC pod nowymi nazwami albo kompatybilne sygnatury, zamiatacz działa tylko na sesjach posiadających plan. Obecnie wdrożony frontend (Vercel) musi działać bez zmian aż do wdrożenia nowego.
- Migracje w `SUPABASE_FIXES.sql` jako nowe numerowane sekcje (konwencja repo). Uwaga: sekcja 37 była oznaczona jako niewgrana (STATE.md, 02.09) — sprawdzić stan przed dopisaniem nowych.
- `pg_cron`: czyszczenie `cron.job_run_details`, minimalne logowanie dla zadania 1 s.

#### Weryfikacja
- Nowe tryby sondy `scripts/probe-gameplay.js`: `PROBE_ADMIN_EXIT=1`, `PROBE_REFRESH=1`, `PROBE_OFFLINE=1` (kryteria w ROADMAP.md, faza 6).
- Testy jednostkowe Vitest dla projekcji z planu, przesunięcia planu (pauza, „Następne"), decyzji zamiatacza.

### Claude's Discretion
- Kształt planu w bazie (`jsonb` w `quiz_sessions` vs osobna tabela).
- Podział na plany wykonawcze i kolejność w obrębie kolejności z research (kroki 1–6).
- Filtr próbek zegara w stylu timesync.

### Deferred Ideas (OUT OF SCOPE)
- Ekran admina dla rozłączonych/utkniętych uczestników z akcją `releaseCode` — osobny `/gsd:quick`.
- Wyjaśnienie ~70 s zawieszenia na ostatnim pytaniu z sondy — powinno zniknąć z konstrukcji (przejście do wyników przez zamiatacz); jeśli po fazie 6 nadal występuje, osobne `/gsd:debug`.
- Plan Supabase Pro + limit połączeń przed realnym 500 — decyzja budżetowa, poza kodem.
</user_constraints>

<phase_requirements>
## Wymagania fazy (kryteria sukcesu z ROADMAP.md — brak ID w REQUIREMENTS.md, nadaję robocze ID P6-SC1..6)

| ID | Opis | Co w tym researchu to umożliwia |
|----|------|----------------------------------|
| P6-SC1 | Admin zamyka przeglądarkę po starcie → wszystkie pytania i przejście do wyników w zaplanowanych czasach na każdym telefonie (`PROBE_ADMIN_EXIT=1`) | Plan w `session_plans` + `advance_due_sessions()` w pg_cron (§ Wzorzec 2), usunięcie `driverTick`/`armAdvanceFallback`, projekcja z planu na kliencie (§ Wzorzec 3); tryb sondy (§ Sonda) |
| P6-SC2 | Refresh w dowolnej fazie → ta sama faza i licznik ±1 s; odpowiedź zablokowana (`PROBE_REFRESH=1`) | `get_participant_state` (§ Wzorzec 4) + `localStorage` + offset zegara z `server_now` snapshotu; `data-fue-phase` do odczytu przez sondę |
| P6-SC3 | 10 s offline w pytaniu → po powrocie od razu właściwa faza (`PROBE_OFFLINE=1`) | Projekcja z lokalnie zapamiętanego planu działa offline; snapshot przy `online`/reconnect; ponawianie zapisu odpowiedzi w oknie tolerancji |
| P6-SC4 | Czas pytania z planu, nie z modułów klienta | `tpq` zamrożone w pozycjach planu; `Quiz.jsx`, `LiveView`, `useLiveProjection`, admin czytają `tpq` z pozycji planu (lista miejsc w § Mapa kodu) |
| P6-SC5 | Poprawna odpowiedź nie trafia do klienta przed końcem czasu; punkty czystym zegarem | `submit_answer_v2` zwraca tylko `accepted`; bramkowanie `ans`/`is_correct` na `closes_at + 1,5 s` w snapshot/summary; **dodatkowe wycieki znalezione**: `is_correct` z `submit_answer`, `get_participant_answers`, licznik `correct` w `get_admin_answer_summary` (§ Pułapka 1) |
| P6-SC6 | Migracje addytywne; wdrożony frontend działa bez zmian | Sekcje 39–40 wyłącznie nowe obiekty + zamiatacz zapisuje `current_question_idx`/`q_started_at` zgodnie ze starym kontraktem; utwardzenie starych RPC dopiero w sekcji 41 PO wdrożeniu frontu (§ Macierz zgodności) |
</phase_requirements>

## Project Constraints (z CLAUDE.md)

- Stack bez zmian: React 18 + Vite + vite-plugin-pwa + Supabase. **Zero nowych zależności runtime** (Wake Lock, View Transitions, rAF, vibrate — natywne API).
- Style wyłącznie inline (CSS-in-JS obiektami) + globalny CSS wstrzykiwany/`src/styles/global.css` na keyframes; bez bibliotek UI.
- Teksty UI po polsku.
- Konwencje: PascalCase komponenty `.jsx`, camelCase moduły `.js`, importy względne z rozszerzeniem `.js`, nazwane eksporty, podwójne cudzysłowy, 2 spacje; zwracanie `{ data, error }` zamiast try/catch w warstwie danych; handlery `handleX`.
- Środowisko Windows (Git Bash + PowerShell): w sondzie i skryptach żadnych założeń o `/tmp`; zmienne `$env:PROBE_X=1` w PowerShell.
- Vitest jest (2.1.9, jsdom) — testy obok modułów (`src/lib/*.test.js`).
- GSD: zmiany tylko przez `/gsd:execute-phase`.
- Tryb DEMO (brak kluczy Supabase → localStorage) nie może się zepsuć (`DEMO` w `src/lib/supabase.js`).

## Streszczenie

Stan faktyczny jest lepszy, niż zakładał CONTEXT: **sekcje 37 i 38 SĄ wgrane na produkcję** (`npm run verify-prod` uruchomione 24.09 → „PRODUKCJA GOTOWA pod kątem SQL (25 OK)", w tym 37.1/37.3/37.4 i 38). Następny wolny numer sekcji to **39**. **Uwaga na rozbieżność:** `.env` i sekcja 38 wskazują produkcję `ytbwmmqwbfcugouourih`; `dmoydtavstpurqebkngu` z CONTEXT/STATUS.md to STARY projekt sprzed migracji. Sonda i `verify-prod` biją w to, co jest w `.env` (czyli `ytbwmm…`). Migracje są wgrywane **ręcznie w SQL Editorze** (brak `psql`, Supabase CLI i hasła do bazy w `.env` — są tylko URL/anon/service key), więc każdy plan z SQL potrzebuje kroku `checkpoint:human-action` + automatycznej weryfikacji przez rozszerzony `verify-prod`.

Rekomendowany kształt: **plan jako osobna, niezmienna tabela `session_plans` (jsonb z offsetami w ms) + dwie skalarne kolumny na `quiz_sessions`: `plan_anchor_at` i `plan_paused_at`**. Wszystkie terminy = `anchor + offset`. Pauza/wznowienie, „⏭ Następne" i „🔁 Powtórz" to jedna zmiana kotwicy (jeden UPDATE). Jedna funkcja SQL `plan_position(items, anchor, paused_at, at)` jest jedynym źródłem prawdy po stronie bazy (zamiatacz, `submit_answer_v2`, snapshot, bramkowanie reveal), a jej lustrzana czysta funkcja JS `planPosition()` — po stronie klienta; parzystość obu sprawdza skrypt wołający SQL-ową funkcję przez RPC na tych samych fixture'ach co Vitest.

Zamiatacz **zapisuje stan w starym kontrakcie** (`current_question_idx`, `q_started_at` = otwarcie pytania z planu, `status`) — dzięki temu stary, cache'owany bundle PWA na czyimś telefonie nadal działa w sesji z planem. Nowy klient w ogóle nie potrzebuje zamiatacza do wyświetlania (faza z planu), a `submit_answer_v2` liczy aktywne pytanie z planu — padnięcie pg_cron degraduje tylko stare bundle i przejście `→ results`.

**Główna rekomendacja:** sekcja 39 (tabela planu, kolumny, `plan_position`, `start_quiz_session_v2`, `submit_answer_v2`, `get_participant_state`, akcje admina v2, `advance_due_sessions`, `get_answer_summary_v2`, diagnostyka) → sekcja 40 (pg_cron: rozszerzenie, zadanie 1 s, sprzątanie `job_run_details`) → nowy frontend → sekcja 41 (utwardzenie starych RPC: `correct_ans`/`is_correct` bramkowane) **dopiero po wdrożeniu i weryfikacji frontu**.

## Stan faktyczny (zweryfikowany)

### Baza — co jest na produkcji (`verify-prod`, 24.09.2026)

| Element | Stan | Źródło |
|---|---|---|
| Sekcje 16–29 | wgrane | `verify-prod` ✅ |
| Sekcja 36 (`submit_answer` z walidacją aktywnego pytania + 1,5 s) | brak bezpośredniej sondy anon; pośrednio: sonda produkcyjna przechodzi — **zakładam wgraną (MEDIUM)** | kod w `SUPABASE_FIXES.sql:1074-1111` |
| Sekcja 37 (37.1 answers poza publikacją, 37.3 seed modułów, 37.4 `get_session_detailed_results`) | **wgrana** (STATE.md z 02.09 jest nieaktualny) | `verify-prod` ✅ |
| Sekcja 38 (publikacja = lista tabel, `quiz_sessions` w publikacji, `REPLICA IDENTITY FULL`, `realtime_publication_status()`) | **wgrana** | `verify-prod` ✅ |
| **Następny wolny numer** | **39** | `SUPABASE_FIXES.sql` kończy się na 38 (linia 1287) |
| pg_cron | nieużywany nigdzie w repo | grep |

### Kolumny `quiz_sessions` (schemat + sekcje 1, 8, 11, 33)

`id uuid PK`, `city text`, `status text CHECK IN ('waiting','running','paused','results','ended')`, `current_question_idx int NOT NULL DEFAULT 0`, `q_started_at timestamptz`, `is_practice bool`, `bg text`, `bg_mobile text`, `created_by uuid`, `created_at timestamptz`, `pause_elapsed_s int` (epoch sekund momentu pauzy — §11), `name text` (§33). `REPLICA IDENTITY FULL` (§38) → każdy UPDATE niesie w Realtime stary i nowy wiersz w całości (istotne dla rozmiaru: **nie wkładać planu jsonb do tego wiersza**).

### Obecne RPC rozgrywki (ostatnie wersje w pliku = wersje na produkcji)

| Funkcja | Sekcja / linie | Sygnatura → zwrot | Kto woła (wdrożony front) |
|---|---|---|---|
| `start_quiz_session` | §29.5, `SUPABASE_FIXES.sql:836-846` | `(p_session_id uuid) → timestamptz` (`clock_timestamp()+10 s`, wymaga roli, tylko z `waiting`) | `startQuizSession` `src/lib/supabase.js:437-456` ← AdminPanel „▶ Start quizu" `AdminPanel.jsx:1069-1081` |
| `advance_session_question` | §26, `:595-619` | `(p_session_id, p_expected_idx, p_next_idx, p_lead_seconds int DEFAULT 4) → timestamptz` / NULL gdy przegrany CAS; **GRANT anon** | `advanceSessionQuestion` `supabase.js:396-433` ← `driverTick` (admin) + `armAdvanceFallback` (uczestnik) |
| `update_quiz_session_admin` | §29.5, `:823-834` | `(p_session_id, p_data jsonb) → void`; pola: `status`, `q_started_at`, `pause_elapsed_s`, `current_question_idx` | `updateSession` `supabase.js:368-390` ← `upd()` `AdminPanel.jsx:816-838` (pauza, wznowienie, Następne=cofnięcie `q_started_at`, Powtórz, Zakończ, Ogłoś wyniki) |
| `submit_answer` | §36, `:1074-1111` | `(p_session_id, p_code, p_name, p_question_id, p_chosen) → json {is_correct, correct_ans}`; aktywne pytanie = `row_number()` po `(module, sort_order, id)` == `current_question_idx`; okno `[q_started_at, +tpq(modules)+1,5 s]`; `response_time_ms = clock_timestamp() − q_started_at` (bez przycięcia do tpq) | `submitAnswer` `supabase.js:541-556` ← `recordAnswer` `App.jsx:388-404` |
| `get_participant_answers` | §16, `:328-346` | `(p_session_id, p_code) → table(question_id, module, chosen, is_correct, points)` — **bez bramkowania** | `getParticipantAnswers` `supabase.js:561-574` ← `startQuiz` `App.jsx:576-580` |
| `get_admin_answer_summary` | §29.4, `:787-817` | `(p_session_id, p_question_id) → json {total, correct, ans}`; `ans` bramkowane `modules.time_per_q` (NIE planem); `correct` **niebramkowane**; GRANT anon | LiveView/embed `useLiveProjection.js:124`, panel admina |
| `server_now` | §28, `:705-711` | `() → bigint` (epoch ms z `clock_timestamp()`) | `serverClock.js:32-39` |

### Klient — mapa miejsc do zmiany (linie z HEAD `87e7c20`)

| Plik | Linie | Co robi dziś | Co z tym w fazie 6 |
|---|---|---|---|
| `src/lib/gameLogic.js` | 11 `REVEAL_SECONDS=6`, 16 `MODULE_INTRO_SECONDS=30`, 19 `PRE_QUESTION_LEAD=4` | stałe czasu | zostają; używane przez **budowę planu w SQL** (muszą być identyczne — patrz Pułapka 5) |
| | 30 `shouldAdvance`, 37 `advanceLeadSeconds`, 104 `fallbackJitterMs` | decyzje kierowcy | usunąć po wdrożeniu (z testami `gameLogic.test.js:153-214`) |
| | 90 `shouldEndEarly` (+`AUTO_SKIP_MIN_TPQ=45`) | auto-skrót długich pytań | zostaje jako opcjonalne wywołanie `skip` z panelu (dla TWE ≤20 s i tak wyłączone) |
| | 119 `remainingSeconds`, 133-159 `projectLiveState` | projekcja z `q_started_at` + `modules` | dodać `planPosition()`/`projectPlanState()`; `projectLiveState` deleguje do planu, gdy sesja ma plan, zostaje legacy dla sesji bez planu i DEMO |
| `src/lib/serverClock.js` | 22 `computeOffset` (1 próbka min-RTT), 43 `syncServerClock(rounds=4)`, 59 `startServerClock` (5 min + `visibilitychange`) | zegar | filtr timesync (mediana ± odchylenie), 6–8 próbek, `addSample()` z snapshotu, ponowny pomiar przy `online`/reconnect |
| `src/App.jsx` | 126-141 restore z `sessionStorage` | restore uczestnika | `localStorage` z `session_id` (+ jednorazowy odczyt starego klucza z `sessionStorage` — migracja) |
| | 160-173 `syncToSession`, 176-198 timer `setInterval 250 ms`, 206-220 odliczanie, 226-381 kanał+watchdog+poll 10 s z `handleUpdate` (232-313) | imperatywna maszyna stanów sterowana zdarzeniami | **zastąpić hookiem `useParticipantGame`**: snapshot + subskrypcja jako SYGNAŁ + ticker rAF liczący fazę z planu |
| | 388-404 `recordAnswer`, 407-415 `handleTimeout` (pusty zapis w chwili deadline = lawina), 418-423 `handlePick` | zapis odpowiedzi | `submit_answer_v2`, optimistic lock-in, ponawianie, pusty zapis z jitterem 0–1000 ms po deadline |
| | 430-443 `armAdvanceFallback`, 450-499 `advanceQuestion`, 512-526 `handleResumeFromBreak`, 692-718 `module_intro` | awaryjny kierowca, przejścia lokalne | usunąć (poza gałęzią DEMO/praktyki bez sesji) |
| | 529-545 `handleCodeSuccess`, 548-613 `startQuiz` (ściąga pytania, `getParticipantAnswers`, pętla odliczania) | wejście do gry | jedna ścieżka: `get_participant_state` |
| | 649-660 `admin_pause` → `Break`, 724-733 `counting` → `ModuleIntroFS`/`Countdown`/`Quiz` | routing ekranów | routing = `switch(phase)` z projekcji |
| `src/screens/AdminPanel.jsx` | 653-756 `driverTick` (interwał 1 s + `visibilitychange`) | kierowca przejść + auto-skrót + licznik | zostaje tylko licznik odpowiedzi (poll 1 s) i opcjonalny auto-skip → `skip` RPC; zapis przejść usunąć |
| | 968-974 `goToNextQuestion` (cofa `q_started_at` o tpq przez `upd`) | „⏭ Następne" | `admin_skip_question(p_session_id, p_idx)` |
| | 1069-1081 Start, 1083-1089 Pauza (`pause_elapsed_s`), 1100-1108 Wznów (przesuwa `q_started_at`), 1109 „Ogłoś wyniki" (tylko w `paused`!), 1113-1120 Powtórz | sterowanie | `start_quiz_session_v2`, `admin_pause_session`, `admin_resume_session`, `admin_repeat_question`; „Ogłoś wyniki" także w fazie `finished` |
| | 1468 embed `useLiveProjection(city, {detailed:true})` | podgląd | plan-aware |
| `src/hooks/useLiveProjection.js` | 57-66 load, 68-107 kanały+poll (1 s admin/5 s publiczny), 109-161 ticker 250 ms, 111-129 `fetchReveal` (+1,5 s), 203-205 `timePerQ` z modułów | LiveView/embed | pobiera plan (`session_plans`), `tpq` z planu, reveal przez `get_answer_summary_v2` |
| `src/context/ModulesContext.jsx` | 1-88 | czasy + nazwy/ikony/kolory | zostaje dla nazw/ikon/kolorów; **czas ignorowany** w sesjach z planem |
| `src/screens/Quiz.jsx` | 50-56 `resultSec` (`setInterval` od `answered`), 64-66 `timerPct = timer/mod.timePerQ`, 88-94 SVG ring z `transition .95s` | UI pytania | `tpq` z planu (prop), ring/pasek CSS z ujemnym `animation-delay`, cyfry z rAF, reveal-licznik z `revealUntil` |
| `src/screens/Break.jsx`, `WaitingResults.jsx`, `Lobby.jsx` | własne kanały i polle co 20 s | ekrany oczekiwania | stają się czysto prezentacyjne (faza z hooka); Lobby zostaje dla presence |
| `scripts/probe-gameplay.js` | 258 wstrzykuje `sessionStorage.fue_participant`; 193-214 `READ` parsuje `innerText` regexami | sonda | wstrzykiwać `localStorage`; czytać `data-fue-phase`; nowe tryby (§ Sonda) |

## Standardowy stos

### Rdzeń (bez nowych zależności)
| Element | Wersja | Cel | Uwagi |
|---|---|---|---|
| Postgres (Supabase) + plpgsql | wersja produkcji niezweryfikowana | plan, zamiatacz, RPC | sekundowe harmonogramy pg_cron wymagają Postgres ≥ 15.1.1.61 na Supabase — [docs](https://supabase.com/docs/guides/cron/quickstart). Projekt utworzony w 2026 → prawie na pewno spełnione (MEDIUM); weryfikacja: `select version();` w SQL Editorze w kroku human-action |
| `pg_cron` (Supabase Cron) | ≥1.6.4 zalecane | wywołanie `advance_due_sessions()` co 1 s | instalacja: `create extension pg_cron with schema pg_catalog;` — [docs](https://supabase.com/docs/guides/cron/install) |
| `@supabase/supabase-js` | ^2.45.0 (jest) | RPC, Realtime | bez zmian |
| React 18.3.1 / `react-dom` `flushSync` | jest | View Transitions w React 18 | `document.startViewTransition(() => flushSync(() => setState(...)))` |
| Vitest 2.1.9 + jsdom | jest | testy czystej logiki | `npm test` — 58/58 zielone (24.09) |
| Playwright (`@playwright/test` ^1.60, chromium zainstalowany) | jest | sonda | `npm run sonda` |

### Natywne API (bez bibliotek — ograniczenie projektu)
| API | Użycie | Fallback |
|---|---|---|
| Screen Wake Lock `navigator.wakeLock.request("screen")` | lobby + quiz; ponawiać przy `visibilitychange → visible` (blokada zwalnia się przy ukryciu) | brak — cicho pomijamy; iOS PWA dopiero 18.4+ (z PLYNNOSC-ROZGRYWKI.md) |
| CSS animation + ujemny `animation-delay` | pasek/ring czasu | — |
| `requestAnimationFrame` | cyfry sekund z `serverNow()` | — |
| `navigator.vibrate(15)` | potwierdzenie dotyku (Android) | iOS: brak, bez szkody |
| `document.startViewTransition` | pytanie → reveal → następne | bez animacji |
| `matchMedia("(prefers-reduced-motion: reduce)")` | wyłączenie animacji | — |

### Rozważone alternatywy
| Zamiast | Można | Dlaczego nie |
|---|---|---|
| `session_plans` (osobna tabela) | `quiz_sessions.plan jsonb` | `REPLICA IDENTITY FULL` → plan (≈4–6 KB) leciałby 2× w KAŻDYM zdarzeniu `postgres_changes` do każdego z ~500 subskrybentów; plan jest niezmienny, więc wystarczy go pobrać raz |
| Tabela wierszy `session_schedule(idx, opens_at, …)` z czasami bezwzględnymi | offsety + kotwica | przesunięcie = UPDATE N wierszy zamiast 1 pola; ryzyko częściowego przesunięcia; kotwica robi to samo jednym zapisem |
| Rozgłaszanie reveal z bazy (`realtime.send`) | kolumny `revealed_idx/revealed_ans` | dodatkowa zależność od Realtime Broadcast-from-DB; kolumny w `quiz_sessions` dają to samo przez istniejący `postgres_changes` + snapshot |
| Biblioteka timesync | ~15 linii w `computeOffset` | ograniczenie „bez nowych zależności" |

**Instalacja:** brak `npm install`. Jedyna „instalacja" to rozszerzenie `pg_cron` (sekcja 40, human-action w SQL Editorze lub Dashboard → Integrations → Cron).

## Wzorce architektury

### Rekomendowana struktura (nowe pliki)
```
src/lib/plan.js              # czyste: planPosition(), projectPlanState(), shiftForPause/Skip/Repeat (lustro SQL)
src/lib/plan.test.js         # Vitest: fazy, granice, pauza, skip, repeat, finished
src/lib/plan.fixtures.json   # wspólne przypadki dla Vitest i scripts/verify-plan.js (parzystość JS↔SQL)
src/hooks/useParticipantGame.js  # snapshot + sygnał Realtime + ticker rAF → { phase, item, remainingMs, ... }
src/hooks/useWakeLock.js     # Wake Lock z ponawianiem
scripts/verify-plan.js       # woła RPC plan_position na fixture'ach, porównuje z plan.js (read-only)
```
Zmieniane: `App.jsx`, `AdminPanel.jsx`, `useLiveProjection.js`, `LiveView.jsx`, `Quiz.jsx`, `Break.jsx`, `WaitingResults.jsx`, `serverClock.js`, `gameLogic.js`, `supabase.js`, `scripts/probe-gameplay.js`, `scripts/verify-prod.js`, `SUPABASE_FIXES.sql`.

### Wzorzec 1: Plan = niezmienne offsety + ruchoma kotwica

**Kształt `session_plans.items` (jsonb array, kolejność = `ORDER BY module, sort_order, id`, jak `get_quiz_questions`):**
```json
[{ "i":0, "id":"<uuid>", "m":1, "tpq":20, "lead":10, "o":10000, "c":30000, "r":36000 },
 { "i":1, "id":"<uuid>", "m":1, "tpq":20, "lead":4,  "o":40000, "c":60000, "r":66000 },
 { "i":2, "id":"<uuid>", "m":2, "tpq":20, "lead":30, "o":96000, "c":116000, "r":122000 }]
```
- `lead`: pozycja 0 → **10 s** (tak robi dziś `start_quiz_session`: zapowiedź modułu 1 = 10 s), pierwsze pytanie kolejnego modułu → 30 s (`MODULE_INTRO_SECONDS`), pozostałe → 4 s (`PRE_QUESTION_LEAD`).
- `o` (otwarcie) = `r` poprzedniej + `lead·1000`; `c` (deadline) = `o + tpq·1000`; `r` (koniec reveal) = `c + 6000` (`REVEAL_SECONDS`). Wszystko w ms od kotwicy.
- Terminy bezwzględne: `opens_at = plan_anchor_at + o`. To dokładnie odtwarza dzisiejszy rytm (kierowca przechodzi przy `tpq + REVEAL`, następne `q_started_at = now + lead`) — bez opóźnienia kierowcy.
- Czas efektywny: `t = (COALESCE(plan_paused_at, now) − plan_anchor_at)`.
- Fazy dla pozycji `i` (slot = `(r[i-1], r[i]]`): `t < o−lead` nie występuje; `o−lead·1000 ≤ t < o` → `intro` (gdy `lead ≥ 10`) lub `countdown`; `o ≤ t < c` → `quiz`; `c ≤ t < r` → `reveal`; `t ≥ r[last]` → `finished`. `plan_paused_at IS NOT NULL` → `paused` (z zachowaną pozycją pod spodem).

**Akcje admina = jedna zmiana kotwicy (jeden UPDATE, wiersz zablokowany `FOR UPDATE`):**
| Akcja | Warunek | Zapis |
|---|---|---|
| Pauza | `status='running'`, brak pauzy | `status='paused'`, `plan_paused_at = clock_timestamp()`, `pause_elapsed_s = epoch(now)` (zgodność ze starym frontem) |
| Wznowienie | pauza | `plan_anchor_at += clock_timestamp() − plan_paused_at`, `plan_paused_at = NULL`, `status='running'`, `pause_elapsed_s=NULL`, `q_started_at` przeliczone z planu |
| ⏭ Następne (`p_idx`) | pozycja == `p_idx` i faza `quiz` | `plan_anchor_at −= (closes_at − now)` → deadline = teraz, wszystkie kolejne terminy wcześniej o tyle samo. Drugi klik = no-op (faza już `reveal`) |
| 🔁 Powtórz (`p_idx`) | pozycja == `p_idx` i faza `quiz` | `plan_anchor_at += (now − opens_at)` → pytanie otwiera się „teraz" |

Kotwica przesunięta do tyłu przy skip powoduje, że `opens_at` bieżącego pytania „cofnie się" o tę samą wartość — **to jest zamierzone i identyczne z dzisiejszym cofaniem `q_started_at`**; odpowiedzi już zapisane mają zamrożony `response_time_ms`, a nowe (strefa tolerancji) i tak dostają `tpq` (bez bonusu).

### Wzorzec 2: SQL — jedna funkcja pozycji + zamiatacz z `SKIP LOCKED`

```sql
-- Sekcja 39 (szkic, nazwy docelowe). Jedno źródło prawdy dla bazy.
CREATE OR REPLACE FUNCTION public.plan_position(
  p_items jsonb, p_anchor timestamptz, p_paused_at timestamptz, p_at timestamptz)
RETURNS TABLE (idx int, phase text, opens_at timestamptz, closes_at timestamptz,
               reveal_until timestamptz, question_id uuid, tpq int)
LANGUAGE sql IMMUTABLE AS $$
  WITH t AS (SELECT EXTRACT(epoch FROM (COALESCE(p_paused_at, p_at) - p_anchor)) * 1000 AS ms),
  it AS (SELECT (e->>'i')::int i, (e->>'id')::uuid id, (e->>'tpq')::int tpq, (e->>'lead')::int lead,
                (e->>'o')::bigint o, (e->>'c')::bigint c, (e->>'r')::bigint r
         FROM jsonb_array_elements(p_items) e),
  cur AS (SELECT it.* FROM it, t WHERE t.ms < it.r ORDER BY it.i LIMIT 1),
  last AS (SELECT it.* FROM it ORDER BY it.i DESC LIMIT 1)
  SELECT x.i,
         CASE WHEN p_paused_at IS NOT NULL THEN 'paused'
              WHEN (SELECT ms FROM t) >= (SELECT r FROM last) THEN 'finished'
              WHEN (SELECT ms FROM t) <  x.o THEN CASE WHEN x.lead >= 10 THEN 'intro' ELSE 'countdown' END
              WHEN (SELECT ms FROM t) <  x.c THEN 'quiz'
              ELSE 'reveal' END,
         p_anchor + x.o * interval '1 millisecond',
         p_anchor + x.c * interval '1 millisecond',
         p_anchor + x.r * interval '1 millisecond',
         x.id, x.tpq
  FROM (SELECT * FROM cur UNION ALL SELECT * FROM last WHERE NOT EXISTS (SELECT 1 FROM cur)) x;
$$;
-- Bez dostępu do tabel → bezpieczne do GRANT anon (umożliwia test parzystości JS↔SQL przez RPC).
```

```sql
CREATE OR REPLACE FUNCTION public.advance_due_sessions()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_now timestamptz := clock_timestamp(); r record; p record; n int := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.current_question_idx, s.q_started_at, s.plan_anchor_at, s.revealed_idx, sp.items
    FROM public.quiz_sessions s JOIN public.session_plans sp ON sp.session_id = s.id
    WHERE s.status = 'running' AND s.plan_anchor_at IS NOT NULL AND s.plan_paused_at IS NULL
    FOR UPDATE OF s SKIP LOCKED             -- admin trzyma blokadę? pomiń, złapiemy za 1 s
  LOOP
    SELECT * INTO p FROM public.plan_position(r.items, r.plan_anchor_at, NULL, v_now);
    IF p.phase = 'finished' THEN
      UPDATE public.quiz_sessions SET status = 'results' WHERE id = r.id;   -- patrz Otwarte pytanie 1
      n := n + 1;
    ELSIF p.idx IS DISTINCT FROM r.current_question_idx OR p.opens_at IS DISTINCT FROM r.q_started_at
       OR (p.phase = 'reveal' AND v_now >= p.closes_at + interval '1.5 seconds'
           AND r.revealed_idx IS DISTINCT FROM p.idx) THEN
      UPDATE public.quiz_sessions SET
        current_question_idx = p.idx,
        q_started_at         = p.opens_at,                          -- stary kontrakt dla starych bundli
        revealed_idx = CASE WHEN p.phase = 'reveal' AND v_now >= p.closes_at + interval '1.5 seconds'
                            THEN p.idx ELSE revealed_idx END,
        revealed_ans = CASE WHEN p.phase = 'reveal' AND v_now >= p.closes_at + interval '1.5 seconds'
                            THEN (SELECT ans FROM public.questions WHERE id = p.question_id) ELSE revealed_ans END
      WHERE id = r.id;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END; $$;
REVOKE EXECUTE ON FUNCTION public.advance_due_sessions() FROM PUBLIC, anon, authenticated;
```
Cechy: **idempotentny** (stan wyprowadzony z kotwicy + zegara, nie inkrementowany), bez zapisu gdy nic się nie zmieniło (brak zbędnych zdarzeń Realtime), `SKIP LOCKED` nie blokuje się na akcji admina, `clock_timestamp()` raz na przebieg. „CAS" z CONTEXT jest spełniony silniej: zapis zależy tylko od stanu wiersza w chwili blokady.

**Harmonogram (sekcja 40):**
```sql
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.unschedule('fue-advance-due') where exists (select 1 from cron.job where jobname = 'fue-advance-due');
select cron.schedule('fue-advance-due', '1 seconds', $$select public.advance_due_sessions()$$);

select cron.unschedule('fue-cron-cleanup') where exists (select 1 from cron.job where jobname = 'fue-cron-cleanup');
select cron.schedule('fue-cron-cleanup', '*/10 * * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '1 hour'$$);
```
Źródła: składnia `'[1-59] seconds'` i `cron.schedule/unschedule` — [Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart), [pg_cron README](https://github.com/citusdata/pg_cron). `cron.log_run` ma kontekst `sighup` i zmienia się przez `ALTER SYSTEM` — na Supabase rola `postgres` nie jest superuserem, więc **zakładamy, że logowania nie da się wyłączyć (LOW — nieweryfikowane)**; „minimalne logowanie" realizujemy sprzątaniem co 10 min (przy 1 s = 3600 wierszy/h zamiast 86 400/dobę).

### Wzorzec 3: Klient = czysta projekcja z planu + ticker rAF

```js
// src/lib/plan.js — lustro plan_position (te same granice, te same stałe)
export function planPosition(items, anchorMs, pausedAtMs, nowMs) {
  const t = (pausedAtMs ?? nowMs) - anchorMs;
  const last = items[items.length - 1];
  const it = items.find((x) => t < x.r) || last;
  let phase;
  if (pausedAtMs != null) phase = "paused";
  else if (t >= last.r) phase = "finished";
  else if (t < it.o) phase = it.lead >= 10 ? "intro" : "countdown";
  else if (t < it.c) phase = "quiz";
  else phase = "reveal";
  return { idx: it.i, phase, item: it,
    opensAt: anchorMs + it.o, closesAt: anchorMs + it.c, revealUntil: anchorMs + it.r };
}
```
- Ekran uczestnika, LiveView i embed admina liczą to samo; `useLiveProjection` i `useParticipantGame` różnią się tylko źródłem danych (anon plan vs snapshot z kodem).
- Realtime (`postgres_changes` na `quiz_sessions` + broadcast `quiz_event`) jest wyłącznie **sygnałem** „przeczytaj kotwicę/pauzę/status/reveal na nowo" — utracony komunikat to najwyżej spóźniona reakcja na pauzę, nigdy rozjazd czasu.
- Cyfry: `Math.ceil((closesAt − serverNow())/1000)` w rAF, setState tylko przy zmianie liczby (nie co klatkę).
- Pasek/ring: element z `key={`${item.id}-${opensAt}`}` (restart przy skip/repeat), `animationDuration: tpq s`, `animationDelay: -(serverNow() − opensAt)/1000 s`, `animationPlayState: phase === "paused" ? "paused" : "running"`. Kompozytor animuje tylko `transform`/`opacity` — **pasek przez `transform: scaleX()`** jest płynny niezależnie od wątku JS; ring SVG (`stroke-dashoffset`) animuje się bez JS, ale na wątku głównym (MEDIUM).
- DEMO: plan budowany lokalnie w JS (ta sama funkcja budująca offsety), kotwica w localStorage — zamiatacz niepotrzebny, bo ekran i tak liczy fazę z planu.

### Wzorzec 4: Snapshot `get_participant_state` — jedyna ścieżka restore

```sql
-- get_participant_state(p_code text, p_session_id uuid DEFAULT NULL, p_include_plan boolean DEFAULT true) → json
{ "server_now": 1790252125380,                     -- epoch ms z clock_timestamp()
  "session": { "id", "city", "status", "is_practice", "bg", "bg_mobile",
               "plan_anchor_at", "plan_paused_at", "plan_version" },   -- plan_version = hash/licznik kotwicy
  "plan": [ { i, id, m, tpq, lead, o, c, r, "q": "...", "opts": [...] } ] | null,  -- BEZ ans
  "my_answers": [ { question_id, chosen, is_correct /* NULL dopóki now < closes_at+1,5 s */ } ],
  "reveal": { "idx": 12, "ans": 2 } | null,          -- tylko gdy now >= closes_at+1,5 s bieżącej pozycji
  "correct_total": 11 }                              -- liczone tylko z odsłoniętych pytań
```
- Wywołania: start aplikacji z zapisanym kodem, `visibilitychange → visible`, zdarzenie `online`, `SUBSCRIBED` po reconnect kanału (z jitterem 0–2 s dla reconnectów masowych; bez jitteru dla refreshu).
- Offset zegara: `t0`/`t1` wokół wywołania + `server_now` → `addClockSample()` — licznik jest poprawny od pierwszej klatki po refreshu (kluczowe dla ±1 s w SC2), zanim zakończy się pełny `syncServerClock`.
- `p_include_plan=false`, gdy klient ma w `localStorage` plan dla tego `session_id` (plan jest niezmienny) — refresh ~500 osób nie pompuje 500× ~20 KB.
- `localStorage.fue_participant = { code, name, surname, city, sessionId, plan?, planSessionId }`; gdy snapshot zwróci inną sesję/`ended` → wyczyść.

### Wzorzec 5: `submit_answer_v2` — plan + zegar, bez wycieku

```sql
-- submit_answer_v2(p_session_id, p_code, p_name, p_question_id, p_chosen) → json {accepted, duplicate, chosen}
-- 1. code_exists; 2. sesja status='running' AND plan_paused_at IS NULL (pauza → RAISE 'session paused');
-- 3. pozycja pytania z session_plans.items po id (nie z row_number() i nie z current_question_idx);
-- 4. v_now := clock_timestamp(); opens=anchor+o; closes=anchor+c;
--    v_now < opens → 'question not started'; p_chosen NOT NULL AND v_now > closes+1.5s → 'time is up';
-- 5. rt_ms := LEAST(GREATEST(0, (v_now-opens) ms), tpq*1000)   -- strefa tolerancji i puste = tpq (bez bonusu)
-- 6. INSERT ... ON CONFLICT DO NOTHING; GET DIAGNOSTICS → duplicate; przy duplikacie zwróć zapisany chosen
-- 7. RETURN json_build_object('accepted', true, 'duplicate', v_dup, 'chosen', v_chosen)  -- ZERO is_correct/correct_ans
```
`is_correct` liczone i zapisywane w bazie jak dziś (ranking `get_session_results` bez zmian: poprawne desc, średni `response_time_ms` asc).

### Anty-wzorce
- **Plan jsonb w `quiz_sessions`** — patrz alternatywy (REPLICA IDENTITY FULL).
- **Zamiatacz inkrementujący `current_question_idx += 1`** — nieidempotentny; po przestoju crona przeskakiwałby po jednym na sekundę. Zawsze wyprowadzać z kotwicy.
- **Dwie implementacje bramkowania reveal** (`modules.time_per_q` w starym summary + plan w nowym) dla tej samej sesji planowej — nowy klient musi używać wyłącznie v2.
- **Klient wołający `advance_*`** w jakiejkolwiek ścieżce produkcyjnej po wdrożeniu.
- **`setInterval` jako źródło licznika** (dzisiejsze `Quiz.jsx:50-56`, `App.jsx:176-198`) — po zadławieniu przeskakuje; licznik ma być funkcją terminu.

## Macierz zgodności (SC6 — co działa w którym momencie wdrożenia)

| Moment | Stary bundle (Vercel dziś / stary SW na telefonie) | Nowy bundle |
|---|---|---|
| Po sekcji 39 (bez 40) | bez zmian — nie tworzy sesji z planem (woła stary `start_quiz_session`); nowe kolumny ignorowane w payloadach | — (jeszcze nie wdrożony) |
| Po sekcji 40 (cron) | bez zmian — zamiatacz dotyka tylko `plan_anchor_at IS NOT NULL` | — |
| Nowy front wdrożony, sesja z planem, na sali telefon ze starym SW | działa: zamiatacz pisze `current_question_idx` + `q_started_at = opens_at` w starym kontrakcie, stary `submit_answer` waliduje po `current_question_idx`/`q_started_at` → OK. Uwaga: stary klient liczy `tpq` z modułów (klasa D3 wraca tylko dla niego) | pełna funkcjonalność |
| Stary panel admina otwarty w drugiej karcie przy sesji z planem | **ryzyko**: stary „Wznów" przez `update_quiz_session_admin` nie przesunie kotwicy → zamiatacz nadpisze `q_started_at` z planu (quiz „przeskoczy" o czas pauzy). Mitygacja w sekcji 41: `update_quiz_session_admin` odrzuca zmianę `status/q_started_at/current_question_idx` dla sesji z planem; do tego czasu instrukcja „przeładuj panel po wdrożeniu" | — |
| Po sekcji 41 (utwardzenie) | stary klient: brak koloru poprawnej odpowiedzi w reveal (`correct_ans` = NULL przed deadline) — degradacja kosmetyczna, bez awarii (`App.jsx:399` ma fallback na `q.ans`, który dla anon i tak jest NULL) | bez zmian |

`advance_session_question` (anon!) w sekcji 39 dostaje dodatkowy warunek `AND plan_anchor_at IS NULL` — zmiana zachowania wyłącznie dla sesji z planem, których stary front nie tworzy; chroni przed awaryjnym kierowcą starego bundla i przed złośliwym anonem. (Nawet bez tego zamiatacz nadpisuje w ≤1 s, a nowy klient go nie potrzebuje.)

## Don't Hand-Roll

| Problem | Nie budować | Użyć | Dlaczego |
|---|---|---|---|
| Harmonogram 1 s | Edge Function + zewnętrzny scheduler, pętla w przeglądarce | `pg_cron` `'1 seconds'` | wbudowane w Supabase, 1 lekkie zapytanie/s, zadanie nie nakłada się samo na siebie (kolejka) |
| Wyścig zamiatacz vs admin | własne flagi/wersje | `FOR UPDATE SKIP LOCKED` (zamiatacz) + `FOR UPDATE` (akcje admina) | semantyka Postgresa, zero stanu |
| Pozycja w planie w 4 miejscach SQL | kopiowanie CTE (jak dziś `row_number()` w 3 funkcjach) | jedna `plan_position()` | dziś kolejność pytań jest liczona 3× (§29.4, §36, §37.4) — każda kopia to miejsce na rozjazd |
| Synchronizacja zegara | biblioteka | `computeOffset` z filtrem mediany | ~15 linii |
| Animacja licznika | `setInterval` + `transition` | CSS keyframes + ujemny `animation-delay` | odporne na dławienie JS |
| Unikalność odpowiedzi | sprawdzanie w kliencie | `UNIQUE(session_id, participant_code, question_id)` + `ON CONFLICT DO NOTHING` (jest) | już działa |

## Runtime State Inventory (faza zawiera migrację danych/konfiguracji)

| Kategoria | Znaleziono | Wymagana akcja |
|---|---|---|
| Dane w bazie | Sesje z `status` running/paused bez planu (historyczne / trwające) — zamiatacz je ignoruje (`plan_anchor_at IS NULL`). Brak danych do migracji | brak; sesje bez planu działają po staremu do końca |
| Konfiguracja żywych usług | pg_cron jobs (`fue-advance-due`, `fue-cron-cleanup`) — żyją w `cron.job` w bazie, NIE w git | SQL w sekcji 40 idempotentny (unschedule-if-exists + schedule); `verify-prod` sprawdza przez RPC diagnostyczne |
| Stan OS / przeglądarek | Service Worker PWA (`registerType: autoUpdate`, `skipWaiting`) — telefony z otwartą kartą trzymają stary bundle do przeładowania; `sessionStorage.fue_participant` u osób w trakcie | nowy klient czyta raz stary klucz z `sessionStorage` i przenosi do `localStorage`; **nie wdrażać frontu w trakcie wydarzenia** |
| Sekrety / env | `.env` ma tylko URL/anon/service (+ `_STAGE` martwe). Brak hasła DB → migracje ręczne | brak zmian; `PROBE_TARGET=prod` jawnie (klucze `_STAGE` wskazują martwy projekt, a sonda domyślnie je preferuje: `probe-gameplay.js:40-43`) |
| Artefakty | `dist/` (build pod sondę) | `npm run build` przed każdą sondą |

## Najczęstsze pułapki

### Pułapka 1: „correct_ans nie wraca" nie wystarcza — są jeszcze 3 wycieki
**Co idzie źle:** SC5 łamią też: (a) `is_correct` w odpowiedzi `submit_answer` (true ⇒ wybrana = poprawna), (b) `get_participant_answers` (§16) zwraca `is_correct` bieżącego pytania od razu — anon może je odpytać tuż po odpowiedzi, (c) `get_admin_answer_summary` (§29.4, GRANT anon) zwraca `correct` na żywo, a `ans` bramkuje czasem **modułu**, nie planu (po „Następne" albo zmianie czasu modułu w trakcie bramka otwiera się w złym momencie).
**Jak uniknąć:** nowy klient używa tylko v2 (`submit_answer_v2`, snapshot, `get_answer_summary_v2` z bramką `closes_at + 1,5 s` i `correct` = NULL przed bramką). Sekcja 41 (po wdrożeniu) utwardza stare: `submit_answer` → `correct_ans`/`is_correct` NULL przed bramką, `get_participant_answers` → `is_correct` NULL dla nieodsłoniętych, `get_admin_answer_summary` → `correct`/`ans` bramkowane planem dla sesji z planem.
**Sygnał:** test `verify-plan`/sonda: RPC wołane w fazie `quiz` zwraca coś różnego od NULL w polach poprawności.

### Pułapka 2: Reveal odsłonięty przed końcem strefy tolerancji
**Co idzie źle:** bramka na `closes_at` pozwala komuś, kto zobaczył poprawną odpowiedź (sąsiad, projektor), wysłać ją w oknie 1,5 s tolerancji.
**Jak uniknąć:** WSZYSTKIE bramki (`revealed_*` w zamiataczu, snapshot, summary v2, LiveView) = `closes_at + interval '1.5 seconds'`. Klient pokazuje fazę `reveal` od `closesAt`, ale kolor poprawnej dopiero gdy przyjdzie `revealed_ans` (≈1,5–2,5 s po deadline, okno reveal 6 s) — w międzyczasie „Sprawdzamy…"/szkielet. Fallback: brak `revealed_ans` do `closesAt + 3 s` → snapshot z jitterem.

### Pułapka 3: Wyścig zamiatacz vs „⏭ Następne"/pauza
**Co idzie źle:** zamiatacz czyta kotwicę, admin ją przesuwa, zamiatacz zapisuje `q_started_at` wyliczone ze starej kotwicy.
**Jak uniknąć:** zamiatacz blokuje wiersz (`FOR UPDATE OF s SKIP LOCKED`) i liczy pozycję z odczytu wykonanego POD blokadą; akcje admina `SELECT … FOR UPDATE` → liczą → UPDATE w jednej funkcji. Akcje przyjmują `p_idx` (oczekiwana pozycja) — podwójny klik/drugi admin = no-op. Test: w `plan.test.js` sekwencje skip→skip, pause→skip, skip w `reveal` (no-op).

### Pułapka 4: Pauza w fazie reveal / intro / countdown
**Co idzie źle:** dziś pauza cofa uczestnika do „Wstrzymano" i po wznowieniu ustawia timer z `modTimePerQRef` (`App.jsx:239-249`) — w reveal pokazywał pytanie ponownie.
**Jak uniknąć:** w modelu kotwicy pauza zamraża `t`; po wznowieniu faza jest dokładnie ta sama (reveal zostaje reveal z tą samą liczbą sekund). `submit_answer_v2` odrzuca w pauzie; klient trzyma optymistyczny wybór i ponawia po wznowieniu. Test: pauza w każdej z 5 faz → wznowienie po 60 s → ta sama faza i ten sam `remaining`.

### Pułapka 5: Rozjazd stałych JS ↔ SQL
**Co idzie źle:** plan budowany w SQL (`start_quiz_session_v2`) z własnymi 10/30/4/6 s, a klient w DEMO/testach z `gameLogic.js`.
**Jak uniknąć:** stałe czasu wpisać do planu (pola `lead`, `o/c/r`) — klient nigdy nie dolicza `REVEAL_SECONDS` sam, bierze `r` z pozycji. Fixture'y `plan.fixtures.json` przepuszczane przez JS (Vitest) i przez RPC `plan_position` (`scripts/verify-plan.js`) muszą dać identyczne wyniki.

### Pułapka 6: `now()` vs `clock_timestamp()`
**Co idzie źle:** `now()` = start transakcji. W funkcji zamiatacza różnica to ms, ale w `submit_answer_v2` pod obciążeniem (czekanie na blokadę unikalności) mogą to być setki ms na niekorzyść uczestnika.
**Jak uniknąć:** wszędzie `clock_timestamp()` zapisany raz do zmiennej na początku funkcji (jak robi dziś §36 i `server_now`).

### Pułapka 7: Pusty zapis przy deadline = lawina
**Co idzie źle:** `handleTimeout` (`App.jsx:407-415`) wysyła `p_chosen=NULL` od każdego, kto nie kliknął, w tej samej ćwierćsekundzie (to, co sekcja 37.1 nazwała lawiną).
**Jak uniknąć:** pusty zapis z jitterem 0–1000 ms po `closesAt` (v2 przycina `rt` do `tpq`, więc jitter nie zmienia rankingu). Alternatywa (do decyzji): w ogóle nie wysyłać pustych — ale wtedy `total_count` i średni czas w rankingu zmieniają znaczenie (dziś puste wiersze wchodzą do średniej z `rt≈tpq`). Rekomendacja: zostawić puste zapisy z jitterem — ranking bez zmian semantyki.

### Pułapka 8: „Ogłoś wyniki" tylko w stanie `paused`
**Co idzie źle:** `AdminPanel.jsx:1109` renderuje przycisk wyłącznie przy `paused` — sonda musi dziś pauzować po ostatnim pytaniu (`probe-gameplay.js:316-327`). Po automatycznym `→ results` przez zamiatacz ta ścieżka zmienia się.
**Jak uniknąć:** zdecydować Otwarte pytanie 1; w każdym wariancie panel pokazuje akcję wyników także przy fazie `finished`/`status='results'`, a sonda FULL przestaje wymagać pauzy.

### Pułapka 9: pg_cron cicho nie działa
**Co idzie źle:** scheduler pg_cron potrafi paść (Supabase troubleshooting: sprawdzić `pg_stat_activity` z `application_name ilike 'pg_cron scheduler'`; restart przez „fast reboot") — [guide](https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz).
**Jak uniknąć:** (1) RPC diagnostyczne `sweeper_status()` (SECURITY DEFINER, zwraca `active`, `schedule`, sekundy od ostatniego `end_time` w `cron.job_run_details` dla `fue-advance-due`) — do `verify-prod` i do panelu admina (czerwony baner „Zamiatacz nie działa", gdy > 5 s). (2) Zapas: `admin_sweep_session(p_session_id)` (rola admina) — panel woła go co 2 s TYLKO gdy widzi `sweeper_status` > 5 s. Nowi uczestnicy i tak nie zależą od zamiatacza (faza z planu, `submit_answer_v2` z planu).

### Pułapka 10: View Transitions w React 18
**Co idzie źle:** `startViewTransition(() => setState(x))` — React 18 aktualizuje asynchronicznie, przeglądarka robi „po" zrzut przed renderem → brak animacji albo mignięcie.
**Jak uniknąć:** `document.startViewTransition(() => flushSync(() => setPhase(x)))`, tylko gdy `"startViewTransition" in document` i nie `prefers-reduced-motion`. Nie opakowywać tym ticków licznika — tylko zmianę fazy/pytania. (MEDIUM — wzorzec szeroko opisany, nieweryfikowany tu dokumentacją React.)

### Pułapka 11: Offline ≠ zatrzymany zegar
**Co idzie źle:** zakłada się, że offline telefon „stoi". W nowym modelu JS dalej liczy fazę z planu, więc SC3 jest spełnione nawet bez sieci — o ile w czasie offline nie było pauzy/skip.
**Jak uniknąć:** przy `online` → snapshot natychmiast (bez jitteru dla pojedynczego telefonu); odpowiedź wybrana offline → kolejka ponowień do `closesAt + 1,5 s`, potem komunikat „Nie udało się zapisać odpowiedzi". `serverClock` nie mierzy offsetu offline (błędy RPC są już pomijane w `measureOnce`).

### Pułapka 12: Sonda i staging
**Co idzie źle:** `probe-gameplay.js:40-43` domyślnie wybiera staging, jeśli w `.env` są klucze `_STAGE` — a staging nie istnieje (ENOTFOUND).
**Jak uniknąć:** zawsze `$env:PROBE_TARGET="prod"; $env:PROBE_CONFIRM="1"`. Sonda musi też sprzątać nowe obiekty: `session_plans` dla sesji testowej (ON DELETE CASCADE nie zadziała, bo sesja nie jest kasowana — jawny DELETE) i przywracać `plan_anchor_at/plan_paused_at/revealed_*` na NULL.

## Przykłady kodu

### Wake Lock z ponawianiem
```js
// src/hooks/useWakeLock.js — natywne API, bez zależności
import { useEffect } from "react";
export default function useWakeLock(active) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock = null, disposed = false;
    const acquire = async () => {
      if (disposed || document.hidden) return;
      try { lock = await navigator.wakeLock.request("screen"); } catch (_) { /* odmowa/brak wsparcia — ignoruj */ }
    };
    const onVis = () => { if (!document.hidden) acquire(); };  // blokada zwalnia się przy ukryciu karty
    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => { disposed = true; document.removeEventListener("visibilitychange", onVis); lock?.release?.().catch(() => {}); };
  }, [active]);
}
```

### Pasek czasu zakotwiczony w terminie (inline style + keyframes w global.css)
```jsx
// global.css:  @keyframes fueDrain { from { transform: scaleX(1) } to { transform: scaleX(0) } }
//              @media (prefers-reduced-motion: reduce) { .fue-drain { animation: none !important } }
<div key={`${item.id}-${opensAt}`} className="fue-drain" style={{
  height: 6, transformOrigin: "left", background: mod.color,
  animationName: "fueDrain", animationTimingFunction: "linear", animationFillMode: "forwards",
  animationDuration: `${item.tpq}s`,
  animationDelay: `${-(serverNow() - opensAt) / 1000}s`,
  animationPlayState: phase === "paused" ? "paused" : "running",
}} />
```

### Filtr próbek zegara (timesync-lite)
```js
export function computeOffset(samples) {
  const ok = samples.filter((s) => typeof s?.serverMs === "number")
    .map((s) => ({ rtt: s.t1 - s.t0, off: s.serverMs - (s.t0 + s.t1) / 2 }))
    .sort((a, b) => a.rtt - b.rtt);
  if (!ok.length) return 0;
  const med = ok[Math.floor(ok.length / 2)].rtt;
  const sd = Math.sqrt(ok.reduce((a, s) => a + (s.rtt - med) ** 2, 0) / ok.length);
  const kept = ok.filter((s) => s.rtt <= med + sd);
  return Math.round(kept.reduce((a, s) => a + s.off, 0) / kept.length);
}
// Istniejące testy serverClock.test.js (min-RTT wygrywa z szumem) muszą dalej przechodzić — sprawdzić przypadek 2.
```

## Sonda — rozszerzenia `scripts/probe-gameplay.js`

Stan obecny (540 linii): setup przez service key (konto admina, pytania `[SONDA]`, kody `PRB-…`, reset sesji miasta, tymczasowe czasy modułów w FULL), przeglądarki: kontekst admina + N telefonów (sessionStorage wstrzyknięty w `:258`), pętla próbkowania 250 ms (`READ` z `innerText`), auto-odpowiedź ~3 s po pojawieniu się pytania, raport 1–6 (czas pytań, host vs telefon, telefon vs telefon, zacięcia, socket, pełna ścieżka), `cleanup()` idempotentny.

**Zmiany bazowe (wymagane przez wszystkie tryby):**
1. Wstrzykiwanie `localStorage.fue_participant` (nowy format) zamiast `sessionStorage`.
2. Aplikacja wystawia `document.body.dataset.fuePhase` (`lobby|intro|countdown|quiz|reveal|paused|finished|results`) + `data-fue-q` (nr globalny) + `data-fue-remaining` (sekundy) + `data-fue-locked` (`0/1`). `READ` czyta atrybuty zamiast regexów (regexy zostają jako fallback dla starego bundla).
3. Cleanup: `DELETE FROM session_plans WHERE session_id = …` + przywrócenie nowych kolumn na NULL w `sessionBefore`.
4. Cel: jawnie `PROBE_TARGET=prod` w dokumentacji nagłówka.
5. Zapis planu z bazy (`svc.from("session_plans")`) na starcie → oczekiwane czasy pytań z planu zamiast `tpq + 6`.

| Tryb | Scenariusz | Asercje (fail →) |
|---|---|---|
| `PROBE_ADMIN_EXIT=1` | po kliknięciu „Start quizu" i potwierdzeniu `status='running'` w bazie: `await ctxAdmin.close()`; pomiar hosta pominięty | każdy telefon przechodzi przez wszystkie pytania; odchylenie początku każdego pytania od `anchor + o` ≤ 1,5 s; telefony dochodzą do `finished`/`results`; w bazie po `r[last] + 3 s` `status='results'` (lub wg Otwartego pytania 1); `current_question_idx` w bazie zgodne z planem przez cały przebieg (odczyt svc co 1 s) |
| `PROBE_REFRESH=1` | telefon 2: jeden `page.reload()` w losowym momencie każdej fazy (`intro`, `countdown`, `quiz` przed odpowiedzią, `quiz` po odpowiedzi, `reveal`) | w ≤ 3 s po reloadzie: ta sama faza i ten sam `q` co telefon 1, `|remaining2 − remaining1| ≤ 1`; jeśli telefon 2 odpowiedział przed reloadem → `data-fue-locked=1` i ta sama litera; nowa metryka w raporcie „różnica licznika po refreshu" |
| `PROBE_OFFLINE=1` | telefon 2 w środku pytania: `ctx.setOffline(true)` na 10 s, potem `false`; wariant: odpowiedź klikana w trakcie offline | przez cały czas offline faza/licznik zgodne z telefonem 1 (projekcja lokalna); po powrocie ≤ 1 s do pełnej zgodności; odpowiedź z czasu offline zapisana w bazie (svc) jeśli powrót nastąpił przed `closes_at + 1,5 s` |

Tryby łączą się z `PROBE_FULL=1`. Czas przebiegu: tryb szybki (3 pytania × (20+6+4) s + 10 s) ≈ 1,5–2 min.

## Stan techniki

| Stare podejście (w repo) | Nowe | Kiedy | Wpływ |
|---|---|---|---|
| Przejście zapisuje przeglądarka (admin `driverTick`, uczestnik `armAdvanceFallback`) | zamiatacz w bazie + faza z planu | faza 6 | karta admina przestaje być potrzebna |
| `tpq` z `ModulesContext` każdego klienta | `tpq` zamrożone w planie | faza 6 | klasa D3 znika konstrukcyjnie |
| `pause_elapsed_s` (int, epoch s) + przesuwanie `q_started_at` z przeglądarki admina | `plan_paused_at` + przesunięcie kotwicy w RPC | faza 6 | pauza nie zależy od stanu React panelu |
| `sessionStorage` | `localStorage` z `session_id` | faza 6 | zamknięcie karty / ubicie PWA nie wylogowuje |
| Kolejność pytań liczona `row_number()` w 3 funkcjach | kolejność zamrożona w `session_plans.items` | faza 6 | edycja pytań w trakcie nie zmienia trwającej sesji |

**Do usunięcia po wdrożeniu (czyszczenie w osobnym planie po zielonej sondzie):** `shouldAdvance`, `advanceLeadSeconds`, `fallbackJitterMs` (+ testy), `armAdvanceFallback`, `advanceQuestion` (poza DEMO), `handleResumeFromBreak`, gałąź zapisu w `driverTick`, polle 20 s w `Break`/`WaitingResults`.

## Otwarte pytania

1. **Co dokładnie znaczy „przejście do wyników" wykonywane przez zamiatacz?**
   - Wiemy: CONTEXT blokuje „obejmuje też przejście ostatnie pytanie → wyniki"; dziś po ostatnim pytaniu sesja zostaje `running`, uczestnicy czekają na `WaitingResults`, a admin musi pauzować i kliknąć „Ogłoś wyniki" (`status='results'` → uczestnik widzi własny wynik `Ended.jsx`; podium na projektorze admin prowadzi osobno przez `onPodium`).
   - Niejasne: czy uczestnicy mają zobaczyć swój wynik automatycznie po ostatnim reveal, czy dopiero na sygnał organizatora.
   - Rekomendacja: zamiatacz ustawia `status='results'` po `r[last]` (ranking/podium i tak pozostaje ręczne po stronie admina, więc ceremonia jest zachowana; znika pułapka „Ogłoś wyniki tylko w pauzie"). Jeśli użytkownik woli ręcznie — zamiatacz ustawia tylko fazę `finished` (bez zmiany statusu), a panel pokazuje „🏆 Ogłoś wyniki" przy `finished`. Planner: jedna linijka w `advance_due_sessions` + ekran; potwierdzić z użytkownikiem przed sekcją 39.
2. **Przerwy po module 2 i 4.** Dziś `BREAK_AFTER=[2,4]` (`App.jsx:54`) daje lokalny ekran „Przerwa", który przy `status='running'` od razu wraca do gry (zapowiedź modułu 30 s); faktyczną przerwę robi admin pauzą. Rekomendacja: nie planować przerw w harmonogramie; faza `intro` pierwszego pytania modułu 3 i 5 pokazuje „Przerwa / Moduł X za …", a admin pauzuje w razie potrzeby (zachowanie bez zmian). Potwierdzić z użytkownikiem.
3. **Auto-skrót (`shouldEndEarly`).** Dla TWE (≤20 s) i tak wyłączony (`AUTO_SKIP_MIN_TPQ=45`). Rekomendacja: zostawić decyzję w panelu, wykonanie przez `admin_skip_question` — to optymalizacja, nie poprawność.
4. **„🔁 Powtórz".** Odpowiedzi już zapisane zostają (`ON CONFLICT DO NOTHING`), więc powtórka ma sens tylko dla tych, którzy nie odpowiedzieli. Rekomendacja: zachować jako przesunięcie kotwicy (parytet), ale snapshot pokaże zablokowaną odpowiedź tym, którzy już odpowiedzieli.
5. **Project ref produkcji.** CONTEXT i pamięć mówią `dmoydtavstpurqebkngu`, a `.env`/sekcja 38 — `ytbwmmqwbfcugouourih` (to on odpowiedział `verify-prod`). Rekomendacja: traktować `.env` jako prawdę; poprawić notatkę w pamięci/CONTEXT przy okazji.
6. **Wersja Postgresa produkcji** (warunek `'1 seconds'`: ≥ 15.1.1.61). Rekomendacja: pierwsza linia kroku human-action sekcji 40: `select version();` + `select extversion from pg_extension where extname='pg_cron';`.

## Dostępność środowiska

| Zależność | Wymagana przez | Dostępna | Wersja | Fallback |
|---|---|---|---|---|
| Node.js | build, vitest, sonda | ✓ | v24.11.0 | — |
| npm | skrypty | ✓ | 11.6.1 | — |
| Vitest | testy jednostkowe | ✓ | 2.1.9 (58/58 zielone) | — |
| Playwright + Chromium | sonda | ✓ | chromium-1223/1234 zainstalowane | — |
| Supabase produkcja (`ytbwmm…`) | wszystko | ✓ | `verify-prod` 25 OK | — |
| Supabase staging (`iaehip…`) | e2e, `load`, `rls`, domyślny cel sondy | ✗ (ENOTFOUND) | — | `PROBE_TARGET=prod` + `PROBE_CONFIRM=1`; `npm run e2e` i `load` są bezużyteczne w tej fazie |
| Dostęp SQL (psql / Supabase CLI / hasło DB) | wgrywanie sekcji 39–41 | ✗ | — | **ręcznie w SQL Editorze** (konwencja repo) → `checkpoint:human-action`, potem `npm run verify-prod` automatycznie |
| pg_cron | zamiatacz | ✗ (jeszcze nie włączony) | — | włączyć w sekcji 40 (SQL lub Dashboard → Integrations → Cron) |

**Brakujące bez obejścia:** brak — ale każdy plan z SQL MUSI zawierać krok ręczny użytkownika.

## Validation Architecture

### Framework testowy
| Właściwość | Wartość |
|---|---|
| Framework | Vitest 2.1.9 (jsdom, `globals: true`) + Playwright (sonda produkcyjna) + skrypty `vite-node` read-only (`verify-prod`, nowy `verify-plan`) |
| Konfiguracja | `vite.config.js` sekcja `test` (setup `src/test-setup.js`, wyklucza `e2e/`) |
| Szybkie uruchomienie | `npx vitest run src/lib/plan.test.js src/lib/gameLogic.test.js src/lib/serverClock.test.js` (< 5 s) |
| Pełny zestaw | `npm test` + `npm run build` + `npm run verify-prod` + `npm run verify-plan` |
| Sonda (bramka fazy) | PowerShell: `npm run build; npm run preview` (osobny terminal), potem `$env:PROBE_TARGET="prod"; $env:PROBE_CONFIRM="1"; $env:PROBE_ADMIN_EXIT="1"; npm run sonda` (analogicznie `PROBE_REFRESH`, `PROBE_OFFLINE`) |

### Mapa kryteriów → testy
| ID | Zachowanie | Typ | Komenda | Plik istnieje? |
|---|---|---|---|---|
| P6-SC1 | Fazy/terminy wyliczone z planu dla każdej chwili; `finished` po `r[last]` | unit | `npx vitest run src/lib/plan.test.js` | ❌ Wave 0 |
| P6-SC1 | Decyzja zamiatacza (co zapisać dla danego `t`) — czysta funkcja `sweepDecision(row, items, now)` w JS jako specyfikacja SQL | unit | `npx vitest run src/lib/plan.test.js -t "zamiatacz"` | ❌ Wave 0 |
| P6-SC1 | JS `planPosition` == SQL `plan_position` na fixture'ach | integracja read-only (prod) | `npm run verify-plan` | ❌ Wave 0 (`scripts/verify-plan.js`) |
| P6-SC1 | Zamiatacz żyje (ostatni przebieg < 5 s) | smoke read-only | `npm run verify-prod` (nowa sekcja 39–40) | ❌ rozszerzenie |
| P6-SC1 | Quiz kończy się bez admina | e2e prod | `PROBE_ADMIN_EXIT=1 npm run sonda` | ❌ tryb do dodania |
| P6-SC2 | Pauza w każdej fazie → wznowienie → ta sama faza i remaining | unit | `npx vitest run src/lib/plan.test.js -t "pauza"` | ❌ Wave 0 |
| P6-SC2 | Refresh zachowuje fazę ±1 s i blokadę odpowiedzi | e2e prod | `PROBE_REFRESH=1 npm run sonda` | ❌ tryb do dodania |
| P6-SC2 | Offset zegara z próbki snapshotu; filtr mediany nie psuje min-RTT | unit | `npx vitest run src/lib/serverClock.test.js` | ✅ (rozszerzyć) |
| P6-SC3 | Offline 10 s → natychmiastowa zgodność; odpowiedź z offline zapisana | e2e prod | `PROBE_OFFLINE=1 npm run sonda` | ❌ tryb do dodania |
| P6-SC4 | Projekcja ignoruje `modules` przy sesji z planem (moduł z innym `timePerQ` nie zmienia `remaining`) | unit | `npx vitest run src/lib/plan.test.js -t "moduły"` | ❌ Wave 0 |
| P6-SC4 | Brak `mod.timePerQ` w ścieżkach renderu uczestnika/LiveView dla sesji z planem | statyczny | `rg -n "timePerQ" src/screens/Quiz.jsx src/hooks/useLiveProjection.js src/App.jsx` (przegląd: tylko gałęzie legacy/DEMO) | — |
| P6-SC5 | Skip/Powtórz/pauza — przesunięcia kotwicy; rt w tolerancji = tpq | unit | `npx vitest run src/lib/plan.test.js -t "przesunięcie"` | ❌ Wave 0 |
| P6-SC5 | `submit_answer_v2` nie zwraca `is_correct`/`correct_ans`; snapshot/summary v2 zwracają NULL przed `closes_at+1,5 s` | integracja prod (sonda: telefon 1 woła RPC w fazie `quiz` i sprawdza pola) | `npm run sonda` (asercja wbudowana) | ❌ |
| P6-SC6 | Stary kontrakt: funkcje i sygnatury używane przez wdrożony front istnieją i odpowiadają jak przed migracją | smoke read-only | `npm run verify-prod` | ✅ (rozszerzyć o nowe funkcje) |
| P6-SC6 | Sesja bez planu nadal działa po staremu (regresja) | e2e prod | `npm run sonda` na STARYM buildzie po wgraniu 39–40 (checkout `87e7c20`, build, preview) | ✅ (istniejąca sonda) |

### Częstotliwość próbkowania
- **Po każdym commicie zadania:** `npx vitest run` (< 5 s).
- **Po każdej fali:** `npm test && npm run build`; po falach z SQL dodatkowo `npm run verify-prod` i `npm run verify-plan` (po ręcznym wgraniu sekcji).
- **Bramka fazy:** komplet zielony + sonda w trzech trybach (`PROBE_ADMIN_EXIT`, `PROBE_REFRESH`, `PROBE_OFFLINE`) + sonda na starym buildzie (SC6) — przed `/gsd:verify-work`.

### Luki Wave 0
- [ ] `src/lib/plan.js` + `src/lib/plan.test.js` — pokrywa SC1, SC2, SC4, SC5 (logika)
- [ ] `src/lib/plan.fixtures.json` — wspólne przypadki JS/SQL
- [ ] `scripts/verify-plan.js` + wpis `"verify-plan": "vite-node scripts/verify-plan.js"` w `package.json`
- [ ] Rozszerzenie `scripts/verify-prod.js` o sekcje 39–41 (istnienie `submit_answer_v2`, `get_participant_state`, `plan_position`, anon zablokowany na `advance_due_sessions`/akcjach admina v2, `sweeper_status`)
- [ ] `data-fue-*` w nowym UI (warunek dla trybów sondy)
- Framework: bez instalacji (wszystko jest).

## Proponowany podział na plany (do uznania plannera — Claude's Discretion)

| Fala | Plan | Zakres | Uwagi |
|---|---|---|---|
| 1 | 06-01 Logika planu (JS) | `plan.js`, fixture'y, testy Vitest, `computeOffset` z filtrem, `addClockSample` | bez zależności od bazy; TDD |
| 1 | 06-02 SQL sekcje 39–40 | tabela, kolumny, `plan_position`, v2 RPC, zamiatacz, cron, diagnostyka, `verify-prod`/`verify-plan` | human-action: wgranie w SQL Editorze; potem automatyczna weryfikacja + sonda na STARYM buildzie (SC6) |
| 2 | 06-03 Warstwa danych + hook uczestnika | `supabase.js` (v2 wrappers z miękkim fallbackiem PGRST202 jak dziś), `useParticipantGame`, `localStorage`, przebudowa routingu `App.jsx` | serce zmiany |
| 2 | 06-04 Panel admina + LiveView | akcje v2, usunięcie zapisu w `driverTick`, `useLiveProjection` z planu, reveal v2, baner zamiatacza | |
| 3 | 06-05 Sonda | tryby ADMIN_EXIT/REFRESH/OFFLINE, `data-fue-*`, cleanup planu | bramka SC1–SC3 |
| 3 | 06-06 Płynność | Wake Lock, pasek CSS, rAF, optimistic lock-in + vibrate, View Transitions, prefetch, szkielet, reduced-motion | niezależne od SQL |
| 4 | 06-07 Utwardzenie (sekcja 41) + sprzątanie kodu | stare RPC bramkowane, `update_quiz_session_admin` odrzuca zmiany gry dla sesji z planem, usunięcie kierowców i martwego kodu | **dopiero po wdrożeniu frontu na Vercel i zielonej sondzie** |

## Źródła

### Pierwotne (HIGH)
- Kod repo przeczytany bezpośrednio: `SUPABASE_FIXES.sql` (1–1287), `SUPABASE_SCHEMA.sql`, `src/App.jsx`, `src/screens/AdminPanel.jsx` (500–1130), `src/lib/{gameLogic,serverClock,supabase}.js`, `src/hooks/useLiveProjection.js`, `src/context/ModulesContext.jsx`, `src/screens/{Quiz,Break,WaitingResults,LiveView,Ended}.jsx`, `scripts/probe-gameplay.js`, `scripts/verify-prod.js`, `.planning/debug/telefon-refresh-blokuje-live-view.md`
- `npm run verify-prod` (produkcja, 24.09.2026) — stan sekcji 16–38
- `npx vitest run` — 58/58 (24.09.2026)
- [Supabase Cron — quickstart](https://supabase.com/docs/guides/cron/quickstart) — `'[1-59] seconds'`, wymóg Postgres ≥ 15.1.1.61, `cron.schedule/unschedule/alter_job`, sprzątanie `job_run_details`
- [Supabase Cron — install](https://supabase.com/docs/guides/cron/install) — `create extension pg_cron with schema pg_catalog` + granty
- [citusdata/pg_cron README](https://github.com/citusdata/pg_cron) — jedna instancja zadania naraz (kolejkowanie), `cron.log_run` (`sighup`, `ALTER SYSTEM`), zalecenie sprzątania przy zadaniach sekundowych

### Wtórne (MEDIUM)
- [Supabase — pg_cron debugging guide](https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz) — scheduler jako background worker, 1 połączenie na zadanie, sprawdzanie `pg_stat_activity`, zalecane pg_cron 1.6.4
- [Supabase Cron docs](https://supabase.com/docs/guides/cron) — rekomendacja ≤ 8 równoległych zadań, ≤ 10 min na zadanie (wg wyników wyszukiwania; nasze zadanie trwa ms)
- `.planning/research/PLYNNOSC-ROZGRYWKI.md` — wzorzec buzrr, Wake Lock/iOS 18.4, timesync

### Niskie (LOW — do potwierdzenia)
- Niemożność wyłączenia `cron.log_run` na Supabase (brak superusera) — wnioskowanie, nie dokumentacja
- Wersja Postgresa/pg_cron na produkcji — niezmierzona (krok human-action)

## Metadane

**Pewność:**
- Stan kodu / SQL / wdrożenia: HIGH — czytane i uruchomione
- Architektura (kotwica + zamiatacz + snapshot): HIGH co do poprawności w Postgresie (blokady, idempotencja), MEDIUM co do obciążenia przy 500 (brak pomiaru — staging martwy)
- pg_cron na Supabase: MEDIUM — oficjalne docs, bez weryfikacji wersji produkcji
- Płynność (natywne API): MEDIUM — z wcześniejszego researchu + wiedza ogólna

**Data researchu:** 2026-09-24
**Ważne do:** ~2026-10-24 (stabilna domena; przeterminowuje się głównie stan wdrożenia SQL — przed wykonaniem ponownie `npm run verify-prod`)
