---
status: resolved
trigger: "telefon-refresh-blokuje-live-view — odświeżenie strony (F5) na telefonie uczestnika w trakcie trwającego pytania zamraża timer/quiz, co odbija się na Live View w panelu admina — wznawia się dopiero gdy admin wraca uwagą/focusem do panelu"
created: 2026-09-24T00:00:00Z
updated: 2026-09-24T01:00:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: POTWIERDZONA (analiza statyczna + wzorce w kodzie). "Kierowca" przejścia
pytania (SesjaTab, `liveStatsRef` setInterval 1000ms w AdminPanel.jsx) jest JEDYNYM
miejscem zapisującym `advance_session_question` do bazy w produkcji. Karta laptopa
admina, gdy traci widoczność (np. bo tester trzyma uwagę na TELEFONIE — drugim,
fizycznie niezależnym urządzeniu — więc laptop stoi bezczynnie i może się
zablokować/wygasić ekran, albo admin realnie przełącza okno), zostaje przez
przeglądarkę dławiona (`setInterval` w karcie ukrytej/w tle → nawet do 1 tiku/minutę
po dłuższym ukryciu). Nic w kodzie nie wymuszało natychmiastowego dociągnięcia po
powrocie widoczności (ten wzorzec już istnieje gdzie indziej: serverClock.js,
ModulesContext.jsx — ale brakowało go w kierowcy). Efekt: CAŁA rozgrywka (dla
wszystkich uczestników danego miasta, nie tylko odświeżonego telefonu) stoi, dopóki
admin nie wróci uwagą do panelu — co idealnie pasuje do zgłoszonych objawów (1) i
(3)/(4). Objaw (2), "Live View też stoi", to ten sam mechanizm w tej samej karcie:
`useLiveProjection`'s 250ms ticker (czysto lokalny render z `serverNow()`) też jest
dławiony przez tę samą kartę — stąd oba efekty "budzą się" w tej samej chwili.
Odświeżenie telefonu (F5) NIE jest przyczyną per se — jest tylko trigger'em, który
uwidacznia lukę, bo w teście jedną osobą na dwóch urządzeniach jest tylko JEDEN
uczestnik, więc jego własny fallback (`armAdvanceFallback`, patrz Evidence) jest
jedyną siecią bezpieczeństwa poza kierowcą — a i on wymaga, by telefon sam doszedł
do zera lokalnie, więc realny margines samoleczenia to ~12-20s po końcu pytania.
test: (1) `npm run build` — przeszedł. (2) `npx vitest run` — 58/58 zielone (bez
regresji). (3) Analiza statyczna: grep na `visibilitychange` w AdminPanel.jsx przed
poprawką = 0 wyników (potwierdzona luka). (4) Sonda produkcyjna (`PROBE_CONFIRM=1
npm run sonda`, `scripts/probe-gameplay.js`) — 5 przebiegów na prawdziwej produkcji
(staging potwierdzone martwy: `iaehipybmcxrvgyfmcfr.supabase.co` → ENOTFOUND),
user świadomie zdecydował się na tę ścieżkę zamiast testu na fizycznych urządzeniach.
Bazowy, niezmodyfikowany przebieg z poprawką: czysty ("rozgrywka płynna"). Próba
odtworzenia SAMEGO throttlingu karty w tle przez syntetyczny spam
`visibilitychange` ujawniła NIEZWIĄZANĄ, preexistującą anomalię (patrz Evidence) —
zizolowana przez porównanie z kodem sprzed poprawki (identyczny wynik), więc
wykluczona jako regresja tej zmiany. Prawdziwego throttlingu setInterval w
konkretnie karcie admina NIE dało się wiarygodnie wymusić z poziomu headless
automatyzacji — to jawnie odnotowane ograniczenie tej weryfikacji, patrz
Resolution.verification.
expecting: Po poprawce: gdy karta admina wraca na pierwszy plan (visibilitychange →
`!document.hidden`), kierowca odpala się NATYCHMIAST (nie czeka na kolejny,
potencjalnie mocno opóźniony, tik `setInterval`) — więc opóźnienie "aż admin wróci
uwagą" znika niemal całkowicie (staje się ograniczone tylko do faktycznego czasu,
przez jaki admin faktycznie nie patrzył, a nie do dodatkowego narzutu throttlingu).
next_action: ZWERYFIKOWANE sondą produkcyjną (npm run sonda, PROBE_CONFIRM=1) zamiast
testu na prawdziwych urządzeniach — użytkownik zdecydował się na tę ścieżkę
weryfikacji. Wynik: brak regresji od poprawki (patrz Evidence i Resolution.verification
poniżej). Realnego throttlingu karty w tle NIE dało się wiarygodnie odtworzyć w
zautomatyzowanej sondzie (patrz uzasadnienie w Evidence) — to jawnie odnotowane
ograniczenie weryfikacji, nie ukryte. Commitnięte lokalnie (c2180d6), NIE wypchnięte
na remote. Decyzja o przeniesieniu do resolved/ pozostawiona użytkownikowi.

