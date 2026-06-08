# FUE Quiz — Audyt przedprodukcyjny (TWE)

**Data:** 2026-06-08 · **Zakres:** logika, funkcjonalność, obciążenie, realtime, bezpieczeństwo danych i bazy · **Środowiska:** staging (`iaehipybmcxrvgyfmcfr`) + produkcja (`dmoydtavstpurqebkngu`) · **Commit main:** `0534b82`

## Werdykt ogólny

**Aplikacja jest funkcjonalnie i wydajnościowo GOTOWA** — wszystkie zautomatyzowane zestawy przechodzą, realtime/sync działa co do sekundy, skala 100 uczestników bez błędów. **Przed ogłoszeniem „bazy w pełni zabezpieczonej" wymagane są 3 poprawki bezpieczeństwa** (sekcja niżej) + wgranie 2 sekcji SQL na produkcję. Żadna z nich nie blokuje działania quizu, ale dwie są istotne dla integralności wyników i kontroli dostępu.

| Obszar | Ocena | Uwaga |
|---|---|---|
| Logika (scoring, timer, projekcja) | ✅ bardzo dobra | 27/27 testów jednostkowych |
| Funkcjonalność (pełny przepływ) | ✅ bardzo dobra | boty E2E 27/27, Playwright 3/3 |
| Obciążenie / skala | ✅ dobra | 100 uczestników, p95 591 ms, 0 błędów |
| Realtime / synchronizacja | ✅ bardzo dobra | zegar serwera + instant push |
| Bezpieczeństwo RLS (dane) | 🟡 dobre z lukami | 14/14 granic anon, ale 3 wektory niżej |
| Konfiguracja Auth | 🔴 do poprawy | publiczna rejestracja WŁĄCZONA |
| Higiena sekretów | ✅ ok | `.env` w `.gitignore`, brak kluczy w kodzie |

---

## 1. Testy automatyczne (wyniki z tego przebiegu)

| Zestaw | Komenda | Wynik | Metryki |
|---|---|---|---|
| Jednostkowe (logika) | `npm test` | ✅ **27/27** | scoring, `remainingSeconds`, `projectLiveState`, `computeOffset` |
| Bezpieczeństwo RLS | `npm run rls` | ✅ **14/14** | anon nie czyta answers/codes; RPC admina zablokowane dla anon |
| Zegar serwera | `npm run verify-clock` | ✅ OK | offset +295 ms, RTT 45 ms, rozjazd po korekcie **0 s** |
| Boty E2E (przepływ) | `npm run bot` | ✅ **27/27** | dołączenie→58 pytań→ranking→cleanup |
| Obciążenie | `npm run load` | ✅ OK | 100/100 połączeń, **p95=591 ms**, 724 zapisy, 0 dup, 0 błędów, exactly-once advance |
| Realtime instant-push | `npm run verify-realtime` | ✅ OK | sekcja 21 (answers) działa na prod |
| Re-join kodu | `npm run verify-mark` | ✅ OK | sekcja 24 na prod, licznik nie zacina się na „1/0" |
| Browser E2E | `npm run e2e` | ✅ **3/3** | uczestnik + LiveView sync + lock-in (1. przebieg miał flaky cold-start dev-servera) |

**Wniosek:** logika gry, przepływ uczestnika i synchronizacja są solidne i powtarzalne.

---

## 2. Obciążenie i skala

Realny test 100 jednoczesnych uczestników (osobny WebSocket każdy), 5 miast:

- **Połączenia realtime:** 100/100, 0 błędów połączenia
- **Latencja advance→odbiór:** p50=276 ms, **p95=591 ms**, p99=620 ms, max=624 ms (próg <1500 ms ✅)
- **Zapisy odpowiedzi:** 724 ok, 0 duplikatów, 0 błędów
- **Exactly-once advance:** 50 równoczesnych wywołań → dokładnie 1 wygrane ✅ (brak podwójnego przeskoku pytania pod wyścigiem)

**Projekcja na 500 (cel TWE):** Supabase Free obsługuje ~200 równoczesnych połączeń realtime; **dla 500 uczestników rekomendowany jest płatny plan Pro** (limit połączeń + przepustowość). Architektura (czysta projekcja stanu + broadcast) jest liniowa — wąskim gardłem jest limit połączeń realtime planu, nie kod. Patrz `npm run report` (prognozy 200–500).

