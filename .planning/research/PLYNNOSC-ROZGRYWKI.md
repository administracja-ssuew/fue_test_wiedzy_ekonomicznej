# Research: rozgrywka mechanicznie nie do podważenia + płynność „jak aplikacja"

**Data:** 2026-09-24 · **Kontekst:** po śledztwie `telefon-refresh-blokuje-live-view` (zamarzanie przy niewidocznej karcie admina) i niewyjaśnionym ~70 s zawieszeniu na ostatnim pytaniu.

## TL;DR

Mamy już dobry fundament: zegar serwera (`serverClock.js`), czysta projekcja stanu (`projectLiveState`), punktacja liczona zegarem bazy (`submit_answer`: `clock_timestamp() - q_started_at`). **Słaby punkt jest jeden i ma charakter architektoniczny: pytanie zmienia się dopiero wtedy, gdy któraś przeglądarka to zapisze** (admin-kierowca, a awaryjnie uczestnicy z jitterem 6–14 s). Każdy objaw z ostatnich tygodni — zamarzanie, przeskoki, rozjazd host/telefon — to ten sam mechanizm w innym przebraniu: stan gry zależy od tego, czy jakiś klient żyje, jest widoczny i nie jest dławiony.

Wzorzec z dojrzałych klonów Kahoota: **serwer trzyma harmonogram (deadline'y), klient tylko go rysuje, a przejścia robi serwer.** W naszym stosie bez własnego serwera da się to zrobić w samym Postgresie:

1. **Harmonogram deterministyczny** — faza gry to czysta funkcja `(server_now, kotwica startu, zamrożone czasy pytań, pauzy)`. Nikt nie musi niczego „przesuwać", żeby każdy ekran wiedział, co ma pokazać.
2. **Zamiatacz `pg_cron` co 1 s** — funkcja w bazie domyka pytania, którym minął deadline. Karta admina przestaje być potrzebna do działania gry.
3. **Jeden RPC „snapshot"** przy starcie/odświeżeniu — faza, pytanie, deadline, własna odpowiedź, wynik. Odświeżenie niczego nie zmienia, bo niczego nie trzyma lokalnie.

Kryterium akceptacji, które da się zmierzyć: **admin zamyka przeglądarkę w trakcie quizu, a quiz dochodzi do końca identycznie na wszystkich telefonach.**

---

## 1. Diagnoza — gdzie dziś rozgrywkę da się podważyć

| # | Miejsce | Problem | Skutek |
|---|---|---|---|
| D1 | `AdminPanel.jsx` ~653–750 (`driverTick`) | Przejście pytania wymaga `setInterval` w karcie admina. Dzisiejsza poprawka (`visibilitychange`) skraca zamarzanie, ale go nie usuwa — karta ukryta = brak ticków do czasu powrotu. | Cała sala stoi, gdy laptop admina śpi / ma inną kartę / padnie Wi-Fi. |
| D2 | `App.jsx` ~414–462 + `fallbackJitterMs` | Awaryjny kierowca po stronie uczestników rusza po 6–14 s. | Nawet gdy działa, każde przejście bez admina to 6–14 s „dziury" = zgłaszane przeskoki. |
| D3 | `projectLiveState` + `ModulesContext` | Czas pytania (`timePerQ`) każdy klient bierze z WŁASNEGO pobrania modułów. | Klasa błędu ROOT CAUSE 5 (fallback 90/30/60/75/45 s) — różne telefony, różne czasy. Naprawione ponowieniem, ale nie wykluczone konstrukcyjnie. |
| D4 | `App.jsx` 126–141 | Stan uczestnika w `sessionStorage`. | Zamknięcie karty / ubicie PWA na iOS = utrata sesji i ponowne wpisywanie kodu (kod zadziała, bo `fue_device_id` jest w `localStorage`, ale to zbędny zgrzyt). |
| D5 | `submit_answer` (SQL, sekcja ~1074) | Zwraca `correct_ans` natychmiast po odpowiedzi. | Uczestnik zna poprawną odpowiedź, zanim minie czas pytania — może ją pokazać sąsiadowi. Buzrr: poprawną opcję wysyła się dopiero po zamknięciu pytania. |
| D6 | Ostatnie pytanie (~70 s zawieszenia z sondy) | Niewyjaśnione. **Hipoteza, nie ustalenie:** przejście `ostatnie pytanie → wyniki` ma inną ścieżkę niż zwykłe `advance`. | W modelu z pkt. 2 i 3 poniżej wszystkie przejścia, łącznie z końcem, idą przez jedną funkcję w bazie — znika ta klasa różnic. |

Co jest już dobre i zostaje: pomiar offsetu zegara metodą min-RTT (`computeOffset`), ponowny pomiar przy powrocie karty, `advance_session_question` z compare-and-swap na `expectedIdx` (w teście obciążeniowym: 50 równoległych wywołań → dokładnie 1 wygrane), walidacja `time is up` w bazie z tolerancją 1,5 s.

---

## 2. Jak to robią inni (GitHub)

| Repo | Model czasu | Co warto przejąć |
|---|---|---|
| [buzrr/buzrr](https://github.com/buzrr/buzrr) ([ARCHITECTURE.md](https://raw.githubusercontent.com/buzrr/buzrr/main/ARCHITECTURE.md)) | Deadline'y w trwałym zbiorze posortowanym po czasie (Redis), blokada właściciela na grę, **zamiatacz co 15 s jako backstop**; po restarcie „odpala zaległe, uzbraja resztę". | Najważniejsza zasada: **„the countdown never drives a transition"**. Reconnect dostaje pełny snapshot zamiast odtwarzania zdarzeń. Punkty z zegara serwera, tolerancja 300 ms po deadline liczona jak odpowiedź na deadline. Poprawna odpowiedź ujawniana dopiero po zamknięciu pytania. |
| [KokserM/kazoot-quiz](https://github.com/KokserM/kazoot-quiz) | Serwer trzyma timer; zdarzenie startu pytania niesie `questionStartedAt`, `questionEndsAt` i `serverTime`. | Klient liczy odliczanie z **deadline'u**, nie z ticków. Po odświeżeniu token gracza przywraca to samo miejsce. |
| [quizdock/quiz-dock](https://github.com/quizdock/quiz-dock) | Socket.IO, autorytatywny czas serwera. | Potwierdzenie wzorca, bez nowych pomysłów. |
| [supabase-community/kahoot-alternative](https://supabase.com/blog/meetup-kahoot-alternative) | Host ręcznie klika „dalej", Realtime na `postgres_changes`. | **Antywzorzec dla nas**: dokładnie nasz dawny model (przejście zależne od przeglądarki hosta), bez obsługi reconnectu. Dowód, że „oficjalny" przykład Supabase nie rozwiązuje naszego problemu. |
| [enmasseio/timesync](https://github.com/enmasseio/timesync) | Synchronizacja zegara wieloma próbkami. | Filtr: sortuj po RTT, odrzuć próbki powyżej ~1 odchylenia od mediany, uśrednij resztę. Nasz `computeOffset` bierze jedną próbkę z min-RTT — to wystarcza, ale filtr jest odporniejszy na pojedynczą przekłamaną próbkę. **Biblioteki nie warto dodawać**: to ~15 linii w istniejącej funkcji. |

Wspólny mianownik wszystkich dojrzałych implementacji: **deadline po stronie serwera + backstop, który odpala zaległe przejścia + snapshot przy reconnect.** Żadna nie opiera przejść na timerze w przeglądarce.

---

## 3. Przełożenie na nasz stos (Supabase, bez własnego serwera)

### 3.1 Harmonogram deterministyczny — „każdy ma ten sam czas" z konstrukcji

Przy starcie quizu `start_quiz_session` **zamraża plan** w wierszu sesji: listę pytań w kolejności i czas każdego (`schedule jsonb` albo tabela `session_schedule(session_id, idx, question_id, opens_at, closes_at, reveal_until)`). Od tej chwili:

- Faza dowolnego klienta = czysta funkcja `(serverNow(), plan)`. `projectLiveState` już prawie to robi — zmiana polega na tym, że bierze czasy z planu sesji, a nie z modułów pobranych przez klienta. **To usuwa klasę D3 konstrukcyjnie**, nie ponowieniem.
- Zmiana czasu modułu w panelu w trakcie wydarzenia nie wpływa na trwającą sesję (bezpiecznik).
- Pauza = zapis `paused_at`; wznowienie przesuwa wszystkie przyszłe deadline'y o długość pauzy (jeden UPDATE). „⏭ Następne" admina = przesunięcie planu od bieżącego pytania. To są **rzadkie, jawne akcje**, nie tyknięcia co sekundę.
- Realtime przestaje być ścieżką krytyczną: jest potrzebny tylko do rozgłoszenia pauzy/skoku. Utracony komunikat = najwyżej opóźniona reakcja na pauzę, nigdy rozjazd czasu pytania.

### 3.2 Zamiatacz w bazie zamiast admina-kierowcy

Supabase Cron (`pg_cron`) obsługuje harmonogramy co 1–59 s na wszystkich planach ([docs](https://supabase.com/docs/guides/cron), [pg_cron](https://github.com/citusdata/pg_cron)): `cron.schedule('advance-due', '1 seconds', 'select advance_due_sessions()')`.

- `advance_due_sessions()` przestawia `current_question_idx` (i status na `results` po ostatnim pytaniu) sesjom, którym minął deadline. Używa tego samego compare-and-swap co dziś → idempotentne, wielokrotne odpalenie niczego nie psuje.
- Przy harmonogramie z 3.1 zamiatacz jest **potrzebny tylko dla stanu w bazie** (walidacja `submit_answer`, panel, eksport). Ekrany i tak liczą fazę z planu, więc nawet 1–2 s opóźnienia zamiatacza nie są widoczne dla nikogo.
- Koszt: 1 lekkie zapytanie/s na całą bazę, niezależnie od liczby uczestników. Uwaga z dokumentacji pg_cron: czyścić `cron.job_run_details` (przy 1 s to 86 400 wierszy/dobę) i najlepiej wyłączyć dla tego zadania szczegółowe logowanie. Uruchamiać zadanie tylko na czas wydarzenia albo zostawić tanie `WHERE status='running'`.
- Admin-kierowca w `AdminPanel.jsx` i awaryjny kierowca uczestników (`fallbackJitterMs`) **do usunięcia** po wdrożeniu — mniej kodu, zero stampede.
- Nawet `submit_answer` może liczyć „które pytanie jest aktywne" wprost z planu i `clock_timestamp()`, a nie z `current_question_idx`. Wtedy poprawność odpowiedzi nie zależy nawet od zamiatacza.

### 3.3 Odświeżenie niczego nie zmienia — snapshot

Jeden RPC `get_participant_state(p_code)` zwraca: sesję, plan (lub bieżące pytanie + deadline), `server_now`, własną odpowiedź na bieżące pytanie (jeśli jest) i sumę punktów. Ekran po starcie/odświeżeniu/powrocie z tła renderuje się **wyłącznie** z tej odpowiedzi.

- Już odpowiedział → widzi zablokowaną swoją odpowiedź (dziś `ON CONFLICT DO NOTHING` chroni bazę, ale UI po odświeżeniu może pokazać pytanie jako nieodpowiedziane).
- Stan uczestnika w **`localStorage`** zamiast `sessionStorage` (D4), z `session_id` jako kluczem ważności — zamknięcie karty lub ubicie PWA nie wylogowuje.
- Ten sam snapshot wołamy przy `visibilitychange → visible` i przy reconnect socketu. Jedna ścieżka zamiast kilku (`handleCodeSuccess` → `startQuiz` → `syncToSession`).

### 3.4 Uczciwość punktacji i odpowiedzi

- **Poprawna odpowiedź dopiero po deadline** (D5): `submit_answer` zwraca tylko „przyjęto"; `correct_ans` przychodzi ze snapshotu/fazy `reveal`. Anty-ściąga na sali.
- **Czas odpowiedzi**: dziś `clock_timestamp() - q_started_at` na serwerze — nie do podważenia, ale zawiera czas wysyłki (100–300 ms na słabym LTE). Opcje:
  - zostawić czysty zegar serwera (jak buzrr) — prosto do obrony w regulaminie („liczy się moment dotarcia odpowiedzi"),
  - albo przyjąć czas zmierzony przez klienta z jego zsynchronizowanego zegara, **obcięty do przedziału** `[czas_serwera − limit_RTT, czas_serwera]` — klient nie może sobie dodać, tylko odzyskać opóźnienie sieci.
  To decyzja regulaminowa, nie techniczna — do ustalenia z organizatorami.
- **Tolerancja deadline'u**: dziś 1,5 s. Buzrr: 300 ms i odpowiedź w oknie tolerancji liczona jak na deadline. Nasze 1,5 s jest bezpieczne na sali z Wi-Fi, ale warto liczyć punkty za tę strefę jak za deadline (zero bonusu czasowego), żeby spóźnienie nie dawało przewagi.

### 3.5 Zegar

`serverClock.js` jest poprawny. Drobne wzmocnienia: filtr próbek w stylu timesync (mediana ± odchylenie), 6–8 próbek przy starcie zamiast 4, i ponowny pomiar także przy reconnect socketu. Offset można dołączać do snapshotu (`server_now` w odpowiedzi), więc refresh od razu ma pierwszą próbkę bez osobnego RPC.

---

## 4. Płynność „jak aplikacja" (bez bibliotek UI — tylko natywne API)

Kolejność od największego efektu:

1. **Screen Wake Lock** (`navigator.wakeLock.request('screen')`) na czas lobby i quizu. Wygaszony ekran telefonu to na sali najczęstsza przyczyna zamrożonego timera i ponownej synchronizacji. Wsparcie >94 % przeglądarek, iOS Safari od 16.4, **w PWA z ekranu głównego działa dopiero od iOS 18.4** ([web.dev](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers), [caniuse](https://caniuse.com/wake-lock), [WebKit #254545](https://bugs.webkit.org/show_bug.cgi?id=254545)). Blokada zwalnia się przy ukryciu karty → ponawiać przy `visibilitychange`.
2. **Pasek czasu jako animacja CSS zakotwiczona w deadline**: `animation-duration: tpq; animation-delay: -(elapsed)` liczone raz z planu. Kompozytor przeglądarki animuje go płynnie w 60/120 Hz, niezależnie od zadławionego wątku JS i od tego, czy `setInterval` się spóźnił. Cyfry sekund z `requestAnimationFrame` + `serverNow()`, nie z licznika `setInterval` — licznik nie może „przeskoczyć" o 2 s po zadławieniu, bo zawsze pokazuje wynik z deadline'u.
3. **Natychmiastowa reakcja na dotyk**: blokada wybranej odpowiedzi w UI w tej samej klatce (optimistic), `navigator.vibrate(15)` tam, gdzie działa (Android; iOS go nie obsługuje — bez szkody). Wynik z serwera tylko potwierdza.
4. **Brak pustych ekranów przy odświeżeniu**: szkielet ekranu pytania od razu z danych zapisanych lokalnie, potem uzupełnienie ze snapshotu. Tło miasta jest już cache'owane — to samo dla treści bieżącego pytania.
5. **Wstępne pobranie kolejnego pytania** (obrazy, jeśli są) w oknie reveal — przejście nie czeka na sieć.
6. **View Transitions API** (`document.startViewTransition`) dla przejść pytanie → reveal → kolejne pytanie. Natywne, zero zależności; tam, gdzie nie ma wsparcia, po prostu brak animacji.
7. `prefers-reduced-motion` szanowane dla wszystkich powyższych animacji.

---

## 5. Proponowana kolejność wdrożenia

| Krok | Zakres | Zależności | Ryzyko |
|---|---|---|---|
| 1 | Plan sesji zamrażany przy starcie + projekcja z planu (3.1) | SQL + `gameLogic.js` + testy regresyjne w Vitest | Średnie — dotyka serca rozgrywki; mocne pokrycie istniejącymi testami projekcji |
| 2 | `advance_due_sessions()` + `pg_cron` co 1 s (3.2); usunięcie kierowcy admina i fallbacku uczestników | Krok 1 | Niskie — funkcja idempotentna, CAS już sprawdzony |
| 3 | Snapshot RPC + `localStorage` + jedna ścieżka restore (3.3) | Krok 1 | Niskie |
| 4 | `correct_ans` po deadline, punkty w strefie tolerancji (3.4) | Decyzja regulaminowa co do czasu odpowiedzi | Niskie |
| 5 | Wake Lock, pasek CSS, optimistic lock-in (4.1–4.3) | Niezależne, można równolegle | Bardzo niskie |
| 6 | View Transitions, prefetch, szkielety (4.4–4.6) | Po 5 | Kosmetyka |

## 6. Jak to zmierzymy (rozszerzenia sondy `scripts/probe-gameplay.js`)

Obecna sonda świadomie wyłącza dławienie kart w tle, więc nie złapie scenariusza z karty admina. Zamiast symulować dławienie, testujmy mocniejszy warunek:

- **`PROBE_ADMIN_EXIT=1`** — po starcie quizu zamknąć kontekst admina całkowicie. Oczekiwane: wszystkie pytania i przejście do wyników w tych samych czasach co z adminem (dziś: quiz by stanął).
- **`PROBE_REFRESH=1`** — przeładować telefon w losowym momencie każdej fazy (odliczanie, pytanie, reveal, zapowiedź modułu). Oczekiwane: po przeładowaniu identyczna faza i licznik co drugi telefon (różnica ≤ 1 s), odpowiedź udzielona przed przeładowaniem nadal widoczna jako zablokowana.
- **`PROBE_OFFLINE=1`** — odciąć sieć telefonu na 10 s w środku pytania (`context.setOffline`). Oczekiwane: po powrocie od razu właściwa faza, bez „dojeżdżania".
- Metryki bez zmian: czas pytania, host vs telefon, telefon vs telefon, maks. czas bez zmiany pytania, plus nowa: **różnica licznika po refreshu vs telefon referencyjny**.

## 7. Otwarte decyzje dla użytkownika

1. Czas odpowiedzi: czysty zegar serwera czy obcięty czas klienta (3.4)?
2. Czy ręczne „⏭ Następne" ma zostać w finale (wymaga przesunięcia planu), czy na finał wystarczy sztywny harmonogram + pauza?
3. Czy kroki 1–3 robimy przed najbliższym wydarzeniem, czy tylko 5 (płynność) + obecne łatki, a architekturę po nim? Uwaga: tylko kroki 1–3 odpowiadają na „mechanicznie nie do podważenia"; krok 5 poprawia odczucie, ale nie usuwa zależności od karty admina.

---

## Źródła

- [buzrr/buzrr](https://github.com/buzrr/buzrr) · [ARCHITECTURE.md](https://raw.githubusercontent.com/buzrr/buzrr/main/ARCHITECTURE.md)
- [KokserM/kazoot-quiz](https://github.com/KokserM/kazoot-quiz)
- [quizdock/quiz-dock](https://github.com/quizdock/quiz-dock)
- [Supabase — The open source Kahoot alternative](https://supabase.com/blog/meetup-kahoot-alternative)
- [enmasseio/timesync](https://github.com/enmasseio/timesync)
- [Supabase Cron docs](https://supabase.com/docs/guides/cron) · [Supabase Cron blog](https://supabase.com/blog/supabase-cron) · [citusdata/pg_cron](https://github.com/citusdata/pg_cron)
- [web.dev — Screen Wake Lock supported in all browsers](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers) · [caniuse — wake-lock](https://caniuse.com/wake-lock) · [WebKit bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545)
