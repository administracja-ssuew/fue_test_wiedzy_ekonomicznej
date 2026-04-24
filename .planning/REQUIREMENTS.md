# Requirements: FUE Quiz — Test Wiedzy Ekonomicznej

**Defined:** 2026-04-24  
**Core Value:** Admin FUE naciska "Start" → wszyscy uczestnicy na 5 uczelniach jednocześnie widzą to samo pytanie w czasie rzeczywistym.

---

## v1 Requirements

### Structural Refactor

- [x] **STRUCT-01**: Kod źródłowy podzielony na `screens/`, `hooks/`, `lib/`, `styles/` — App.jsx max ~80 linii
- [x] **STRUCT-02**: Hook `useAuth()` obsługuje stan autentykacji i `onAuthStateChange`
- [x] **STRUCT-03**: Hook `useSession(code)` obsługuje Broadcast channel i stan sesji quizu
- [x] **STRUCT-04**: Hook `useTimer(deadline)` liczy czas od serwera (`q_started_at`), nie `setInterval`
- [x] **STRUCT-05**: Hook `useLeaderboard(sessionId)` nasłuchuje Postgres Changes na tabeli `answers`
- [ ] **STRUCT-06**: Istniejący DEMO mode działa bez zmian po refaktorze

### Authentication & Users

- [ ] **AUTH-01**: Admin może się zalogować przez Supabase Auth (email + hasło) — bez hardkodowanego kodu
- [ ] **AUTH-02**: Sesja admina przetrwa odświeżenie strony (token w localStorage)
- [ ] **AUTH-03**: JWT admina ma żywotność ≥4h (zapobiega wygaśnięciu podczas quizu)
- [ ] **AUTH-04**: Uczestnik może się zarejestrować (imię, miasto, uczelnia) i czeka na weryfikację
- [ ] **AUTH-05**: Admin widzi listę oczekujących uczestników i może zatwierdzić/odrzucić konto
- [ ] **AUTH-06**: Zweryfikowany uczestnik może zalogować się i dołączyć do sesji przez kod
- [ ] **AUTH-07**: Każdy uczestnik ma unikalne `auth.uid()` (anonymous sign-in lub email) do RLS

### Session Management

- [ ] **SESS-01**: Admin może stworzyć sesję quizu z automatycznie generowanym 6-cyfrowym kodem
- [ ] **SESS-02**: Uczestnik może dołączyć do sesji wpisując 6-cyfrowy kod
- [ ] **SESS-03**: Sesja przechowuje stan w DB (`waiting → active → question_open → question_closed → results → podium → finished`)
- [ ] **SESS-04**: Wiele sesji może działać równolegle (Stage 1: 5 miast jednocześnie)
- [ ] **SESS-05**: Sesja Stage 1 jest przypisana do konkretnego miasta; Stage 2 jest ogólnopolska

### Real-Time Quiz Control

- [ ] **RT-01**: Admin klika "Start" → wszyscy uczestnicy danej sesji przechodzą do ekranu pytania jednocześnie
- [ ] **RT-02**: Timer uczestnika oparty o `q_started_at` z serwera (nie lokalny `setInterval`)
- [ ] **RT-03**: Uczestnik nie może przejść do następnego pytania samodzielnie — admin kontroluje postęp
- [ ] **RT-04**: Po wygaśnięciu timera uczestnik widzi "Oczekiwanie na admina" (nie auto-przechodzi)
- [ ] **RT-05**: Uczestnik który straci połączenie i wróci widzi aktualny stan sesji (fetch z DB przy reconnect)
- [ ] **RT-06**: Odpowiedź uczestnika jest zapisywana do tabeli `answers` w Supabase

### Answer Recording & Scoring

- [ ] **ANS-01**: Każda odpowiedź uczestnika zapisywana do DB: `session_id`, `user_id`, `question_id`, `chosen`, `is_correct`, `points`, `response_time`
- [ ] **ANS-02**: Ograniczenie UNIQUE(`session_id`, `user_id`, `question_id`) zapobiega duplikatom
- [ ] **ANS-03**: Punktacja obliczana server-side lub przez zaufany trigger (nie tylko w przeglądarce)
- [ ] **ANS-04**: Odpowiedź po upływie czasu (timeout) jest odrzucana i zapisywana jako `points: 0`

### Leaderboard & Results

- [ ] **LB-01**: Admin widzi live leaderboard aktualizowany po każdej odpowiedzi uczestnika (Postgres Changes)
- [ ] **LB-02**: Leaderboard pokazuje wyniki posortowane malejąco z oznaczeniem miasta każdego uczestnika
- [ ] **LB-03**: Podium (1., 2., 3. miejsce) oparte na rzeczywistych danych z DB (nie fake data)
- [ ] **LB-04**: Aggregate ranking miast (suma punktów lub średnia per uczelnia)
- [ ] **LB-05**: Top 5 z każdego miasta w Stage 1 jest identyfikowalne dla admina (do awansu do Stage 2)