---

## 3. Bezpieczeństwo — USTALENIA (priorytetowo)

### 🔴 H-1: Publiczna rejestracja WŁĄCZONA + RPC admina bez kontroli roli
**Dowód:** endpoint `/auth/v1/settings` zwraca `disable_signup=false` na **staging i produkcji**. RPC `update_quiz_session_admin` (i pokrewne) sprawdza tylko `auth.uid() IS NULL`, **nie sprawdza roli**, a grant jest na `authenticated`.

**Ryzyko:** dowolna osoba może się zarejestrować (potwierdzić własnym mailem — `mailer_autoconfirm=false`, ale potwierdzenie jest trywialne) i jako `authenticated` wywołać `update_quiz_session_admin`, `start_quiz_session`, `get_session_results` → **przejąć sterowanie sesją lub odczytać pełne wyniki** (potrzebny tylko UUID sesji).

**Rekomendacja (wybierz; najlepiej oba):**
1. **Szybko i pewnie:** w Supabase → Authentication → Sign In / Providers → **wyłącz rejestrację email** (Allow new users to sign up = OFF) na produkcji. Uczestnicy są anon, admini już istnieją — nikt nie potrzebuje signupu.
2. **Defense-in-depth (kod):** dodać kontrolę roli w RPC admina: `IF public.get_my_role() NOT IN ('city_admin','superadmin') THEN RAISE EXCEPTION 'forbidden'; END IF;`. ⚠️ Testować ostrożnie — patrz [[supabase-auth-uid-null-gotcha]] (twarde blokowanie na `auth.uid()` psuło wcześniej pauzę/koniec).