## Symptoms

expected: Po odświeżeniu strony przez uczestnika w trakcie pytania, aplikacja powinna
bezproblemowo przywrócić sesję (ścieżka restore: sessionStorage["fue_participant"] →
handleCodeSuccess → Lobby → startQuiz → syncToSession, App.jsx ~126-141 i ~548-613) i
dalej synchronicznie odliczać czas razem z resztą uczestników i z Live View admina,
bez zamrożenia.

actual: Test jedną osobą, dwa urządzenia (telefon=uczestnik, laptop=host/admin).
Odświeżenie strony na telefonie W TRAKCIE trwającego pytania powoduje:
1. Czas na ekranie telefonu "staje" (zamraża się).
2. Live View w panelu admina (laptop) też "jakby staje" (nie pokazuje reveal/przejścia).
3. Dopiero gdy admin wraca uwagą do panelu — Live View momentalnie "wraca do żywych".
4. W TYM SAMYM momencie telefon też zaczyna reagować (reveal + odliczanie do kolejnego).

errors: Brak błędów w konsoli (użytkownik nie sprawdzał jeszcze).

reproduction: Telefon jako uczestnik, laptop jako host z Live View otwartym. W trakcie
trwającego pytania odśwież telefon. Dokładny czas między odświeżeniem a "powrotem
uwagi admina" nieokreślony w zgłoszeniu.

started: Zgłoszone 24.09.2026, w trakcie testów przed kolejną edycją TWE. Bardzo
świeże powiązane śledztwo (rozgrywka-przedwczesne-skroty.md, zamknięte tego samego
dnia) miało podobny scenariusz testowy (telefon+laptop), ale inny trigger (naturalne
wyjście z poczekalni + zaszyte czasy modułów w fallbacku), nie explicit F5 w trakcie
pytania.

## Eliminated

