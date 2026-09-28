# Faza 7: Poprawki po teście na telefonach i organizacja konkursu — Research

**Data researchu:** 2026-09-28
**Dziedzina:** WebKit na iOS (Wake Lock, haptyka przełącznika, media), Supabase/PostgREST (limit prób w SQL, Realtime Presence), React 18 bez bibliotek (DnD), własny zapis XLSX
**Pewność ogólna:** MEDIUM-HIGH. Kod i SQL sprawdzone w repo, źródła WebKit czytane bezpośrednio. Zachowanie na fizycznym iPhonie w Chrome jest niezweryfikowane (MEDIUM/LOW).

<user_constraints>
## Ograniczenia użytkownika (z 07-CONTEXT.md, dosłownie)

### Decyzje zablokowane

#### G8 — projektor po końcu testu (P7-PROJ-END)
- Sesja w statusie `results` albo `ended` → projektor pokazuje ekran „Koniec testu” (np. 🏁, „Koniec testu”, „Dziękujemy! Wyniki za chwilę.”), NIE „Oczekiwanie”. Pozostaje, dopóki admin nie wypchnie podium (broadcast `podium` — wtedy podium jak dziś).
- `waiting` (lobby) → bez zmian: „Oczekiwanie” + QR.
- Przyczyna w kodzie: `src/hooks/useLiveProjection.js` `tickPlan` — gdy `!v.item` (lobby / results / ended / legacy) zawsze `setPhase("waiting")`.