### Database Schema & RLS

- [ ] **DB-01**: Tabele: `profiles`, `quiz_sessions`, `participants`, `answers` — stworzone w Supabase
- [ ] **DB-02**: RLS policies zaprojektowane i przetestowane przed jakimkolwiek participant-facing kodem
- [ ] **DB-03**: Uczestnik może czytać tylko swoją sesję i swoje odpowiedzi
- [ ] **DB-04**: Admin może czytać wszystkie sesje, uczestników i odpowiedzi swojego miasta
- [ ] **DB-05**: Global admin (Prezydium FUE) widzi wszystkie miasta

### Question Bank

- [ ] **Q-01**: Pytania przeniesione z hardkodowanego `questions.js` do tabeli `questions` w Supabase
- [ ] **Q-02**: Admin może dodać/edytować/usunąć pytanie przez panel admina (CRUD)
- [ ] **Q-03**: Pytanie ma: treść, 4 opcje, poprawną odpowiedź, kategorię, limit czasu, flagę `active`
- [ ] **Q-04**: Pytania w sesji są pobierane z DB i przesyłane przez Broadcast (nie z lokalnego pliku)

### History & Archive

- [ ] **HIST-01**: Każda edycja quizu jest archiwizowana w DB z datą, uczelnią-gospodarzem i wynikami
- [ ] **HIST-02**: Admin może przeglądać wyniki poprzednich edycji

---

## v2 Requirements

### Uczestnik

- Human-readable join URL (np. `fue-quiz.pl/join/842917`) na projektorze
- Uczestnik widzi swoje wyniki z poprzednich edycji po zalogowaniu tym samym emailem
- Animacje przejść między pytaniami (liczenie wyników, wjazd pytania)

### Admin

- Import pytań z CSV/Excel
- Statystyki per pytanie (% poprawnych, średni czas odpowiedzi)
- Eksport wyników do PDF/Excel po zakończeniu
- Tryb "pauza" — admin może wstrzymać quiz

### Infrastruktura

- Dźwięki (Web Audio API) — tick-tock, sukces/błąd, fanfara podium
- QR kod dołączenia na projektorze
- Screensaver/waiting screen dla projektora

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Redux / React Query | Supabase klient + useState wystarczy na tę skalę |
| Zewnętrzne biblioteki UI (MUI, Chakra, Tailwind) | Design custom FUE — nie zmieniamy |
| Capacitor / React Native | PWA wystarczy dla tego use case |
| Push notyfikacje FCM | Web Push API jako v3 opcja, nie teraz |
| Randomizacja pytań per uczestnik | Konkurs synchroniczny — wszyscy muszą widzieć to samo pytanie |
| Real-time odpowiedzi innych uczestników | Integralność konkursu — uczestnicy nie widzą odpowiedzi innych |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STRUCT-01 | Phase 1 | Pending |
| STRUCT-02 | Phase 1 | Pending |
| STRUCT-03 | Phase 1 | Pending |
| STRUCT-04 | Phase 1 | Pending |
| STRUCT-05 | Phase 1 | Pending |
| STRUCT-06 | Phase 1 | Pending |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| AUTH-05 | Phase 2 | Pending |
| AUTH-06 | Phase 2 | Pending |
| AUTH-07 | Phase 2 | Pending |
| SESS-01 | Phase 2 | Pending |
| SESS-02 | Phase 2 | Pending |
| SESS-03 | Phase 2 | Pending |
| SESS-04 | Phase 2 | Pending |
| SESS-05 | Phase 2 | Pending |
| DB-01 | Phase 2 | Pending |
| DB-02 | Phase 2 | Pending |
| DB-03 | Phase 2 | Pending |
| DB-04 | Phase 2 | Pending |
| DB-05 | Phase 2 | Pending |
| RT-01 | Phase 3 | Pending |
| RT-02 | Phase 3 | Pending |
| RT-03 | Phase 3 | Pending |
| RT-04 | Phase 3 | Pending |
| RT-05 | Phase 3 | Pending |
| RT-06 | Phase 3 | Pending |
| ANS-01 | Phase 3 | Pending |
| ANS-02 | Phase 3 | Pending |
| ANS-03 | Phase 3 | Pending |
| ANS-04 | Phase 3 | Pending |
| LB-01 | Phase 4 | Pending |
| LB-02 | Phase 4 | Pending |
| LB-03 | Phase 4 | Pending |
| LB-04 | Phase 4 | Pending |
| LB-05 | Phase 4 | Pending |
| Q-01 | Phase 5 | Pending |
| Q-02 | Phase 5 | Pending |
| Q-03 | Phase 5 | Pending |
| Q-04 | Phase 5 | Pending |
| HIST-01 | Phase 5 | Pending |
| HIST-02 | Phase 5 | Pending |