### 🟠 M-1: `answers_public_insert WITH CHECK (true)` — anon może sfałszować odpowiedzi
**Dowód:** [SUPABASE_SCHEMA.sql:177](SUPABASE_SCHEMA.sql#L177). Polityka INSERT na `answers` przyjmuje dowolny wiersz od anona.

**Ryzyko:** anonimowy klient może wstawić wiersze `is_correct=true` dla **dowolnego** `participant_code` (i dla każdego pytania — unikat dopuszcza 1/pytanie). Ponieważ ranking = liczba poprawnych, pozwala to **zawyżyć/zaniżyć wynik dowolnego uczestnika**.

**Rekomendacja:** zapis odpowiedzi przez `SECURITY DEFINER` RPC, które: (a) waliduje istnienie kodu, (b) liczy `is_correct` **po stronie serwera** z `questions.ans` (nie ufa klientowi), (c) sprawdza, że pytanie należy do sesji/miasta. Następnie `REVOKE INSERT ON answers FROM anon` i wąska polityka. To domyka też M-2.

### 🟠 M-2: Poprawna odpowiedź (`ans`) wysyłana do klienta
**Dowód:** [supabase.js](src/lib/supabase.js) `getQuestions` robi `select("*")` (zawiera `ans`); [Quiz.jsx:109](src/screens/Quiz.jsx#L109) liczy `ok = i === currentQ.ans` po stronie klienta.

**Ryzyko:** technicznie zaawansowany uczestnik może odczytać `ans` z ruchu sieciowego/pamięci i zawsze odpowiadać poprawnie.

**Mitygacja obecna:** egzamin **stacjonarny z nadzorem** na 5 uczelniach + anti-cheat (wykrywanie zmiany karty/screenshotów logowane do admina) + blokady kopiowania. Dla TWE to akceptowalne.

**Rekomendacja docelowa:** nie wysyłać `ans` do klienta przed reveal; walidować wybór serwerowo (RPC jak w M-1). Wtedy nawet odczyt payloadu nic nie daje.

### 🟢 Pozytywy bezpieczeństwa (potwierdzone)
- **Hardening kodów (sekcja 27) jest na produkcji** — anon **nie** enumeruje `participant_codes` (zweryfikowane sondą). Luka z nazwiskami/kodami zamknięta.
- **Sekcja 23** — anon zablokowany na `get_session_results`, `update_quiz_session_admin`, `start_quiz_session`, `get_admin_question_stats` (zweryfikowane na prod).
- anon **nie czyta** `answers` (tylko własne przez `get_participant_answers`), nie zmienia sesji bezpośrednio.
- **Sekrety:** `.env` w `.gitignore`, **brak hardcoded kluczy/haseł** w `src/` (grep czysty). Klucz serwisowy i hasła admina tylko lokalnie.
- **Anti-cheat:** zmiana karty + PrintScreen/screenshot (macOS) logowane do admina w realtime; deterrenty na prawy-klik/kopiuj/Ctrl+P/S/U.

---

## 4. Stan wdrożenia SQL (produkcja)

`npm run verify-prod` (rozszerzony o sekcje 25–28):

| Sekcja | Funkcja | Produkcja |
|---|---|---|
| 16–24 | get_participant_answers, get_admin_*, mark_code_used, advance(3-arg), sekcja 23 grants, event_log | ✅ wgrane |
| 27 | validate_participant_code, count_participants_in_session, code_exists, REVOKE anon SELECT | ✅ **wgrane** |
| 28 | server_now (sync zegara) | ✅ **wgrane** |
| **26** | advance_session_question(**4-arg, p_lead_seconds**) | ❌ **BRAK** |
| 25 | get_session_results (ranking po poprawnych) | ⚠️ **niezweryfikowane** (funkcja admin-only — nie da się sondą anon) |

**Działanie do wykonania (Ty, w Supabase produkcja):**
- **Wgraj sekcję 26** — bez niej zapowiedź modułu 30 s **nie zadziała** (fallback do zwykłego odliczania; quiz działa).
- **Wgraj/odśwież sekcję 25** (idempotentna) — **krytyczne dla wyników**: bez niej ranking pokaże 0/0 poprawnych. Po wgraniu zweryfikuj na ekranie wyników admina, że pokazuje „X/Y poprawnych".

---

## 5. Logika i funkcjonalność (szczegóły zweryfikowane)

- **Scoring/ranking** = liczba poprawnych odpowiedzi (bez punktów), remis → krótszy średni czas; spójne w rankingu, podium, ekranie końca, CSV (boty potwierdzają sortowanie malejące).
- **Timer**: jeden wzór `remainingSeconds(q_started_at, serverNow())` u uczestnika i na Live View → identyczna sekunda (test jednostkowy + verify-clock).
- **Przejścia pytań**: `advance_session_question` pod wyścigiem 50 wywołań → exactly-once (load), reszta klientów dostaje stan instant-push (broadcast) + backstop (postgres_changes/poll).
- **Re-join** po odświeżeniu/resecie: `mark_code_used` aktualizuje `session_id` (verify-mark), licznik X/N nie zacina się.
- **Pauza/wznowienie/koniec**: sterowane wyłącznie przez admina; uczestnicy nie zapisują statusu (świadomy „BUG 3 FIX").

---

## 6. Lista działań (priorytety)

| Prio | Działanie | Gdzie | Status |
|---|---|---|---|
| 🔴 1 | Wyłączyć publiczną rejestrację (signup) | Supabase Auth (prod) | **do zrobienia** |
| 🔴 2 | Wgrać sekcję 25 (ranking) + zweryfikować wyniki | Supabase SQL (prod) | **do zrobienia** |
| 🟠 3 | Wgrać sekcję 26 (zapowiedź modułu) | Supabase SQL (prod) | **do zrobienia** |
| 🟠 4 | Zapis odpowiedzi serwerowy + ukryć `ans` (RPC, domyka M-1/M-2) | kod + SQL | **rekomendacja** (osobny branch) |
| 🟢 5 | Kontrola roli w RPC admina (defense-in-depth) | SQL | rekomendacja |
| 🟢 6 | Plan Supabase Pro przed realnym 500 | infrastruktura | przed eventem |

**Po wykonaniu 1–3 produkt jest gotowy na TWE.** Punkty 4–5 podnoszą bazę do poziomu „w pełni zabezpieczona" niezależnie od nadzoru stacjonarnego — chętnie przygotuję je na osobnym branchu z testami.