#### G9 — iPhone (P7-IOS-WAKE, P7-IOS-HAPTIC, P7-VT-SMOOTH)
- Testowane środowisko: **najnowszy iOS, Google Chrome** (WebKit pod spodem), nie tryb ikony na ekranie głównym. Rozwiązanie musi działać w Chrome i Safari na iOS.
- Wake lock: ekran nie może gasnąć w trakcie gry (lobby → koniec testu). Jeśli Screen Wake Lock API niedostępne albo odmówione → fallback (np. ukryte, wyciszone, zapętlone wideo inline, wzorzec NoSleep.js) uruchamiany przy geście użytkownika (np. przycisk wejścia/dołączenia). Bez zewnętrznych bibliotek UI; mała biblioteka lub własna implementacja — do decyzji po researchu (Claude's discretion), preferencja: własna, mała implementacja.
- Uwaga: wygaszenie ekranu = `visibilitychange` → naruszenie `tab_switch` w `useAntiCheat` — dlatego wake lock jest też sprawą uczciwości raportu naruszeń.
- Haptyka: `navigator.vibrate` nie działa na iOS. Na iOS 18+ użyć haptyki przełącznika `<input type="checkbox" switch>` (klik w powiązany `<label>` w trakcie gestu użytkownika) przy wyborze odpowiedzi. Na Androidzie zostaje `navigator.vibrate`.
- Płynność: obecnie po pierwszym przejściu View Transition > 150 ms VT wyłącza się do końca życia hooka (poprawka G7, `src/lib/viewTransition.js`). Dopuszczalne złagodzenie (np. ponowna próba po N stabilnych klatkach / wyłączenie tylko dla wolnych przejść), ALE bez pogorszenia startu pytania względem planu (sonda: devDom ≤ 1500 ms, cel < 400 ms). Priorytet niższy niż G8/G9.

#### Kody uczestników (P7-CODE-4, P7-CODE-DASH, P7-CODE-RATE)
- **Decyzja użytkownika: kody 4-cyfrowe z limitem prób.** Format `PREFIKS-NNNN`, np. `KRK-1111`.
- Prefiksy BEZ ZMIAN: `{ Kraków: "KRK", Warszawa: "WAR", Poznań: "POZ", Wrocław: "WRO", Katowice: "KAT" }` (użytkownik potwierdził: Warszawa = WAR).
- Import CSV: kolumny `Imię;Nazwisko;Kod` (separator `;` lub `,`; nagłówek pomijany jak dziś; BOM z Excela). Przykład `Jan;Kowalski;1111` w mieście Kraków → uczestnik Jan Kowalski, kod `KRK-1111`.
  - Kolumna Kod pusta → losowy wolny 4-cyfrowy numer w tym mieście.
  - Kod nie-4-cyfrowy (np. `111`, `12a4`), duplikat w pliku albo numer już zajęty w mieście → błąd tego wiersza pokazany w podglądzie przed importem; pozostałe wiersze importowalne.
  - Wiodące zera zachowane (`0042` → `KRK-0042`; w Excelu kolumnę trzeba sformatować jako tekst — dopisać to w opisie formatu i w przykładowym pliku).
  - Przykładowy plik do pobrania: `Imię;Nazwisko;Kod\nJan;Kowalski;1111\n...`.
- Ręczne dodanie w panelu (formularz imię+nazwisko) → opcjonalne pole Kod (4 cyfry); puste = losowy.
- Istniejące kody 6-cyfrowe pozostają ważne (migracje addytywne; walidacja przyjmuje oba formaty).
- Wpisywanie kodu (`src/screens/CodeEntry.jsx`): po wpisaniu 3 liter prefiksu myślnik dopisuje się automatycznie; wielkie litery jak dziś; backspace na myślniku działa naturalnie; wklejenie `KRK1111` albo `krk-1111` → `KRK-1111`.
- **Limit prób (serwer):** po 5 błędnych kodach (`not_found`) z jednego urządzenia kolejne próby odrzucane przez 60 s z czytelnym komunikatem „Za dużo prób — spróbuj za minutę”. Ograniczenie musi być w SQL (`claim_participant_code` / `validate_participant_code`), bo klient jest niezaufany. Research: czym identyfikować próbującego (device_id z klienta jest podrabialny; IP wspólne w sieci uczelni → limit per IP zablokowałby salę) — wybrać rozwiązanie odporne i nieblokujące sali; opisać ryzyko rezydualne.
- Przy 4 cyfrach pula 10 000 na miasto; przycisk 🔓 (releaseCode) istnieje i zostaje ścieżką ratunkową.

#### Naruszenia w raporcie (P7-VIOL-REPORT)
- XLSX (`src/lib/resultsXlsx.js`, bieżąca sesja i Historia): kolumna „Naruszenia” w arkuszu Ranking + w karcie uczestnika wiersze: łączna liczba naruszeń oraz rozbicie per typ (`tab_switch` = „Wyjście z aplikacji / wygaszenie ekranu”, `screenshot_attempt` = „Próba zrzutu ekranu”).
- Łączna liczba ma odpowiadać licznikowi na telefonie. Dziś zapis do bazy jest deduplikowany (max 1 wiersz/10 s/typ, `useAntiCheat.js`), a `getViolationsForSession` ma `limit(200)` → raport musi pobierać wszystkie wiersze sesji (stronicowanie) i brać sumę faktyczną. Claude's discretion: np. zapis licznika per typ w polu `count` + max(count) per uczestnik/typ, albo dosłanie brakujących zdarzeń po oknie deduplikacji — bez zwiększania obciążenia bazy przy 500 osobach.
- Uczestnik bez naruszeń → 0.

#### Średni czas (P7-AVG-2DP)
- 2 miejsca po przecinku WSZĘDZIE, gdzie pokazany jest średni czas: lista wyników w panelu (dziś `toFixed(1)`, `AdminPanel.jsx` ~1311), XLSX (dziś `secs()` zaokrągla do 0,1 s — Ranking i karta uczestnika; czasy pojedynczych odpowiedzi też na 2 miejsca), CSV (już 2), podium (już 2).
- **Brak reguły remisu** (decyzja użytkownika: przy 2 miejscach remis jest praktycznie niemożliwy). Ranking w SQL zostaje: poprawne DESC, avg_ms ASC.

#### Kolejność pytań (P7-Q-REORDER)
- Zakładka Pytania (`PytaniaTab`): zmiana kolejności w obrębie modułu przeciąganiem (HTML5 drag & drop na komputerze) oraz przyciskami ↑/↓ (telefon / dostępność). Zapis do `questions.sort_order`. Bez usuwania i ponownego dodawania.
- Plan quizu już sortuje po (module, sort_order, id) w JS (`plan.js`) i SQL (parzystość `verify-plan` 47/47) → po zmianie kolejności nowy start używa nowej kolejności. Trwająca sesja ma plan zamrożony — zmiany jej nie dotyczą (opisać w UI: „Zmiana kolejności działa od następnego startu”).
- Bez bibliotek (constraint projektu: brak zewnętrznych bibliotek UI).

#### Widok uczestników dla admina (P7-ADMIN-STUCK)
- W panelu sesji: lista uczestników z kodami miasta ze stanem: w poczekalni / online w grze / rozłączony (brak obecności Realtime) / nie odpowiedział na bieżące pytanie; przy każdym przycisk 🔓 (releaseCode, z potwierdzeniem) do przepięcia na inny telefon.
- Źródła danych do researchu: presence Realtime (Lobby już `ch.track`), answers bieżącego pytania, `participant_codes.device_id/used`. Nie zwiększać obciążenia ponad dzisiejsze poll 1 s / 3 s.

#### Zasady przekrojowe
- Migracje SQL wyłącznie addytywne, jako nowa sekcja w `SUPABASE_FIXES.sql` (następna: 44) z markerem dla `verify-prod`; ręczne wgranie przez użytkownika (checkpoint), jak sekcje 42/43.
- Testy: Vitest dla czystej logiki (parsowanie CSV kodów, formatowanie myślnika, agregacja naruszeń, format średniej, kolejność); sonda produkcyjna po zmianach w ścieżce gry (G8/G9/VT) — za zgodą użytkownika, z blokadą uśpienia komputera i kontrolą resztek przed serią.
- Wdrożenie frontu poza wydarzeniem (Service Worker autoUpdate), push na `main` → Vercel.
- Język UI: polski.

### Claude's Discretion
- Konkretny mechanizm limitu prób (tabela prób, klucz identyfikacji, okno) — po researchu.
- Implementacja fallbacku wake lock i haptyki (własna vs mała biblioteka).
- Sposób dokładnego zliczania naruszeń.
- Podział na plany i fale.

### Pomysły odłożone (POZA ZAKRESEM)
- Plan Supabase Pro + test obciążeniowy 500 jednoczesnych (operacyjne, przed wydarzeniem).
- Reguła remisu (ex aequo / dodatkowe kryterium) — świadomie odrzucona.
- Próba generalna z kilkoma osobami i projektorem na tydzień przed TWE.
</user_constraints>

<phase_requirements>
## Wymagania fazy

`REQUIREMENTS.md` nie zawiera identyfikatorów P7. Opisy pochodzą z kryteriów sukcesu fazy 7 w `ROADMAP.md` i z 07-CONTEXT.md.

| ID | Opis | Co z researchu to umożliwia |
|----|------|-----------------------------|
| P7-PROJ-END | Po końcu testu (`results`/`ended`) projektor pokazuje „Koniec testu” aż do wypchnięcia podium | §G8: nowa faza `ended` w `useLiveProjection` (czysta funkcja), pułapka z `getSessionForCity` (pomija `ended`) |
| P7-IOS-WAKE | Ekran iPhone’a (Chrome i Safari) nie gaśnie od lobby do końca testu | §Wake Lock: WebKit wymaga **gestu** (tymczasowej aktywacji). Dziś `useWakeLock` prosi o blokadę w `useEffect`, więc bez gestu. Fallback wideo NoSleep: mp4 z **ścieżką audio, bez `muted`, bez `loop`** |
| P7-IOS-HAPTIC | Wybór odpowiedzi daje tyknięcie haptyczne na iOS 18+ | §Haptyka: od iOS 26.5 `label.click()` z JS **nie działa**. Działa tylko prawdziwe dotknięcie w `<label>` powiązany z przełącznikiem. Trzeba przezroczystej nakładki `<label>` w kafelku |
| P7-VT-SMOOTH | Płynniejsze przejścia bez pogorszenia startu pytania | §VT: bez VT na granicy countdown→quiz (tam animacja CSS przy wejściu), dla pozostałych przejść ograniczone ponowne włączenie |
| P7-CODE-4 | Kody 4-cyfrowe z CSV `Imię;Nazwisko;Kod`, błędy wierszy w podglądzie, losowy wolny numer | §Kody: czysty parser `parseCodesCsv`, obsługa `="0042"`, zajętość z `getParticipantCodes(city)` + 23505 |
| P7-CODE-DASH | Automatyczny myślnik po 3 literach prefiksu | §Kody: czysta funkcja `formatCodeInput(raw, prev)` z rozpoznawaniem kasowania; atrybuty `autoCapitalize/autoCorrect` |
| P7-CODE-RATE | 5 błędnych prób z urządzenia → 60 s odrzucenia w SQL; inny telefon z poprawnym kodem działa | §Limit prób: tabela `code_attempts`, klucz urządzenia + klucz IP z wysokim progiem, zmiana `validate_participant_code` na VOLATILE, ryzyko rezydualne policzone |
| P7-VIOL-REPORT | Kolumna „Naruszenia” + rozbicie per typ w XLSX, zgodne z licznikiem telefonu | §Naruszenia: licznik trzymany w localStorage, dosłanie zaległego zapisu po oknie 10 s, kolumna `type_count`, agregujące RPC admina |
| P7-AVG-2DP | Średni czas z 2 miejscami w panelu, XLSX, CSV | §Średnia: `toFixed(2)`, `secs` → 0,01 s, **styles.xml z numFmtId=2** (inaczej Excel pokaże 12,3 zamiast 12,30) |
| P7-Q-REORDER | Kolejność pytań przeciąganiem / ↑↓, zapis `sort_order`, nowy start używa nowej kolejności | §Kolejność: HTML5 DnD + przyciski, jedno RPC `admin_reorder_questions(uuid[])` SECURITY INVOKER (RLS), gęsta numeracja 0..n-1 |
| P7-ADMIN-STUCK | Lista uczestników rozłączonych/utkniętych z 🔓 | §Widok admina: **bez presence w trakcie gry** (koszt O(N²) wobec limitów Realtime). Sygnał żywotności = wiersz w `answers` (także pusty zapis po czasie) + lobby presence + próby `taken` |
</phase_requirements>

## Streszczenie

Faza nie wymaga nowych zależności. Wszystko da się zrobić własnym, małym kodem w istniejącym stosie (React 18, inline styles, Supabase) plus jedną addytywną sekcją SQL 44. Najważniejsze odkrycia pochodzą z czytania źródeł WebKit, a nie z dokumentacji.

1. **Przyczyna G9b (gaśnie ekran) leży w naszym kodzie.** `WakeLock::request` w WebKit przy stanie uprawnienia „prompt” przyznaje blokadę tylko przy tymczasowej aktywacji, czyli w trakcie gestu (`hasTransientActivation`). Inaczej zwraca `NotAllowedError: Permission was denied`. `useWakeLock` woła `request()` w `useEffect` po zmianie fazy, czyli nigdy w geście, a błąd połyka. Na iOS blokada więc prawdopodobnie nigdy nie była przyznana, także w Safari. Poprawka: prośba synchronicznie w handlerze gestu (przycisk „Dołącz”, dotknięcie odpowiedzi, dotknięcie ekranu w lobby) plus nasłuch gestów na dokumencie, dopóki blokada nie jest trzymana.
2. **Fallback wideo działa tylko przy określonych warunkach.** WebKit (`HTMLMediaElement::shouldDisableSleep`) blokuje wygaszanie tylko dla odtwarzanego wideo **z dźwiękiem, niewyciszonego, z głośnością > 0 i BEZ atrybutu `loop`**. Pomysł z CONTEXT („wyciszone, zapętlone wideo”) na iOS **nie zadziała**. Działa wzorzec NoSleep.js: mp4 (3,7 KB, H.264 + AAC, sprawdzone), bez `muted`, zapętlenie przez `timeupdate` → `currentTime`, `play()` w geście.
3. **Haptyka: Apple załatał `label.click()` w iOS 26.5** (commit WebKit fc1ef83). Programowy klik w label daje niezaufany klik i brak haptyki. Działa tylko prawdziwe dotknięcie w `<label>`, który zawiera przełącznik. W kafelku odpowiedzi musi więc być przezroczysta nakładka `<label>` z ukrytym (`visibility:hidden`, nie `display:none`) `<input type="checkbox" switch>` oraz `stopPropagation` na kliknięciu przełącznika. Bez tego `onPick` odpali dwa razy.
4. **Limit prób tylko w `claim`/`validate` nie chroni przed skryptem.** Anon ma inne wyrocznie istnienia kodu bez limitu: `code_exists()` wywoływalne bezpośrednio, `get_participant_state` (zwraca `invalid code`), `submit_answer_v2`, polityka INSERT na `violations`. Przy 1% gęstości (100 ważnych z 10 000) skrypt wyliczy wszystkie kody miasta w minuty. Limit w SQL spełnia kryterium sukcesu i chroni ścieżkę UI. Ryzyko rezydualne trzeba opisać, a utwardzenie wyroczni zaplanować jako osobną sekcję po wdrożeniu frontu (jak sekcja 41).
5. **Presence w trakcie gry odradzam.** Każde `track`/wyjście jest rozsyłane do wszystkich w kanale (O(N²)). Supabase liczy zdarzenie jako wiadomość „doręczoną do klienta lub wysłaną przez niego”. Limit Pro to 500 wiadomości/s i 50 wiadomości presence/s. Przekroczenie = `tenant_events` i rozłączenie połączeń. Żywotność uczestnika da się ustalić za darmo: telefon, który żyje, zawsze zostawia wiersz w `answers` dla każdego pytania (odpowiedź albo pusty zapis po czasie).

**Główna rekomendacja:** jedna sekcja SQL 44 (tabela prób + limiter w claim/validate, zmiana `validate_participant_code` na VOLATILE, kolumna `violations.type_count` + agregat, `admin_reorder_questions`, sprzątanie przez pg_cron, marker 44, `NOTIFY pgrst`) oraz własne moduły JS z czystymi funkcjami pod Vitest. Każdą zmianę iOS weryfikuje ręczny test na iPhonie w Safari i w Chrome.

## Ograniczenia projektu (z CLAUDE.md)

- Stos: React 18 + Vite + vite-plugin-pwa + Supabase, bez zmian. **Żadnych zewnętrznych bibliotek UI.** Style inline (obiekty `style`), globalny CSS w `src/styles/global.css`.
- Konwencje: komponenty PascalCase `.jsx`, funkcje camelCase, handlery `handle*`, hooki `use*`, stałe UPPER_SNAKE_CASE; importy względne z rozszerzeniem `.js`/`.jsx`; podwójne cudzysłowy; 2 spacje; nazwane eksporty.
- Błędy: zwracanie `{ data, error }` / `{ error }` zamiast try/catch w warstwie danych; wczesne `return` przy walidacji; soft-fallback przy braku RPC (`PGRST202` / „Could not find the function”).
- Tryb DEMO (localStorage) musi dalej działać (każda nowa funkcja w `supabase.js` ma gałąź DEMO).
- Środowisko: Windows, Git Bash / PowerShell; ścieżki absolutne.
- Testy: Vitest (jest: 214 testów, `npm test`, środowisko jsdom).
- Workflow GSD: edycje repo wyłącznie przez polecenia GSD.
- Pamięć projektu: migracje wyłącznie addytywne (produkcja bez stagingu), sondy za zgodą, z kontrolą resztek `[SONDA]` i blokadą uśpienia komputera; komunikacja z użytkownikiem po polsku, kroki ręczne numerowane.

## Standardowy stos

### Rdzeń (bez zmian, zweryfikowane w repo)
| Biblioteka | Wersja | Cel | Uwagi |
|------------|--------|-----|-------|
| react / react-dom | 18.3.1 | UI | `flushSync` używane w VT |
| @supabase/supabase-js | 2.104.1 (zainstalowane; `^2.45.0` w package.json) | RPC, Realtime | realtime-js 2.104.1: kanał bez nasłuchu `presence` ma w konfiguracji `presence.enabled=false`, a `track()` włącza presence leniwie po stronie serwera |
| vitest | 2.1.9 | testy jednostkowe | jsdom 24; 214/214 zielone (sprawdzone 2026-09-28, 17 s) |
| @playwright/test | 1.60 | sonda produkcyjna | `scripts/probe-gameplay.js` |

### Własne małe moduły (rekomendacja zamiast bibliotek)
| Moduł (nowy) | Zamiast | Dlaczego własny |
|--------------|---------|-----------------|
| `src/lib/wakeLock.js` | NoSleep.js (MIT) | Potrzebny kontroler z uzbrajaniem gestem i stanem „trzymana/nie” dla UI. Z NoSleep bierzemy tylko **plik mp4 jako data URI (3753 B, MIT — zachować notkę licencyjną w komentarzu)** i technikę `timeupdate` |
| `src/lib/haptics.js` + nakładka w `Quiz.jsx` | `ios-haptics` 3.1.x (MIT) | To ~15 linii; biblioteka modyfikuje DOM spoza Reacta. Odtworzyć jej aktualny wzorzec (nakładka `<label>`) |
| `src/lib/codeFormat.js` | — | Czyste funkcje: `formatCodeInput`, `normalizeParticipantCode`, `parseCodesCsv`, `pickFreeNumbers` |
| `src/lib/violations.js` | — | `summarizeViolations(rows)` |
| `src/lib/roster.js` | — | `classifyParticipant(...)` dla widoku admina |
| `src/lib/reorder.js` | dnd-kit / react-beautiful-dnd | Zakaz bibliotek UI; potrzebne tylko `moveItem` + zapis |

**Instalacja:** brak nowych pakietów.

### Rozważone alternatywy
| Zamiast | Można | Kompromis |
|---------|-------|-----------|
| własny wakeLock | `nosleep.js` z npm | Nie obsługuje ponownego uzbrajania gestem ani stanu dla UI. Prosi o blokadę natywną, a przy odmowie rzuca wyjątek bez fallbacku wideo |
| nakładka `<label>` | `ios-haptics` | Zewnętrzna zależność, ale aktywnie łatana pod zmiany iOS (26.5, przewijanie). Jeśli iOS 27 znów coś zmieni, warto porównać z jej repo |
| agregat naruszeń w RPC | stronicowany select `violations` po stronie klienta | Działa bez SQL (fallback), ale przy nadużyciach tysiące wierszy |

## Wzorce architektury

### Zalecana struktura (nowe pliki)
```
src/lib/
├── wakeLock.js        # kontroler blokady ekranu (natywna + fallback mp4), uzbrajanie gestem
├── haptics.js         # HAS_SWITCH_HAPTICS, vibrateTap()
├── codeFormat.js      # formatCodeInput, normalizeParticipantCode, parseCodesCsv, pickFreeNumbers
├── violations.js      # summarizeViolations, VIOLATION_LABELS
├── roster.js          # classifyParticipant (stany widoku admina)
├── reorder.js         # moveItem, orderedIdsForModule
└── projector.js       # projectorPhase(v, status) — czysta decyzja ekranu projektora (G8)
+ testy *.test.js obok każdego
```

### Wzorzec 1 — G8: faza „ended” projektora (P7-PROJ-END)
**Co:** `projectPlanState` już zwraca `{phase:"results"}` / `{phase:"ended"}` / `{phase:"lobby"}` / `{phase:"legacy"}` bez `item`. `tickPlan` wrzuca to wszystko do `waiting`. Trzeba rozróżnić.

```js
// src/lib/projector.js — czyste, testowalne
export function projectorIdlePhase(v, status) {
  if (v?.phase === "results" || v?.phase === "ended") return "ended";
  if (status === "results" || status === "ended") return "ended";
  return "waiting"; // lobby, legacy, brak planu
}
```
- W `tickPlan`, gałąź `!v.item`: `setPhase(projectorIdlePhase(v, s.status))`.
- W `tick()`, gałąź „sesja bez planu / plan się pobiera”: też `projectorIdlePhase(null, s?.status)`. Projektor otwarty po końcu testu, gdy plan jeszcze się nie pobrał, ma pokazać koniec.
- `LiveView.jsx`: nowy blok `phase === "ended"` w stylu istniejących (🏁, Bebas Neue 48, `#F5C518`, podtytuł `#9B89CC` „Dziękujemy! Wyniki za chwilę.”). Podium ma już pierwszeństwo (`if (podium?.results?.length) return <PodiumScreen…/>`), więc „do wypchnięcia podium” działa samo.
- Nagłówek „LIVE · … odp.” pokazuje się tylko dla quiz/reveal, więc bez zmian.
- Warto dodać `data-fue-live-phase={phase}` na korzeniu LiveView, żeby sonda mogła to sprawdzić.

**Pułapka (ważna):** `getSessionForCity` ma `.neq("status","ended")`. Po `ended` poll co 5 s zwraca `null` (ignorowane, więc zostaje ostatni wiersz, OK) **albo inną niezakończoną sesję miasta**, np. starą sesję próbną w `waiting`. Wtedy projektor wróci do „Oczekiwanie”. Przy nowej sesji utworzonej przez admina („Nowy quiz”) to zachowanie jest pożądane. Planista powinien przyjąć je jako poprawne, a w UAT sprawdzić scenariusz z istniejącą sesją próbną.

### Wzorzec 2 — Wake Lock na iOS (P7-IOS-WAKE)
**Fakty z kodu WebKit (main, 2026):**
- `ScreenWakeLockAPIEnabled` ma domyślnie `WebKit: true`, więc dotyczy też WKWebView (Chrome na iOS). Blokadę realizuje proces UI przez `UIApplication _setIdleTimerDisabled`, czyli technicznie działa w każdej aplikacji na WKWebView. caniwebview.com podaje jednak „WKWebView: nie”. **Pewność, że działa w Chrome na iOS: MEDIUM-LOW, do sprawdzenia na telefonie.**
- `WakeLock::request`: przy stanie uprawnienia `prompt` blokada zostaje przyznana tylko, gdy `hasTransientActivation` **albo** `m_wasPreviouslyAuthorizedDueToTransientActivation` (flaga na obiekcie `navigator.wakeLock` w tym dokumencie). Po reloadzie flaga znika.
- Aktywację dają `pointerup`, `touchend`, `click` i `keydown`. **`pointerdown` z dotyku jej nie daje.**
- `visibilityState == hidden` powoduje zwolnienie blokady. Po powrocie ponowna prośba działa bez gestu tylko dzięki tej fladze. Nie wiadomo, od której wersji iOS flaga istnieje; zgłoszenie vueuse #3484 pokazuje `Permission was denied` przy ponownym uzyskaniu na iOS 16.5, w Safari i w Chrome.
- Wideo (`HTMLMediaElement::shouldDisableSleep`) blokuje wygaszanie ekranu tylko, gdy: czas płynie, **`!loop()`**, typ `VideoAudio` (ma wideo **i** może wydać dźwięk, czyli **niewyciszone**, głośność > 0, ma ścieżkę audio), dokument widoczny.

**Projekt `src/lib/wakeLock.js` (singleton):**
```js
// Źródło mp4: NoSleep.js (MIT, © Rich Tibbett) — H.264 + AAC (cisza), 3753 B.
const MP4 = "data:video/mp4;base64,…";
let wanted = false, sentinel = null, nativeFailed = false, video = null;
const listeners = new Set(); // subskrypcje stanu dla UI (Lobby: „dotknij, aby ekran nie gasł”)

function ensureVideo() {
  if (video) return video;
  video = document.createElement("video");
  video.setAttribute("playsinline", ""); video.setAttribute("title", "FUE");
  // NIE muted, NIE loop — inaczej WebKit nie blokuje wygaszania.
  const src = document.createElement("source"); src.src = MP4; src.type = "video/mp4"; video.appendChild(src);
  video.addEventListener("timeupdate", () => { if (video.currentTime > 0.5) video.currentTime = 0; });
  return video;
}

// Wołać SYNCHRONICZNIE w handlerze gestu (click/touchend/pointerup/keydown) — przed każdym await.
export function armWakeLockFromGesture() {
  if (!wanted) return;
  if ("wakeLock" in navigator && !nativeFailed) {
    if (!sentinel) navigator.wakeLock.request("screen").then(onLock, () => { nativeFailed = true; notify(); });
  } else {
    try { ensureVideo().play()?.catch?.(() => {}); } catch (_) {}
  }
}
```
- `useWakeLock(active)`: ustawia `wanted`. Przy `active` próbuje od razu (Android/desktop przyznają bez gestu, iOS po wcześniejszej autoryzacji w tym dokumencie). Póki `!held`, rejestruje na `document` **w fazie przechwytywania** nasłuch `click`, `touchend`, `keydown`, który woła `armWakeLockFromGesture()`. Na `visibilitychange → visible` próbuje ponownie (natywnie; wideo zostanie wstrzymane przez system, więc `play()` przy kolejnym geście). Przy `!active` zwalnia sentinel i pauzuje wideo.
- Wywołanie w geście: `CodeEntry.submit` jako **pierwsza linia** (przed `await validateParticipantCode`). Dotknięcie odpowiedzi w `Quiz` obsłuży globalny nasłuch.
- Ścieżka po odświeżeniu (App od razu przechodzi do `game`) nie ma gestu. **W Lobby pokazać mały pasek „Dotknij ekranu, aby nie gasł”, gdy `!held`**. Lobby trwa 20–30 min bez dotyku, więc tam blokada jest najbardziej potrzebna.
- `App.jsx:58`: lista faz zostaje, dodać `"results"` i `"ended"`, jeśli ekran końca ma nie gasnąć (decyzja: „lobby → koniec testu”). Mechanizm zwalnia blokadę na ekranie powitalnym i przy wyjściu do `code_entry`.
- Koszt wideo: dekodowanie 1 s pliku 3,7 KB w pętli jest pomijalne. **Efekt uboczny:** niewyciszone media przejmują sesję audio iOS (pauzują muzykę w tle, mogą pojawić się w „Teraz odtwarzane”). Dlatego wideo tylko jako fallback, gdy natywna blokada zawiedzie.
- **Tryb niskiego zużycia energii (Low Power Mode):** doniesienia (LOW, jedno źródło), że iOS w tym trybie i tak wygasza. Operacyjnie: slajd na projektorze „Wyłącz tryb oszczędzania energii, nie blokuj telefonu”.

### Wzorzec 3 — Haptyka (P7-IOS-HAPTIC)
**Fakty (WebKit `CheckboxInputType.cpp` + historia ios-haptics):**
- Haptyka odpala w `performSwitchVisuallyOnAnimation` przy **zaufanym** kliknięciu przełącznika (każde przełączenie, w obie strony) i `UserGestureIndicator::processingUserGesture()`. Wymaga też **renderera**: `display:none` wyłącza, `visibility:hidden` nie. Przełącznik nie może być `disabled`.
- iOS 26.5 (WebKit fc1ef83): kliknięcie przekazane przez label jest zaufane tylko, gdy kliknięcie w label było zaufane. **`label.click()` z JS przestał działać.** Prawdziwe dotknięcie w `<label>` nadal daje haptykę; przetestowano w WebKit 26.6 (Playwright), nie na fizycznym iPhonie.
- Wykrywanie: `"switch" in HTMLInputElement.prototype` (IDL `[EnabledBySetting=SwitchControlEnabled] attribute boolean switch`, domyślnie włączone na platformach Cocoa).

**Wzorzec dla kafelka odpowiedzi (`Quiz.jsx`):**
```jsx
// src/lib/haptics.js
export const HAS_SWITCH_HAPTICS = typeof HTMLInputElement !== "undefined" && "switch" in HTMLInputElement.prototype;
export function vibrateTap() { try { navigator.vibrate?.(15); } catch (_) {} } // Android

// w <button className="ans-btn" … style={{ position: "relative", … }}>
{HAS_SWITCH_HAPTICS && !answered && picked === null && (
  <label aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 1, WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}>
    <input type="checkbox"
      ref={(el) => { if (el && !el.hasAttribute("switch")) el.setAttribute("switch", ""); }}
      onClick={(e) => e.stopPropagation()}   // kopia kliknięcia z labela NIE może dojść do onClick buttona (podwójny onPick)
      style={{ position: "absolute", width: 1, height: 1, margin: 0, visibility: "hidden" }} />
  </label>
)}
```
- Atrybut `switch` ustawiać przez `ref` + `setAttribute`. React 18 nie wyrenderuje nieznanego atrybutu z wartością `true` (ostrzeżenie), a `switch` jako nazwa atrybutu JSX jest nieczytelne.
- Nakładka tylko, gdy wybór jest jeszcze możliwy. Inaczej tyknięcie przy dotknięciu zablokowanego kafelka mylnie sugerowałoby wybór.
- `onClick` buttona zostaje bez zmian (dotknięcie w label bubbluje do buttona raz). W środku `vibrateTap()` dla Androida.
- Label wewnątrz `<button>` formalnie narusza model treści HTML, ale tak działa `ios-haptics` na buttonach. Alternatywa: zamienić kafelek na `<div role="button">`. Nie jest wymagana.
- **Chrome na iOS:** haptyka idzie przez `ChromeClient::performSwitchHapticFeedback` → proces UI WebKit, więc powinna działać w WKWebView. **Pewność MEDIUM-LOW, test ręczny obowiązkowy.** Ustawienie systemowe „Dźwięki i haptyka → Haptyka systemowa” wyłączone = brak tyknięcia (poprawne zachowanie).
- **iOS 27** (wydany prawdopodobnie we wrześniu 2026) — brak danych, może znów coś zmienić. UAT na „najnowszym iOS” to rozstrzygnie.

### Wzorzec 4 — View Transitions (P7-VT-SMOOTH, priorytet niski)
- **Nigdy VT na granicy startu pytania** (`countdown`/`intro` → `quiz`). To jedyny moment mierzony przez sondę (devDom). Zamiast VT: animacja CSS przy wejściu (istniejące keyframes `fi`/`su`, 150–200 ms, `opacity`/`transform`) na kontenerze z `key={item.id}`. Animacja CSS nie opóźnia zmiany DOM, więc nie ma problemu zamrożonego przechwycenia z G7.
- Pozostałe przejścia strukturalne (quiz→reveal, reveal→countdown, pauza, przerwa, koniec) mogą dalej używać VT z dotychczasowym zabezpieczeniem (przerwa rAF > 100 ms → bez VT; callback > 150 ms → „slow”).
- Złagodzenie „slow na zawsze”: licznik porażek (`strikes`). Ponowne włączenie po ≥ 120 kolejnych klatkach z przerwą < 34 ms, najwyżej 2 porażki, potem wyłączone do końca życia hooka. Czysta funkcja w `viewTransition.js` (`nextVtState({strikes, stableFrames, lastGapMs})`), testowana Vitestem.
- Sprawdzenie: seria 5 sond podstawowych (`PROBE_TRACE=1`), devDom ≤ 1500 (cel < 400) i porównanie z serią 3 (43–304 ms).

### Wzorzec 5 — Kody 4-cyfrowe i myślnik (P7-CODE-4, P7-CODE-DASH)
```js
// src/lib/codeFormat.js
export function formatCodeInput(raw, prev = "") {
  const up = String(raw ?? "").toUpperCase();
  const clean = up.replace(/[^A-Z0-9]/g, "");
  const [, letters, rest] = clean.match(/^([A-Z]{0,3})(.*)$/);
  const digits = rest.replace(/\D/g, "").slice(0, 6);        // 4 (nowe) albo 6 (stare)
  if (letters.length < 3) return letters;
  const deleting = up.length < String(prev ?? "").length;    // backspace na „KRK-” → „KRK”
  if (!digits) return deleting ? letters : `${letters}-`;
  return `${letters}-${digits}`;
}
export const CODE_RE = /^[A-Z]{3}-(\d{4}|\d{6})$/;
export function normalizeParticipantCode(raw) { const f = formatCodeInput(raw); return CODE_RE.test(f) ? f : null; }
```
- W `CodeEntry`: `onChange={(e) => setCode((p) => formatCodeInput(e.target.value, p))}`, `autoCapitalize="characters"`, `autoCorrect="off"`, `autoComplete="off"`, `spellCheck={false}`, placeholder `KRK-1234`, przykład „KRK-1111”. Kursor przy edycji w środku skacze na koniec, co przy 8 znakach jest akceptowalne. Zmiana `inputMode` w trakcie fokusa na iOS nie przełącza klawiatury (LOW), więc nie opierać na tym UX.
- Walidacja klienta przed RPC (`normalizeParticipantCode`) → brak zbędnej próby liczonej przez limiter przy literówce w formacie (np. 3 cyfry).

**Parser CSV (`parseCodesCsv(text, { prefix, takenNumbers })`):**
- Usunąć BOM `﻿`, podzielić linie `\r?\n`, separator `;` albo `,` (jak dziś), pominąć nagłówek (pierwsza komórka `imię`/`imie`), obciąć cudzysłowy.
- Komórka Kod: obsłużyć postać **`="0042"`** (trik Excela na tekst) oraz `KRK-0042` / `KRK0042`. Prefiks musi zgadzać się z miastem, inaczej błąd „kod innego miasta”. Po normalizacji wymagane `^\d{4}$`.
- Błąd wiersza: brak imienia/nazwiska; kod nie-4-cyfrowy (komunikat z podpowiedzią „jeśli w Excelu zniknęły zera wiodące, sformatuj kolumnę jako Tekst”); duplikat w pliku (oba wystąpienia); numer zajęty w mieście (z `getParticipantCodes(city)`: numery = część po `PREFIX-`, tylko 4-cyfrowe).
- Puste pole → `pickFreeNumbers(n, taken ∪ numery z pliku, rng)`: losowanie bez powtórzeń z wolnej puli 0000–9999 (`crypto.getRandomValues`), `padStart(4,"0")`.
- Import: `generateParticipantCode({ name, surname, city, createdBy, number })`. Nowy parametr `number`; brak = losowy 4-cyfrowy z retry na 23505. Przy 23505 dla numeru z pliku (wyścig z innym adminem) → błąd wiersza w podsumowaniu, bez ponowienia.
- Przykładowy plik: `Imię;Nazwisko;Kod\nJan;Kowalski;1111\nAnna;Nowak;0042\nPiotr;Wiśniewski;\n` + opis „kolumna Kod jako Tekst w Excelu; puste = losowy”.
- `randomCodeBody(6)` → `randomCodeBody(4)` dla nowych kodów. Stare 6-cyfrowe zostają ważne (SQL porównuje dokładny tekst, zmiana w SQL niepotrzebna).
- Podgląd: dziś pokazuje max 5 wierszy. Błędy trzeba pokazać **wszystkie** (lista błędnych wierszy z numerem linii), a poprawne podsumować liczbą.

### Wzorzec 6 — Limit prób w SQL (P7-CODE-RATE)
**Identyfikacja (ocena opcji):**
| Klucz | Obejście | Ryzyko dla sali | Werdykt |
|-------|----------|-----------------|---------|
| `p_device` (localStorage) | trywialne: tryb prywatny, czyszczenie danych, skrypt | brak | **TAK**, spełnia SC5 („z jednego telefonu”) i chroni ścieżkę UI |
| IP z nagłówka, niski próg | zmiana sieci (LTE/tryb samolotowy) | **blokada całej sali za NAT** | NIE |
| IP, **wysoki próg** (np. 100 błędów / 10 min) | zmiana IP | uczciwa sala (≈100 osób, kilka literówek) nie dojdzie do progu; złośliwy uczestnik może celowo zablokować nowych wchodzących | **TAK, jako druga warstwa**, z wyjątkiem dla urządzeń z już przypiętym kodem |
| globalny budżet miasta | — | blokada wszystkich | NIE jako blokada; **TAK jako alarm** w panelu (opcjonalnie) |
| wykładnicze opóźnienie `pg_sleep` | — | trzyma połączenia puli PostgREST → DoS | NIE |

**Nagłówek IP (do weryfikacji na prod, LOW):** Cloudflare **dopisuje** do istniejącego `X-Forwarded-For`, więc pierwsza pozycja (jak w przykładzie z dokumentacji Supabase: `split_part(xff, ',', 1)`) jest **podrabialna przez klienta**. `CF-Connecting-IP` ustawia Cloudflare. Nie wiadomo, czy dociera do `request.headers` w PostgREST na Supabase. Zalecenie: `COALESCE(h->>'cf-connecting-ip', h->>'x-real-ip', split_part(h->>'x-forwarded-for', ',', 1))`, a **przed poleganiem na nim** krok weryfikacji. Tymczasowa funkcja-echo (zwraca tylko wybrane IP, nie wszystkie nagłówki) wywołana curl-em z podrobionymi `X-Forwarded-For: 1.1.1.1` i `CF-Connecting-IP: 2.2.2.2`. Jeśli wynik to 1.1.1.1 albo 2.2.2.2, nagłówek jest podrabialny i klucz IP należy wyłączyć (zostaje tylko klucz urządzenia). Funkcję-echo usunąć po teście.

**Szkic sekcji 44 (addytywnie, te same sygnatury):**
```sql
-- 44.1 — próby kodów (tylko porażki; definer-only)
CREATE TABLE IF NOT EXISTS public.code_attempts (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  device TEXT, ip TEXT, code TEXT, reason TEXT NOT NULL   -- 'not_found' | 'taken'
);
CREATE INDEX IF NOT EXISTS idx_code_attempts_device ON public.code_attempts (device, at DESC);
CREATE INDEX IF NOT EXISTS idx_code_attempts_ip     ON public.code_attempts (ip, at DESC);
CREATE INDEX IF NOT EXISTS idx_code_attempts_taken  ON public.code_attempts (code, at DESC) WHERE reason = 'taken';
ALTER TABLE public.code_attempts ENABLE ROW LEVEL SECURITY;          -- brak polityk = brak dostępu
REVOKE ALL ON public.code_attempts FROM PUBLIC, anon, authenticated;

-- 44.2 — IP żądania (NULL poza PostgREST / przy śmieciach w nagłówku)
CREATE OR REPLACE FUNCTION public.request_ip() RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE h JSON;
BEGIN
  BEGIN h := current_setting('request.headers', true)::json; EXCEPTION WHEN others THEN RETURN NULL; END;
  RETURN NULLIF(btrim(COALESCE(h->>'cf-connecting-ip', h->>'x-real-ip',
                               split_part(h->>'x-forwarded-for', ',', 1))), '');
END $$;

-- 44.3 — czy zablokowany? zwraca sekundy do odblokowania albo NULL
--   urządzenie: ≥ 5 porażek 'not_found' w 60 s → blokada do (ostatnia porażka + 60 s)
--   IP: ≥ 100 porażek w 10 min → blokada do (ostatnia + 60 s), NIE dla urządzeń z przypiętym kodem
--       (EXISTS participant_codes WHERE device_id = p_device)
-- 44.4 — zapis porażki (odrzucone „rate_limited” NIE są zapisywane → blokada wygasa 60 s po ostatniej porażce)
-- 44.5 — claim_participant_code(p_code, p_device): najpierw guard → {ok:false, reason:'rate_limited', retry_after_s};
--        not_found → zapis porażki; taken → zapis (reason 'taken', code) dla widoku admina; sukces jak dziś.
-- 44.6 — validate_participant_code(p_code): ta sama RETURNS TABLE, ale LANGUAGE plpgsql VOLATILE,
--        guard po IP (brak device) + zapis porażki; przy blokadzie pusty wynik.
-- 44.x — pg_cron: 'fue-code-attempts-cleanup' co 10 min: DELETE … WHERE at < now() - interval '1 hour'
-- 44.z — schema_marker_44() + NOTIFY pgrst, 'reload schema';
```
- **`validate_participant_code` jest dziś `LANGUAGE sql STABLE`.** PostgREST wykonuje funkcje STABLE/IMMUTABLE wywołane POST-em w transakcji **READ ONLY**, więc INSERT porażki by się wysypał. `CREATE OR REPLACE` może zmienić język i zmienność przy identycznych argumentach i `RETURNS TABLE`. Po tym **odświeżyć cache schematu** (`NOTIFY pgrst, 'reload schema';`).
- Bez limitu `validate_participant_code` byłby obejściem limitu w `claim` (anon ma EXECUTE i dostaje imię i nazwisko).
- Klient (`validateParticipantCode`): `reason === "rate_limited"` → „Za dużo prób — spróbuj za minutę” (opcjonalnie odliczanie `retry_after_s`). Stary bundel dostanie „Nie znaleziono kodu.”, co jest akceptowalną degradacją (SC10).
- Helpery (`request_ip`, guard, zapis porażki): `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`. Są wołane z funkcji SECURITY DEFINER jako właściciel.
- Koszt: sukces = 2 zapytania po indeksie (≈ 500 razy na całe wydarzenie), porażka = +1 INSERT. Obciążenie pomijalne.

**Ryzyko rezydualne (policzone; gęstość = ~100 ważnych / 10 000 = 1% na miasto):**
| Atakujący | Przepustowość prób | Oczekiwane trafienia |
|-----------|--------------------|----------------------|
| ręcznie w UI, jedno urządzenie | 5 prób / ~70 s ≈ 250/h | ≈ 2–3/h |
| ręcznie, zmienia urządzenie (tryb prywatny) w sieci sali | ≤ 100 prób na start, potem ~1/min (limit IP) ≈ 160 w 1. godzinie | ≈ 1,6/h |
| skrypt, zmiana IP (LTE / tryb samolotowy) | ograniczona cierpliwością | kilka–kilkanaście/h |
| **skrypt przez inne wyrocznie** (`code_exists` RPC, `get_participant_state` → `invalid code`, `submit_answer_v2`, INSERT do `violations`) | bez limitu (dziesiątki/s) | **wszystkie kody miasta w kilka minut** |
Dla porównania stare 6 cyfr dawały gęstość 0,01%, czyli 100× mniej trafień przy każdej przepustowości.

Skutek trafienia: `claim` wiąże kod z urządzeniem atakującego, a prawowity uczestnik widzi „kod używany na innym urządzeniu”. Admin widzi to w widoku uczestników (próby `taken`) i zwalnia 🔓. Atakujący może też odpowiadać za ofiarę przez API (`submit_answer_v2` nie sprawdza urządzenia), co jest istniejącą luką.

**Rekomendowane utwardzenie (osobna sekcja 45, PO wdrożeniu frontu, jak sekcja 41; do decyzji użytkownika):**
1. Zapis naruszeń przez nowe RPC definer `record_violation(...)` zamiast bezpośredniego INSERT. Potem `REVOKE EXECUTE ON code_exists FROM anon` i usunięcie polityki anon INSERT na `violations` (stary bundel traci zapis naruszeń, degradacja kosmetyczna, `try/catch` już jest).
2. `get_participant_state`: w gałęzi `invalid code` zapis porażki (bez blokowania poprawnych kodów, bo to zabiłoby grę sali). Wymaga skopiowania całego ciała 42.7, podobnie jak 42.7 kopiował 39.6b.
3. Opcja mocniejsza: nowe przeciążenie `get_participant_state(..., p_device)` i `submit_answer_v2(..., p_device)` z porównaniem `device_id`, a stare przeciążenia odebrane anonowi w sekcji 45. To zamyka wyrocznie i przejęcie odpowiedzi, ale wymaga zmian w hooku gry i serii sond.

### Wzorzec 7 — Naruszenia (P7-VIOL-REPORT)
**Stan dziś (błędy liczenia):**
- `useAntiCheat` żyje w `Quiz.jsx`, który jest montowany tylko w fazach quiz/reveal. Intro, countdown, pauza i przerwa go odmontowują, a `countRef` wraca do 0. Refresh też zeruje. Licznik „na telefonie” resetuje się więc co moduł.
- `count` w wierszu = globalny licznik (wszystkie typy). Rozbicia per typ nie da się odtworzyć.
- Deduplikacja 10 s gubi zdarzenia z końca okna (3 wyjścia w 5 s → do bazy trafia tylko pierwsze).
- `getViolationsForSession` ma `limit(200)`.

**Rekomendacja (bez wzrostu zapisów):**
1. Licznik per `(sessionId, code)` w localStorage: `{ total, tab_switch, screenshot_attempt }`. Wczytywany przy montażu i zapisywany przy każdym zdarzeniu. Licznik na ekranie („Łączna liczba naruszeń”) = `total`, ciągły przez moduły i refresh.
2. Zapis do bazy: nadal ≤ 1 wiersz / 10 s / typ, ale z **dosłaniem zaległego zapisu**. Zdarzenie w oknie deduplikacji planuje jeden timer na koniec okna, który wysyła **aktualne** liczniki. Przy odmontowaniu zaległy zapis wysyłany od razu. Ostatni wiersz zawsze niesie końcowy stan.
3. Wiersz: `count` = `total` (semantyka bez zmian, stary panel działa) + nowa kolumna **`type_count INT NULL`** (sekcja 44, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`; anon ma INSERT na poziomie tabeli, więc nowa kolumna działa bez nowych grantów).
4. Agregat: RPC admina `get_session_violation_summary(p_session_id)` → `participant_code, total = MAX(count), tab_switch = MAX(type_count) FILTER (type='tab_switch'), screenshot = MAX(type_count) FILTER (type='screenshot_attempt'), rows_tab, rows_shot` (liczby wierszy jako zapas dla starych wierszy bez `type_count`). Soft-fallback: stronicowany `select` (`.range()`, strony po 1000) i ta sama agregacja w JS (`summarizeViolations`).
5. XLSX: `buildResultsSheets({ results, rows, city, violations })`. Ranking dostaje kolumnę „Naruszenia” (0 dla braku). Karta uczestnika dostaje wiersze „Naruszenia łącznie”, „Wyjście z aplikacji / wygaszenie ekranu”, „Próba zrzutu ekranu”. Oba miejsca (SesjaTab i HistoriaTab) pobierają podsumowanie przed eksportem.
- Uwaga: iOS wstrzymuje JS po wyjściu z aplikacji, więc INSERT z handlera `visibilitychange` dojdzie po powrocie. Dosłanie po oknie to pokrywa.
- Otwarte: czy anty-cheat ma działać także w intro/countdown/przerwie (dziś nie). Poza zakresem, do zanotowania.

### Wzorzec 8 — Średni czas 2 miejsca (P7-AVG-2DP)
- `AdminPanel.jsx:1311` `toFixed(1)` → `toFixed(2)`. CSV (878, 1677) i Podium już mają 2.
- `resultsXlsx.js`: `secs = (ms) => ms == null ? "" : Math.round(ms / 10) / 100`. Test `secs(12345)` → `12.35` (zaktualizować istniejący test, dziś oczekuje 12.3).
- **Excel wyświetla liczbę w formacie Ogólnym, więc 12.3 pokaże jako „12,3”.** Żeby było „12,30”, `xlsx.js` musi zapisać `xl/styles.xml` z `cellXfs` [0: ogólny, 1: `numFmtId="2"` (wbudowany „0.00”, ECMA-376) `applyNumberFormat="1"`], override w `[Content_Types].xml` (`application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml`) oraz relację `…/relationships/styles` w `workbook.xml.rels`. Komórki czasu zapisywać jako obiekt `{ v: 12.35, fmt: "0.00" }` → `<c r="…" s="1"><v>12.35</v></c>`.
- `xlsx.test.js` sprawdza liczbę wpisów ZIP (`toBe(7)`), więc po dodaniu styles.xml trzeba zmienić na 8.

### Wzorzec 9 — Kolejność pytań (P7-Q-REORDER)
- Lista modułu (`filtered`) jest już w kolejności planu (RPC `get_quiz_questions` ORDER BY module, sort_order, id).
- Desktop: `draggable` na karcie; `onDragStart` → `e.dataTransfer.setData("text/plain", id)` (**Firefox bez tego nie zaczyna przeciągania**) + `effectAllowed="move"`, id w `useRef`; `onDragOver` → `e.preventDefault()` (bez tego `drop` nie odpali) + wskaźnik miejsca (obrys); `onDrop` → `moveItem`, optymistyczny `setQuestions`, zapis. Telefon: HTML5 DnD na iOS jest zawodne, więc przyciski ↑/↓ (pierwszy bez ↑, ostatni bez ↓), `aria-label` „Przesuń wyżej/niżej”.
- Zapis: **jedno RPC** (sekcja 44), atomowe, z gęstą numeracją modułu (0..n-1 usuwa remisy `sort_order`, które dziś powstają po usunięciu i dodaniu pytania):
```sql
CREATE OR REPLACE FUNCTION public.admin_reorder_questions(p_ids UUID[])
RETURNS INT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE n INT;
BEGIN
  UPDATE public.questions q SET sort_order = t.ord - 1
    FROM unnest(p_ids) WITH ORDINALITY AS t(id, ord) WHERE q.id = t.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> COALESCE(array_length(p_ids, 1), 0) THEN RAISE EXCEPTION 'forbidden or missing question'; END IF; -- RLS odfiltrował → rollback
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_reorder_questions(UUID[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_reorder_questions(UUID[]) TO authenticated;
```
  SECURITY INVOKER sprawia, że RLS robi całą autoryzację (`questions_city_admin_write`: city_admin tylko swoje miasto; `questions_superadmin`). Fallback przy PGRST202: N równoległych `updateQuestion(id, { sort_order })` (RLS pozwala). DEMO: przepisać `sort_order` w localStorage. `demoQuestionsSorted` już sortuje, ale admin w DEMO dostaje listę nieposortowaną, więc przy zmianie posortować.
- Parzystość: `plan.js` nie sortuje sam (dostaje posortowane), SQL `build_session_plan` sortuje (module, sort_order, id). Gęsta numeracja eliminuje zależność od porównania id (JS `localeCompare` vs UUID w PG). `verify-plan` bez zmian.
- **Pułapka przy trwającej sesji:** panel ma odczyty po indeksie puli zamiast planu (`cityQuestions[s.current_question_idx]` w pollu 3 s i w obsłudze INSERT `answers`; LiveView liczy „Pytanie X/N” z `questions.findIndex` po puli pobranej przy montażu). Zmiana kolejności w trakcie sesji przestawi licznik odpowiedzi w panelu i numer pytania na projektorze po jego odświeżeniu. Zalecenie: **blokować przeciąganie dla puli głównej, gdy sesja miasta jest `running`/`paused`** (komunikat „Zmiana kolejności działa od następnego startu — zablokowana w trakcie quizu”). Tanie utwardzenie: LiveView „Pytanie X/N” z `v.idx + 1` / długości planu.

### Wzorzec 10 — Widok uczestników (P7-ADMIN-STUCK)
**Dlaczego nie presence w grze:**
- Limity Realtime (dokumentacja Supabase): Free 200 połączeń / 100 msg/s / 20 presence msg/s; **Pro 500 / 500 / 50**; Pro bez limitu wydatków 10 000 / 2 500 / 1 000. Na klienta: 5 wywołań presence / 30 s. „Zdarzenie” = wiadomość doręczona klientowi lub przez niego wysłana (liczona fan-out). Przekroczenie msg/s = `tenant_events` i **rozłączenie połączeń**.
- 100 telefonów w kanale presence miasta: fala reconnectu (zanik Wi-Fi) daje ~100 × 100 = 10 000 doręczeń w kilka sekund, czyli 20× limit Pro na sekundę dla jednego miasta. Presence w grze naraziłoby jedyny kanał sterujący rozgrywką.
- **Dotyczy też dzisiejszego lobby.** Przy starcie quizu wszyscy odmontowują Lobby naraz, więc lawina `leave` ≈ N²/2 ≈ 5 000 doręczeń na 100-osobowe miasto, w tej samej sekundzie co UPDATE startu (patrz Otwarte pytania).

**Sygnały (bez nowego obciążenia):**
| Stan | Źródło | Koszt |
|------|--------|-------|
| w poczekalni (online) | istniejąca lista presence admina (`presence-lobby-${city}`, tylko w `waiting`) | 0 (już jest) |
| dołączył (kod użyty w sesji) | `getParticipantsInSession` (poll 3–4 s, już jest) | 0 |
| urządzenie przypięte | `participant_codes.device_id` (ten sam select `*`) | 0 |
| online w grze / utknął | wiersz w `answers` dla **poprzedniego** pytania. Żywy telefon zawsze go zostawia (odpowiedź albo pusty zapis 0–1 s po `closes`). Pobranie `get_admin_question_stats(sid, prevQid)` **raz na pytanie**, ≥ 3 s po `closes_at + 1,5 s`; wynik po reveal się nie zmienia, więc cache po `question_id` | +1 RPC / pytanie |
| nie odpowiedział na bieżące | to samo dla bieżącego pytania w fazie reveal (po bramce) | +1 RPC / pytanie |
| próbuje wejść z innego telefonu | `code_attempts` z `reason='taken'` z ostatnich 5 min (RPC admina `admin_recent_code_conflicts(p_city)` w sekcji 44, wołany w istniejącym pollu co 3 s albo rzadziej) | 1 lekkie zapytanie po indeksie częściowym |

- Klasyfikacja w czystej funkcji `classifyParticipant({ status, inLobbyPresence, deviceBound, answeredPrev, answeredCur, phase, conflictAt, now })` → `lobby | online | answered | no_answer | disconnected | conflict`. Testy Vitest na tablicy przypadków.
- UI: w SesjaTab zamiast siatki „Uczestnicy (N)” (dziś tylko nazwiska) lista z kropką stanu, filtrem „tylko problemy” i 🔓 (`confirm` jak w KodyTab, potem `releaseCode(id)` i reload).
- Opcjonalne rozszerzenie (odradzane na teraz): `last_seen_at` w `participant_codes` aktualizowane w `get_participant_state` z throttlingiem ≥ 20 s. Daje ~25 UPDATE/s przy 500 osobach na gorącej ścieżce.

### Antywzorce
- **`wakeLock.request()` w `useEffect` lub po `await`** — na iOS bez gestu = odmowa.
- **`muted` + `loop` na wideo NoSleep** — WebKit wtedy NIE blokuje wygaszania.
- **`label.click()` z JS dla haptyki** — martwe od iOS 26.5.
- **`display:none` na przełączniku** — brak renderera = brak haptyki.
- **Brak `stopPropagation` na przełączniku** — podwójny `onPick`.
- **Presence w trakcie gry** — fan-out O(N²) wobec limitów Realtime.
- **Liczenie porażek dla odrzuceń `rate_limited`** — tabela rośnie pod atakiem, a blokada się nie kończy.
- **Blokowanie poprawnych kodów w `get_participant_state` przy blokadzie IP** — zatrzymałoby grę całej sali.

## Czego nie budować od zera

| Problem | Nie budować | Użyć | Dlaczego |
|---------|-------------|------|----------|
| Wideo podtrzymujące ekran | własne kodowanie mp4 / ffmpeg | mp4 data URI z NoSleep.js (MIT, 3753 B, H.264+AAC sprawdzone) | Musi mieć ścieżkę audio. ffmpeg nie jest zainstalowany |
| Format liczby w Excelu | zapis tekstu „12,30” | wbudowany `numFmtId=2` w styles.xml | Tekst psuje sortowanie i sumy w Excelu |
| Autoryzacja zmiany kolejności | ręczne sprawdzanie roli/miasta w RPC | `SECURITY INVOKER` + istniejące RLS `questions_*` | Jedno źródło prawdy o uprawnieniach |
| Sprzątanie prób | trigger / cleanup w każdym wywołaniu | pg_cron (sekcja 40 już go ma) | Zero kosztu na gorącej ścieżce |
| Losowanie wolnych numerów | pętla retry na 23505 | losowanie z wolnej puli po stronie klienta + 23505 jako błąd wiersza | Deterministyczny podgląd przed importem |

## Stan produkcyjny do uwzględnienia (migracja)

| Kategoria | Co jest | Działanie |
|-----------|---------|-----------|
| Dane | istniejące kody `XXX-NNNNNN` w `participant_codes` | bez zmian; walidacja przyjmuje 4 i 6 cyfr; zajętość 4-cyfrowych liczona tylko z kodów 4-cyfrowych |
| Dane | `violations` bez `type_count` | kolumna nullable; agregat ma zapas (liczba wierszy per typ) |
| Dane | `questions.sort_order` z remisami | RPC renumeruje moduł przy pierwszej zmianie kolejności; bez migracji danych |
| Konfiguracja usługi | pg_cron: `fue-advance-due`, `fue-cron-cleanup` | dodać `fue-code-attempts-cleanup` (unschedule+schedule, powtarzalny blok) |
| Cache PostgREST | zmiana zmienności `validate_participant_code` | `NOTIFY pgrst, 'reload schema';` na końcu sekcji |
| Service Worker | stare bundle na telefonach do czasu autoUpdate | nowe RPC z soft-fallbackiem; `reason:'rate_limited'` w starym bundlu = „Nie znaleziono kodu” |
| verify-prod | markery 41–43 | dodać sprawdzenie `schema_marker_44`, `admin_reorder_questions` (anon zablokowany), `get_session_violation_summary` (anon zablokowany) |

## Częste pułapki

### Pułapka 1: Wake lock „działa na Androidzie, nie na iPhonie”
**Co idzie źle:** Chrome na Androidzie przyznaje blokadę bez gestu, a WebKit tylko z gestem albo po wcześniejszej autoryzacji w tym samym dokumencie. **Jak uniknąć:** uzbrajanie w handlerach gestów + nasłuch na `document` + pasek „dotknij” w Lobby. **Sygnał ostrzegawczy:** `NotAllowedError: Permission was denied` w konsoli Web Inspector.

### Pułapka 2: Wygaszenie = naruszenie
Zablokowanie ekranu wywołuje `visibilitychange → hidden`, a to liczy `tab_switch`. Dopóki wake lock nie działa, raport naruszeń jest niesprawiedliwy dla iPhone’ów. W UAT porównać licznik po 3 min bezczynności w pytaniu (wymaga długiego `PROBE_TPQ`/sesji testowej).

### Pułapka 3: Presence z polskimi znakami w nazwie kanału
Podium używa `encodeURIComponent(city)` („polskie znaki psują broadcast”), a `presence-lobby-${city}` nie. Lista „W poczekalni” dla Krakowa/Poznania/Wrocławia może nie działać. **Sprawdzić przed oparciem na niej widoku** (dwa telefony w Krakowie). Ewentualna zmiana nazwy kanału po obu stronach w jednym wdrożeniu.

### Pułapka 4: Odmontowanie `Quiz` zeruje licznik naruszeń
Opisane w Wzorcu 7. Bez trwałego licznika „zgodność z telefonem” jest niedefiniowalna.

### Pułapka 5: `validate_participant_code` STABLE + INSERT
Funkcja STABLE wywołana przez PostgREST działa READ ONLY, więc INSERT zawiedzie. Zmienić na VOLATILE i przeładować cache schematu.

### Pułapka 6: Excel zjada zera wiodące
Plik CSV otwarty i zapisany w Excelu zmienia `0042` w `42`. Parser zgłasza błąd z podpowiedzią. Przykładowy plik i opis formatu mówią o kolumnie Tekst. Obsłużyć `="0042"`.

### Pułapka 7: Backspace na automatycznym myślniku
Naiwne formatowanie dopisuje myślnik z powrotem i użytkownik utyka na „KRK-”. Potrzebne rozpoznanie kasowania (`raw.length < prev.length`).

### Pułapka 8: Przeciąganie w trakcie sesji
Opisane w Wzorcu 9 (odczyty po indeksie puli w panelu i LiveView).

### Pułapka 9: Test liczby wpisów ZIP i `secs`
Dodanie styles.xml i zmiana `secs` złamie 2 istniejące asercje (`entries toBe(7)`, `secs(12345) → 12.3`). Trzeba je zaktualizować świadomie, a nie usuwać.

### Pułapka 10: Klucz IP podrabialny
Pierwsza pozycja XFF pochodzi od klienta. Bez weryfikacji nagłówka limit IP to pozór. Krok echo przed wdrożeniem klucza IP.

## Przykłady kodu

### Czysty stan ekranu projektora
```js
// src/lib/projector.js
export function projectorIdlePhase(v, status) {
  if (v?.phase === "results" || v?.phase === "ended") return "ended";
  if (status === "results" || status === "ended") return "ended";
  return "waiting";
}
```

### Dosłanie zaległego zapisu naruszeń
```js
// useAntiCheat — szkic
const send = (type) => {
  lastSentRef.current[type] = Date.now();
  const c = countsRef.current; // { total, tab_switch, screenshot_attempt } z localStorage
  recordViolation({ participantCode, sessionId, type, count: c.total, typeCount: c[type] });
};
const trigger = (type) => {
  bump(type); // +1 w countsRef + localStorage + setViolations(c.total)
  const since = Date.now() - (lastSentRef.current[type] || 0);
  if (since >= DEDUPE_MS) return send(type);
  if (!pendingRef.current[type]) pendingRef.current[type] = setTimeout(() => { pendingRef.current[type] = null; send(type); }, DEDUPE_MS - since);
};
// cleanup: dla każdego oczekującego typu clearTimeout + send(type)
```

### Agregacja naruszeń (JS, fallback i testy)
```js
export function summarizeViolations(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const code = r.participant_code ?? r.participantCode;
    const s = out.get(code) || { total: 0, tab_switch: 0, screenshot_attempt: 0, _rows: { tab_switch: 0, screenshot_attempt: 0 } };
    s.total = Math.max(s.total, Number(r.count) || 0);
    if (r.type in s._rows) {
      s._rows[r.type] += 1;
      if (r.type_count != null) s[r.type] = Math.max(s[r.type], Number(r.type_count));
    }
    out.set(code, s);
  }
  for (const s of out.values()) for (const t of ["tab_switch", "screenshot_attempt"]) if (!s[t]) s[t] = s._rows[t];
  return out; // brak kodu w mapie → 0
}
```

## Stan wiedzy (co się zmieniło)

| Stare podejście | Obecne | Kiedy | Wpływ |
|-----------------|--------|-------|-------|
| haptyka iOS przez `label.click()` | tylko prawdziwe dotknięcie w `<label>` z przełącznikiem | iOS 26.5 (WebKit fc1ef83), ios-haptics 3.1 (06.2026), poprawka przewijania 09.2026 | nakładka w kafelku zamiast wywołania z JS |
| NoSleep jako jedyna droga na iOS | Screen Wake Lock w Safari od 16.4, w PWA z ekranu od 18.4 | 2023–2025 | natywna blokada priorytetem, ale **z gestem** |
| presence włączone dla każdego kanału | realtime-js wysyła `presence.enabled` tylko przy nasłuchu presence; `track()` włącza leniwie (supabase/realtime #2196/#2197) | 2025–2026 | lista lobby admina może nie zobaczyć osób śledzonych wcześniej, jeśli serwer bez poprawki #2197 |

## Otwarte pytania

1. **Czy natywny Wake Lock działa w Chrome na iOS (WKWebView)?**
   - Wiemy: preferencja WebKit jest domyślnie włączona dla WK2; implementacja idzie przez `UIApplication` procesu aplikacji.
   - Niejasne: caniwebview podaje „brak”; brak testu na urządzeniu.
   - Rekomendacja: fallback mp4 zaimplementować niezależnie. W UAT sprawdzić w Chrome, czy `navigator.wakeLock` istnieje i czy ekran nie gaśnie po 2 × Auto-Lock.
2. **Czy haptyka przełącznika działa w Chrome na iOS i na iOS 27?** Rekomendacja: test ręczny na telefonie użytkownika. Brak haptyki nie może psuć wyboru odpowiedzi (nakładka nie zmienia logiki `onPick`).
3. **Który nagłówek niesie prawdziwe IP w PostgREST na Supabase i czy da się go podrobić?** Rekomendacja: krok echo; bez pozytywnego wyniku tylko klucz urządzenia.
4. **Lawina presence przy starcie quizu (istniejące lobby).** Czy przy 500 osobach na Pro (500 msg/s) odmontowanie Lobby nie wywoła `tenant_events` dokładnie w chwili startu? Rekomendacja: zgłosić użytkownikowi jako ryzyko operacyjne do testu obciążeniowego (poza zakresem). Warto rozważyć plan „Pro bez limitu wydatków” (2 500 msg/s) albo usunięcie `track()` z Lobby (lista „W poczekalni” przeszłaby na `participant_codes.used`).
5. **Czy utwardzać wyrocznie kodów (sekcja 45) w tej fazie?** To decyzja użytkownika. Bez tego limit chroni tylko ścieżkę UI.
6. **Anty-cheat poza fazą pytania** (intro/countdown/przerwa) — dziś niezliczane. Poza zakresem, do zanotowania.

## Dostępność środowiska

| Zależność | Potrzebna do | Dostępna | Wersja | Fallback |
|-----------|--------------|----------|--------|----------|
| Node.js | build, testy | ✓ | 24.11.0 | — |
| npm / Vitest | testy | ✓ | Vitest 2.1.9 (214/214) | — |
| Playwright | sonda prod | ✓ | 1.60 | — |
| Supabase SQL Editor (prod `ytbwmmqwbfcugouourih`) | sekcja 44 | ręcznie (użytkownik) | — | checkpoint |
| pg_cron | sprzątanie `code_attempts` | ✓ (sekcja 40) | — | ręczny DELETE |
| Fizyczny iPhone, najnowszy iOS, Safari + Chrome | P7-IOS-WAKE/HAPTIC | u użytkownika | ? (iOS 26.x/27) | brak — test ręczny obowiązkowy |
| Telefon z Androidem | regresja `vibrate` | ? | — | pominąć (bez zmian w tej ścieżce) |
| ffmpeg | plik wideo | ✗ | — | data URI z NoSleep.js (nie trzeba) |
| gh CLI | — | ✗ | — | niepotrzebne |
| Vercel (push na `main`) | wdrożenie | ✓ | — | — |

**Brakujące bez fallbacku:** brak (fizyczne urządzenie jest po stronie użytkownika i trzeba to zaplanować jako checkpoint).

## Architektura walidacji

### Framework testów
| Właściwość | Wartość |
|------------|---------|
| Framework | Vitest 2.1.9 + @testing-library/react 16 + jsdom 24 |
| Konfiguracja | `vite.config.js` (`test.environment: "jsdom"`), `src/test-setup.js` |
| Szybkie uruchomienie | `npx vitest run src/lib/<plik>.test.js` |
| Pełny zestaw | `npm test` (~17 s) + `npm run build` |
| Prod SQL | `npm run verify-prod` (+ nowy skrypt limitu) |
| Sonda gry | `$env:PROBE_TARGET="prod"; $env:PROBE_CONFIRM="1"; $env:PROBE_TRACE="1"; npm run sonda` (za zgodą) |

### Mapa wymagań → testy
| ID | Zachowanie | Typ | Polecenie | Plik istnieje? |
|----|------------|-----|-----------|----------------|
| P7-PROJ-END | `projectorIdlePhase`: results/ended → ended; lobby/legacy/brak planu → waiting | unit | `npx vitest run src/lib/projector.test.js` | ❌ fala 0 |
| P7-PROJ-END | projektor po końcu sesji sondy pokazuje `data-fue-live-phase="ended"` | sonda (rozszerzenie) | sonda z otwartym `?live=1&city=` | ❌ (opcjonalnie) |
| P7-PROJ-END | wizualnie, do podium | ręczny | UAT | — |
| P7-IOS-WAKE | kontroler: prośba tylko przy `wanted`; odmowa natywna → przy kolejnym geście wideo; wideo bez `muted`/`loop`; `release` przy `!active`; nasłuch gestów zdjęty przy `held` | unit (mock `navigator.wakeLock`, `HTMLMediaElement.prototype.play`) | `npx vitest run src/lib/wakeLock.test.js` | ❌ fala 0 |
| P7-IOS-WAKE | ekran nie gaśnie: lobby 2 × Auto-Lock, pytanie, po refreshu (pasek „dotknij”) — Safari i Chrome | ręczny iPhone | UAT | — |
| P7-IOS-HAPTIC | nakładka renderowana tylko gdy `HAS_SWITCH_HAPTICS && !answered && picked===null`; klik w label → `onPick` **dokładnie raz** | unit RTL | `npx vitest run src/screens/Quiz.test.jsx` | ❌ fala 0 |
| P7-IOS-HAPTIC | odczuwalne tyknięcie, Safari + Chrome | ręczny iPhone | UAT | — |
| P7-VT-SMOOTH | `shouldStartViewTransition` false dla countdown/intro→quiz; strikes/stableFrames | unit | `npx vitest run src/lib/viewTransition.test.js` | ✅ (rozszerzyć) |
| P7-VT-SMOOTH | devDom ≤ 1500 (cel < 400) w 5 przebiegach | sonda prod | seria podstawowa ×5 | ✅ skrypt |
| P7-CODE-4 | `parseCodesCsv`: BOM, `;`/`,`, nagłówek, `="0042"`, `KRK-0042`, zły prefiks, 3 cyfry, `12a4`, duplikat, zajęty, pusty → losowy wolny; `pickFreeNumbers` bez kolizji | unit | `npx vitest run src/lib/codeFormat.test.js` | ❌ fala 0 |
| P7-CODE-DASH | `formatCodeInput`: `K,R,K`→`KRK-`; backspace z `KRK-`→`KRK`; wklejenie `krk1111`/`KRK 1111`/`krk-1111`→`KRK-1111`; 6 cyfr OK; >6 obcięte | unit + RTL CodeEntry | jw. + `src/screens/CodeEntry.test.jsx` | ❌ fala 0 |
| P7-CODE-RATE | 5× `not_found` z urządzenia A → 6. `rate_limited`; poprawny kod z urządzenia B OK; po 60 s A znów może; sprzątanie wierszy testowych | integracja prod | nowy `scripts/verify-code-limit.js` (`npm run verify-code-limit`) | ❌ fala 0 |
| P7-CODE-RATE | nagłówek IP niepodrabialny | ręczny/curl | krok echo | — |
| P7-VIOL-REPORT | `summarizeViolations` (max count, type_count, stare wiersze, brak = 0); `buildResultsSheets` z kolumną „Naruszenia” i wierszami karty | unit | `npx vitest run src/lib/violations.test.js src/lib/resultsXlsx.test.js` | ❌ / ✅ rozszerzyć |
| P7-VIOL-REPORT | hook: licznik trwały po remount; dosłanie po oknie (fałszywe zegary); ≤ 1 zapis / 10 s / typ | unit hook | `npx vitest run src/hooks/useAntiCheat.test.js` | ❌ fala 0 |
| P7-AVG-2DP | `secs(12345)=12.35`; styles.xml obecny, komórka czasu `s="1"`; 8 wpisów ZIP | unit | `npx vitest run src/lib/xlsx.test.js src/lib/resultsXlsx.test.js` | ✅ zaktualizować |
| P7-AVG-2DP | brak `toFixed(1)` przy średnim czasie | grep | `grep -n "toFixed(1)" src/screens/AdminPanel.jsx` | — |
| P7-Q-REORDER | `moveItem`, gęsta numeracja; plan z posortowanej listy = nowa kolejność | unit | `npx vitest run src/lib/reorder.test.js src/lib/plan.test.js` | ❌ / ✅ |
| P7-Q-REORDER | RPC: city_admin innego miasta → błąd; parzystość planu | integracja prod | `npm run verify-plan` + krok w `verify-prod` | ✅ / rozszerzyć |
| P7-ADMIN-STUCK | `classifyParticipant` na tablicy przypadków | unit | `npx vitest run src/lib/roster.test.js` | ❌ fala 0 |
| P7-ADMIN-STUCK | 2 telefony: jeden w trybie samolotowym w trakcie pytania → „rozłączony” po reveal; 🔓 działa | ręczny | UAT | — |
| SC10 | migracje addytywne: stary bundel (commit sprzed fazy) działa po sekcji 44 | sonda na starym buildzie | jak w 06-03 | ✅ wzorzec |

### Częstotliwość próbkowania
- **Po każdym commicie zadania:** szybkie polecenie dla dotkniętego pliku testów.
- **Po każdej fali:** `npm test` + `npm run build`.
- **Po wgraniu sekcji 44 (checkpoint):** `npm run verify-prod` + `verify-code-limit` + `verify-plan`.
- **Bramka fazy:** pełny zestaw zielony, seria sond (5× podstawowa + ADMIN_EXIT) za zgodą użytkownika, z kontrolą resztek `[SONDA]` i blokadą uśpienia komputera; ręczna lista kontrolna iPhone (Safari + Chrome); projektor po końcu testu.

### Luki fali 0
- [ ] `src/lib/projector.test.js` — P7-PROJ-END
- [ ] `src/lib/wakeLock.test.js` — P7-IOS-WAKE
- [ ] `src/screens/Quiz.test.jsx` — P7-IOS-HAPTIC (pojedynczy `onPick`)
- [ ] `src/lib/codeFormat.test.js`, `src/screens/CodeEntry.test.jsx` — P7-CODE-4/DASH
- [ ] `scripts/verify-code-limit.js` + wpis `npm run verify-code-limit` — P7-CODE-RATE
- [ ] `src/lib/violations.test.js`, `src/hooks/useAntiCheat.test.js` — P7-VIOL-REPORT
- [ ] `src/lib/reorder.test.js` — P7-Q-REORDER
- [ ] `src/lib/roster.test.js` — P7-ADMIN-STUCK
- [ ] aktualizacja `xlsx.test.js` (8 wpisów) i `resultsXlsx.test.js` (`secs` 2 miejsca)
- Framework: brak luk (Vitest + RTL + jsdom zainstalowane).

## Źródła

### Pierwotne (HIGH)
- Kod repo: `src/hooks/useWakeLock.js`, `useAntiCheat.js`, `useLiveProjection.js`, `useParticipantGame.js`, `src/screens/{Quiz,CodeEntry,Lobby,LiveView,AdminPanel}.jsx`, `src/lib/{plan,supabase,resultsXlsx,xlsx,viewTransition}.js`, `SUPABASE_FIXES.sql` (§12, 27, 34, 39.6a, 42.7, 43), `SUPABASE_SCHEMA.sql` (RLS questions/violations), `node_modules/@supabase/realtime-js` 2.104.1 (`RealtimeChannel.subscribe` — `presence_enabled`)
- WebKit main: [WakeLock.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/screen-wake-lock/WakeLock.cpp) (tymczasowa aktywacja), [WakeLockManager.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/screen-wake-lock/WakeLockManager.cpp), [SleepDisablerIOS.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/PAL/pal/system/ios/SleepDisablerIOS.mm), [HTMLMediaElement.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLMediaElement.cpp) (`shouldDisableSleep`, `mediaType`, `computeCanProduceAudio`), [CheckboxInputType.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CheckboxInputType.cpp) (haptyka przełącznika), [UnifiedWebPreferences.yaml](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml) (`ScreenWakeLockAPIEnabled`, `SwitchControlEnabled`), [HTMLInputElement.idl](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLInputElement.idl)
- [PostgREST — Access Mode](https://docs.postgrest.org/en/v12/references/transactions.html) (STABLE/IMMUTABLE → READ ONLY), [PostgREST — Functions](https://docs.postgrest.org/en/v12/references/api/functions.html) (przeładowanie cache schematu)
- [Supabase Realtime — Quotas](https://supabase.com/docs/guides/realtime/quotas) (limity, `tenant_events`, definicja zdarzenia)
- [Supabase — Securing your API](https://supabase.com/docs/guides/api/securing-your-api) (przykład limitu z `request.headers`, uwaga o GET)

### Wtórne (MEDIUM)
- [tijnjh/ios-haptics](https://github.com/tijnjh/ios-haptics) — README, `src/index.ts`, issue #8 (łatka iOS 26.5), PR #13 (nakładka label, zaufany klik, WebKit fc1ef83)
- [richtr/NoSleep.js](https://github.com/richtr/NoSleep.js) — `src/index.js`, `src/media.js` (mp4 z AAC sprawdzone lokalnie), licencja MIT
- [Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/) (XFF dopisywany)
- [supabase/realtime #2196](https://github.com/supabase/realtime/issues/2196) / [#2197](https://github.com/supabase/realtime/pull/2197) (leniwe włączanie presence)
- [KyleMit/Splotch #1949](https://github.com/KyleMit/Splotch/issues/1949) (aktywacja na pointerup/touchend/click), [vueuse #3484](https://github.com/vueuse/vueuse/issues/3484) (odmowa przy ponownym uzyskaniu na iOS)

### Trzeciorzędne (LOW — do weryfikacji)
- [caniwebview — Screen Wake Lock](https://caniwebview.com/features/web-feature-screen-wake-lock/) (WKWebView „nie”, sprzeczne ze źródłami WebKit)
- Wyniki wyszukiwania o Low Power Mode ignorującym wake lock (jedno źródło)
- [Supabase discussion #27002](https://github.com/orgs/supabase/discussions/27002) (nagłówki IP w RPC — bez konkretów)

## Metadane

**Rozkład pewności:**
- Stos: HIGH. Bez nowych zależności, wersje sprawdzone w repo.
- G8, kody, średnia, kolejność, naruszenia: HIGH. Kod i SQL czytane bezpośrednio.
- Wake lock / haptyka w Safari: MEDIUM-HIGH (źródła WebKit), w Chrome iOS: MEDIUM-LOW (brak testu na urządzeniu), iOS 27: LOW.
- Limit prób: HIGH co do mechanizmu SQL, LOW co do nagłówka IP na Supabase.
- Presence/Realtime: MEDIUM. Limity z dokumentacji; skutek fan-outu wywnioskowany z definicji zdarzenia.

**Data researchu:** 2026-09-28
**Ważne do:** ~2026-10-28 (iOS/WebKit zmienia się szybko: przed UAT sprawdzić wersję iOS i repo ios-haptics)