- hypothesis: Restauracja uczestnika po F5 (sessionStorage → handleCodeSuccess →
  Lobby → startQuiz → syncToSession) ma logiczny błąd, który zamraża lokalny licznik
  na telefonie (np. `mod`/MODULES niezaładowane, `qStartedAtRef` nieustawiony).
  evidence: Przeczytano App.jsx w całości (linie 126-613). `syncToSession` poprawnie
  ustawia `qStartedAtRef.current`, `modTimePerQRef.current`, `currentMod`, `qIdx`,
  `timer` z DB. `ModulesContext` (`useModules()`) inicjalizuje się SYNCHRONICZNIE
  hardcoded fallbackiem `MODULES` z data/questions.js (moduły 1-5 zawsze obecne), więc
  `getModule(currentMod, MODULES)` nigdy nie zwraca `undefined` — hipoteza "efekt
  timera nie startuje bo `mod` jest `undefined`" jest fałszywa (guard `if (!mod)
  return;` w App.jsx:178 nigdy nie blokuje w praktyce). Interval w efekcie timera
  (App.jsx:176-198) czyta wyłącznie refy (`qStartedAtRef`, `modTimePerQRef`,
  `serverNow()`) — nie zależy od niczego, co mogłoby "zamrozić się" po restore.
  timestamp: 2026-09-24T00:00:00Z

- hypothesis: Device-binding / `claim_participant_code` blokuje coś po odświeżeniu.
  evidence: Ścieżka restore (sessionStorage → handleCodeSuccess) NIE przechodzi przez
  CodeEntry/`validateParticipantCode`/`claim_participant_code` w ogóle — używa
  zcache'owanych danych uczestnika bezpośrednio. Device-binding dotyczy tylko
  PIERWSZEGO wpisania kodu, nie odświeżenia. Brak mechanizmu, który mógłby tu
  zablokować cokolwiek.
  timestamp: 2026-09-24T00:00:00Z

- hypothesis: Martwy socket Realtime po F5 (analogiczny do ROOT CAUSE 4 z
  rozgrywka-przedwczesne-skroty.md — socket umierał po wyjściu z poczekalni).
  evidence: `keepRealtimeAlive()` (App.jsx:112, supabase.js:31-34) subskrybuje kanał
  `fue-keepalive` NA STAŁE przy każdym mount aplikacji (w tym po F5) — lista kanałów
  nigdy nie schodzi do zera, więc supabase-js nie ma powodu rozłączać socketu. Fix z
  23.09 pokrywa też ten scenariusz (F5 to pełny remount, więc `keepRealtimeAlive`
  odpala się od nowa, zanim cokolwiek innego zdąży się rozłączyć).
  timestamp: 2026-09-24T00:00:00Z

## Evidence

- timestamp: 2026-09-24T00:00:00Z
  checked: rozgrywka-przedwczesne-skroty.md, race-condition-advance-question.md,
    quiz-flow-broken.md, knowledge-base.md (przeczytane w całości przed startem)
  found: Architektura "admin kierowca" (SesjaTab pisze `advance_session_question` co
    1s) wprowadzona 09.2026 (commit 5d76829), już PO tym jak quiz-flow-broken.md
    (23.05.2026) uznał "admin switching tab cannot affect participants" — WTEDY to
    była prawda (admin nie sterował niczym), TERAZ nieaktualne, bo architektura się
    zmieniła. Sonda `scripts/probe-gameplay.js` jawnie WYŁĄCZA throttling kart w tle
    chromium flagami (`--disable-background-timer-throttling` itd., linie 220-228) z
    komentarzem: "wszystkie konteksty poza jednym SĄ w tle — nie dałoby się odróżnić
    realnego opóźnienia od artefaktu pomiaru". To oznacza: cała istniejąca sonda
    (58/58 testów, wielokrotne "ROZWIĄZANE") NIGDY nie zmierzyła zachowania kierowcy
    pod realnym throttlingiem karty w tle — luka w pokryciu testowym, nie tylko w
    kodzie. Wcześniejsza notatka "dławienie timerów w kartach w tle — objaw identyczny
    z wyłączonym dławieniem" (rozgrywka-przedwczesne-skroty.md) dotyczyła INNEGO
    zestawu objawów (rozjazd czasu z ROOT CAUSE 4/5, mierzonych zawsze z throttlingiem
    wyłączonym) — nie jest to sprzeczne z nową hipotezą, po prostu throttling nigdy
    realnie nie był przetestowany.
  implication: Nowa hipoteza (throttling karty admina blokuje kierowcę) nie jest
  sprzeczna z żadnym wcześniejszym ustaleniem — dotyczy luki, której wcześniejsze
  śledztwa strukturalnie nie mogły wykryć (bo ich własne narzędzie ją maskowało).

- timestamp: 2026-09-24T00:00:00Z
  checked: grep "visibilitychange|document.hidden" w AdminPanel.jsx
  found: 0 wyników przed poprawką. Analogiczny mechanizm ISTNIEJE już w dwóch innych
  miejscach projektu z bardzo podobnym uzasadnieniem: serverClock.js:69
  ("Telefon z zablokowanym ekranem... Przy powrocie karty na pierwszy plan mierzymy
  od nowa") i ModulesContext.jsx:56 ("Telefon z zablokowanym ekranem usypia timery —
  po powrocie sprawdzamy od nowa"). Kierowca (jedyne miejsce piszące
  `advance_session_question` w produkcji, AdminPanel.jsx ~648-727) nie miał tego
  wzorca.
  implication: Wzorzec "dociągnij po visibilitychange" jest już uznaną, przetestowaną
  konwencją w tym repo dla dokładnie tej klasy problemu (dławione timery po
  ukryciu/zablokowaniu karty) — brakowało go tylko w jednym, najbardziej krytycznym
  miejscu (kierowca).

- timestamp: 2026-09-24T00:00:00Z
  checked: useLiveProjection.js (hook napędzający zarówno LiveTab-embed w AdminPanel,
    jak i standalone LiveView) — ticker 250ms (linie 109-161)
  found: `tick()` liczy `phase/timer/autoSec` WYŁĄCZNIE z `projectLiveState(session,
  questions, modules, now=serverNow())` — to czysta funkcja czasu, nie ma żadnego
  stanu narastającego. Gdy karta admina jest ukryta, ten interval też się dławi, ale
  po powrocie widoczności NASTĘPNY tik (nawet mocno spóźniony) i tak przelicza
  poprawny, AKTUALNY stan (nie "nadrabia zaległości" krok po kroku) — więc "Live View
  momentalnie wraca do żywych" jest naturalnym, nieszkodliwym efektem throttlingu
  renderowania w tej samej karcie, a NIE osobnym bugiem. To POTWIERDZA spójność
  hipotezy: to ten sam mechanizm (throttling karty admina) manifestujący się na dwa
  sposoby w tym samym oknie czasowym — kosmetycznie w Live View (opóźniony render) i
  funkcjonalnie w kierowcy (opóźniony zapis do bazy, który blokuje WSZYSTKICH,
  w tym odświeżony telefon).
  implication: Fix celowany w kierowcę (SesjaTab) jest właściwym miejscem — naprawia
  funkcjonalny problem. `useLiveProjection` nie wymaga analogicznej poprawki (czysto
  kosmetyczne opóźnienie renderu własnego ekranu admina, samo-koryguje się na
  następnym ticku niezależnie od czasu ukrycia).

- timestamp: 2026-09-24T00:00:00Z
  checked: App.jsx `armAdvanceFallback`/`fallbackJitterMs` (linie 425-443, 498, 717) —
    mechanizm zaprojektowany jawnie na wypadek "gdyby admin padł"
  found: Fallback uzbraja się dopiero PO lokalnym `handleTimeout()` (koniec pytania na
  danym telefonie) + `REVEAL_SECONDS` (6s) + jitter `fallbackJitterMs` (6-14s) = ok.
  12-20s po końcu pytania, ZANIM którykolwiek telefon sam zapisze przejście. W
  realnym wydarzeniu (setki uczestników) to wystarczająca siatka bezpieczeństwa. W
  teście JEDNĄ osobą na dwóch urządzeniach nie ma redundancji — jedyny telefon jest
  jedynym potencjalnym wyzwalaczem fallbacku, więc gdy kierowca ORAZ ten jeden telefon
  akurat oba nie działają (throttling laptopa I ewentualnie telefon też nie jest
  aktywnie obserwowany), realny czas "zamrożenia" może się wydawać dłuższy niż 12-20s
  i sprawiać wrażenie "wisi w nieskończoność, aż ktoś wróci uwagą".
  implication: To NIE jest bug do naprawienia osobno — to nieodłączna cecha testu
  jedną osobą (brak redundancji uczestników). Wart odnotowania jako czynnik składowy
  objawu, nie jako coś do poprawki w tej sesji. Zmniejszanie jittera ryzykowałoby
  ponowne wprowadzenie problemu "stampede", który ten margines celowo zapobiega
  (udokumentowane w gameLogic.js komentarzach).

- timestamp: 2026-09-24T00:30:00Z
  checked: Commit lokalny poprawki (`c2180d6`) — user poprosił o commit przed
    weryfikacją sondą, zamiast testu na prawdziwych urządzeniach.
  found: `git add src/screens/AdminPanel.jsx .planning/debug/telefon-refresh-blokuje-live-view.md`
    + commit w stylu repo (polski, imperatyw, bez polskich znaków w treści commita —
    zgodnie z fdc3bee/e2a46dc/24727b3). NIE wypchnięte na remote (user nie prosił o push).
  implication: Poprawka jest teraz częścią historii repo, gotowa do weryfikacji sondą.

- timestamp: 2026-09-24T00:35:00Z
  checked: `npm run build && npm run preview` (port 4173) + `PROBE_CONFIRM=1
    PROBE_TARGET=prod npm run sonda` (Kraków, 3 pytania, domyślny tryb — NIE FULL) —
    CZYSTY przebieg, bez żadnej modyfikacji sondy, z zastosowaną poprawką.
  found: pyt.1: 26.5s ✅  pyt.2: 26.7s ✅  pyt.3: 25.9s ✅ — host vs telefon: 0.0%
    rozbieżnych, 0 ms ✅ — telefon vs telefon: maks. 1s ✅ — najdłuższy czas bez zmiany
    pytania: 26.7s (limit 34s) ✅ — socket: 1× otwarcie, 0× zamknięcie, 32 ramki,
    3 zdarzenia dla 3 pytań ✅. `✅ SONDA: rozgrywka płynna`. Sprzątanie czyste
    (0 pytań/kodów sondy pozostało).
  implication: Poprawka NIE wprowadza regresji w normalnym przebiegu — metryki
    identyczne z historycznymi czystymi przebiegami sondy (rozgrywka-przedwczesne-
    skroty.md, pomiar kontrolny po ROOT CAUSE 5).

- timestamp: 2026-09-24T00:40:00Z
  checked: Próba uczciwego zweryfikowania SAMEGO throttlingu karty w tle. Sonda
    (nawet niezmodyfikowana) uruchamia admina i telefony jako OSOBNE `browser.
    newContext()` (osobne "okna" przeglądarki), i jawnie WYŁĄCZA throttling flagami
    Chromium (`--disable-background-timer-throttling` itd., bo "wszystkie konteksty
    poza jednym SĄ w tle — nie dałoby się odróżnić realnego opóźnienia od artefaktu
    pomiaru"). Realnego dławienia `setInterval` w KONKRETNIE karcie admina (a nie we
    wszystkich pozostałych) nie da się więc wiarygodnie wymusić z poziomu automatyzacji
    bez kontrolowania fokusu okna na poziomie OS — poza zasięgiem headless Playwright
    w tym środowisku.
  found: Zbudowano tymczasowy wariant sondy (`scripts/_tmp-probe-visibility.js`, USUNIĘTY
    po teście, nie w repo), który zamiast prawdziwego throttlingu nadpisuje
    `document.hidden`/`visibilityState` na stronie admina i ręcznie emituje zdarzenie
    `visibilitychange` (hidden→visible) co ~1.5s przez cały przebieg — testuje TYLKO,
    czy nowy listener jest podłączony i czy jego częste odpalanie nie psuje normalnego
    przebiegu. To NIE jest test realnego throttlingu przeglądarki (jawnie odnotowane,
    nie ukryte).
  implication: Ten eksperyment ujawnił NIEZWIĄZANĄ anomalię (patrz kolejny wpis) —
    nie potwierdził ani nie zaprzeczył samej naprawie throttlingu w sposób, któremu
    można ufać jako "realnemu" testowi.

- timestamp: 2026-09-24T00:50:00Z
  checked: Wynik przebiegu z ręcznym spamem `visibilitychange` (89× w ~130s, sesja
    Kraków ponownie użyta) — z poprawką.
  found: pyt.1: 26.5s ✅  pyt.2: 26.9s ✅  ALE pyt.3 (OSTATNIE pytanie): 78.2s (ucięte
    limitem czasu) ❌, telefon vs telefon: 70s rozjazdu ❌, quiz "stał" 78.2s ❌. Błędów
    w konsoli admina: brak.
  implication: Wygląda na regresję — ale TYLKO na OSTATNIM pytaniu, mimo że kierowca
    dla ostatniego pytania w ogóle nie zapisuje przejścia (`nextIdx >= cityQuestions.
    length` → wczesny return), więc podejrzenie NIE pada od razu na nowy kod. Wymaga
    izolacji zmiennej.

- timestamp: 2026-09-24T00:55:00Z
  checked: IZOLACJA — `git checkout fdc3bee -- src/screens/AdminPanel.jsx` (kod SPRZED
    poprawki), przebudowa, ten sam spam-harness, ta sama ponownie użyta sesja Kraków.
  found: IDENTYCZNY wynik: pyt.1/2 czyste (26.3/26.6), pyt.3: 78.2s ucięte, telefon vs
    telefon: 70s rozjazdu, quiz stał 78.2s. Błędów konsoli admina: brak. Liczba
    przełączeń widoczności: 97×.
  implication: Anomalia WYSTĘPUJE IDENTYCZNIE bez poprawki. Poprawka jest OCZYSZCZONA
    z podejrzenia — to nie ona powoduje ten efekt. Przywrócono poprawkę
    (`git checkout c2180d6 -- src/screens/AdminPanel.jsx`, przebudowano, zdiffowano
    przeciw HEAD — zero różnic, poprawka w 100% przywrócona).

- timestamp: 2026-09-24T01:00:00Z
  checked: Dodatkowa izolacja — CZYSTA, niezmodyfikowana sonda (`npm run sonda`, bez
    ŻADNEGO spamu visibilitychange), poprawka przywrócona, ta sama ponownie użyta
    sesja Kraków (4. przebieg pod rząd na tej samej sesji) ORAZ osobny przebieg na
    ŚWIEŻEJ sesji innego miasta (Warszawa, `PROBE_CITY=Warszawa`, sesja
    `2c301723-...`, nigdy wcześniej nie dotknięta w tej sesji debugowania).
  found: Kraków (4. przebieg, reużywana sesja): pyt.1/2 czyste, pyt.3 (OSTATNIE):
    znów 78.1s ucięte + 71s rozjazdu telefon-telefon — MIMO braku spamu i MIMO
    poprawki. Warszawa (świeża sesja): pyt.1-4 CAŁKOWICIE czyste (26.3/26.9/27.1/26.8s),
    ale pyt.5 (OSTATNIE, znów ucięte limitem czasu) też pokazało ~70s rozjazdu
    telefon-telefon (przebieg NQ=5 mimo domyślnego PROBE_QUESTIONS=3 — Warszawa miała
    już istniejące, prawdziwe pytania produkcyjne w module 1 poza tymi zasianymi przez
    sondę; sprzątanie sondy dotyka wyłącznie własnych, otagowanych `[SONDA]` wierszy,
    więc dane produkcyjne miasta pozostały nietknięte).
  implication: Anomalia "telefon vs telefon ~70s rozjazdu na OSTATNIM pytaniu" jest
    PREEXISTUJĄCA, niezwiązana z tą poprawką — występuje z i bez niej, z i bez spamu
    widoczności, na reużywanej I na całkiem świeżej sesji/mieście. To ODRĘBNY,
    wcześniej nieznany problem (prawdopodobnie w samej sondzie — sposobie, w jaki
    telefony kończą OSTATNIE pytanie lokalnie bez dalszej koordynacji przez kierowcę —
    albo w app.jsx dla przypadku "brak kolejnego pytania"), poza zakresem tego
    śledztwa. Odnotowane w Resolution jako osobna, niezaadresowana obserwacja.
    Kluczowe dla TEGO śledztwa: WSZYSTKIE przejścia NIE-ostatnich pytań (te, które
    faktycznie przechodzą przez kierowcę) były czyste w KAŻDYM z 5 przebiegów sondy
    (26.3-27.1s, 0ms rozjazdu host-telefon, za każdym razem) — poprawka nie regresuje
    tej ścieżki.

## Resolution

root_cause: |
  Kierowca przejścia pytania (SesjaTab w AdminPanel.jsx, jedyne miejsce piszące
  `advance_session_question` do bazy w produkcji od commitu 5d76829, 09.2026) działa
  wyłącznie jako `setInterval(..., 1000)` w karcie przeglądarki admina. Przeglądarki
  dławią `setInterval` w kartach ukrytych/w tle (do 1 tiku/minutę po dłuższym
  ukryciu — Chrome "Intensive Throttling"). Nic w kodzie nie wymuszało natychmiastowego
  dociągnięcia po powrocie widoczności karty (wzorzec ten istniał już gdzie indziej w
  repo — serverClock.js, ModulesContext.jsx — ale nie w kierowcy). Gdy admin przez
  jakiś czas nie patrzy na kartę panelu (np. bo fizycznie testuje DRUGIE, niezależne
  urządzenie — telefon — i laptop stoi bezczynnie/blokuje się), kierowca przestaje
  pisać do bazy, więc CAŁA rozgrywka (dla wszystkich uczestników danego miasta) stoi
  w miejscu, dopóki admin nie wróci uwagą do panelu i nie odblokuje karty. To
  manifestuje się jednocześnie jako "zamrożony telefon" i "zamrożony Live View", bo
  oba czekają na to samo zdarzenie (zapis DB przez kierowcę). Refresh (F5) telefonu
  sam w sobie nie jest przyczyną — jest tylko wyzwalaczem, który uwidacznia lukę
  w teście jedną osobą (brak innych uczestników, których fallback mógłby zadziałać
  jako sieć bezpieczeństwa w ciągu ~12-20s, jak działałaby przy realnej liczbie
  uczestników).

fix: |
  src/screens/AdminPanel.jsx (SesjaTab, ~641-758): wydzielono ciało kierowcy
  (dawny anonimowy callback `setInterval`) do nazwanej funkcji `driverTick`, z
  ochroną przed nakładaniem wywołań (`driverTickingRef`). `driverTick` jest teraz
  wołany zarówno przez `setInterval(driverTick, 1000)`, JAK I natychmiast przy
  `document.visibilitychange`, gdy karta wraca na pierwszy plan
  (`!document.hidden`). Usuwa to zależność od czekania na kolejny (potencjalnie
  mocno opóźniony przez throttling) tik — moment odzyskania widoczności karty
  admina = moment, w którym kierowca natychmiast nadrabia zaległe przejście
  pytania (jeśli minął już jego czas). Ten sam wzorzec ("dociągnij po powrocie
  widoczności") jest już użyty w src/lib/serverClock.js i
  src/context/ModulesContext.jsx dla analogicznego problemu.

verification: |
  Zweryfikowane statycznie, testami automatycznymi ORAZ sondą produkcyjną
  (`npm run sonda`, `scripts/probe-gameplay.js`) — user zdecydował się na tę ścieżkę
  zamiast testu na prawdziwych urządzeniach.
  - `npm run build` — przechodzi bez błędów.
  - `npx vitest run` — 58/58 testów zielone, brak regresji w gameLogic/serverClock/xlsx.
  - Code review: `driverTick` zachowuje identyczną logikę biznesową (shouldAdvance,
    shouldEndEarly, advanceSessionQuestion) — jedyna zmiana to WYWOŁANIE (kiedy
    funkcja się odpala), nie CO robi. Ochrona `driverTickingRef` zapobiega
    podwójnemu zapisowi, gdyby `setInterval` i `visibilitychange` odpaliły się
    blisko siebie.
  - Sonda produkcyjna (5 przebiegów, `PROBE_CONFIRM=1`, cel: prawdziwa produkcja):
    czysty bazowy przebieg z poprawką = "rozgrywka płynna" (identyczne metryki jak
    historyczne czyste przebiegi w rozgrywka-przedwczesne-skroty.md). Wszystkie
    przejścia pytań NIE-ostatnich (te faktycznie sterowane przez kierowcę) były
    czyste w KAŻDYM z 5 przebiegów: 26.3-27.1s (oczekiwane 26s), 0ms rozjazdu
    host-telefon, za każdym razem — poprawka nie wprowadza regresji.
  - UCZCIWE OGRANICZENIE weryfikacji: sonda (nawet po dodaniu eksperymentalnego
    spamu zdarzeniem `visibilitychange`) NIE odtwarza PRAWDZIWEGO dławienia
    `setInterval` przez przeglądarkę w tle — to wymaga realnej utraty fokusu okna na
    poziomie OS, poza zasięgiem headless Playwright z wieloma kontekstami (sam
    autor sondy explicite wyłącza throttling flagami Chromium z tego samego powodu).
    Eksperymentalny wariant sondy z ręcznym `document.dispatchEvent(new Event(
    "visibilitychange"))` potwierdza tylko, że nowy listener jest podłączony i że
    jego częste odpalanie nie psuje normalnego przebiegu (izolacja przez porównanie
    z kodem SPRZED poprawki, patrz Evidence) — NIE potwierdza, że fix naprawia
    realny scenariusz "admin nie patrzy na laptopa przez 30-60s". To ostatnie
    pozostaje niezweryfikowane empirycznie; opiera się na analizie statycznej
    (mechanizm throttlingu przeglądarek jest dobrze udokumentowany, a analogiczny
    wzorzec "dociągnij po visibilitychange" już działa w tym repo dla serverClock.js
    i ModulesContext.jsx).
  - PRZY OKAZJI odkryto ODRĘBNĄ, PREEXISTUJĄCĄ anomalię niezwiązaną z tą poprawką:
    "telefon vs telefon: ~70s rozjazdu" konsekwentnie na OSTATNIM pytaniu przebiegu
    sondy (reprodukowana z I bez poprawki, z I bez spamu widoczności, na reużywanej
    I na świeżej sesji/mieście — patrz Evidence). Nieadresowana w tej sesji, poza
    zakresem. Wymaga osobnego śledztwa.

files_changed:
  - src/screens/AdminPanel.jsx

## Zamknięcie sesji

Poprawka zcommitowana lokalnie (`c2180d6`, NIE wypchnięta na remote). Zweryfikowana
sondą produkcyjną bez regresji na ścieżce, którą zmienia. Rzeczywisty scenariusz
(throttling karty admina w tle przez >30s) pozostaje niezweryfikowany empirycznie z
udokumentowanych powodów wyżej — decyzja o przeniesieniu do `resolved/` pozostawiona
użytkownikowi w głównej rozmowie.

**Odnotowane, NIE zaadresowane w tej sesji (do rozważenia osobno):**
1. Brak w AdminPanel.jsx ekranu/widoku rozłączonych/utkniętych uczestników z akcją
   `releaseCode` (RPC już istnieje w `src/lib/supabase.js` ~131-135, brak miejsca w
   UI). Zgłoszone przez usera jako osobny temat na `/gsd:quick`.
2. Nowo odkryta anomalia "telefon vs telefon ~70s rozjazdu na ostatnim pytaniu
   sondy" (patrz verification wyżej) — nieznanego pochodzenia, wymaga osobnego
   śledztwa zanim ktoś na niej polega jako sygnale jakości.
3. User zasygnalizował szerszy, PÓŹNIEJSZY cel: uczynienie całej rozgrywki płynną/
   dopracowaną "jak prawdziwa aplikacja", minimalizując odczuwalne skoki/przeskoki —
   wykracza poza tę pojedynczą poprawkę i świadomie NIE został podjęty w tej sesji
   (scope creep). Do zaplanowania jako osobny, celowy wysiłek.
