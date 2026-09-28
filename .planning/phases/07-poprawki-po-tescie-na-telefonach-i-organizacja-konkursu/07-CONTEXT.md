# Phase 7: Poprawki po teście na telefonach i organizacja konkursu - Context

**Gathered:** 2026-09-28
**Status:** Ready for planning
**Source:** rozmowa z użytkownikiem po teście na telefonach 06-17 (uwagi + decyzje), odpowiedzi zapisane dosłownie w `06-17-GATE.md` → „Test na telefonach”

<domain>
## Phase Boundary

Faza dowozi dwie grupy zmian na produkcyjny front (https://fue-quiz.vercel.app) i bazę Supabase (produkcja; staging nie istnieje):

**A. Luki z testu na telefonach (06-17):**
- G8: projektor po zakończeniu testu pokazuje „Oczekiwanie — Quiz dla {city} zaraz się rozpocznie” zamiast końca testu.
- G9: iPhone (najnowszy iOS, **Google Chrome**, nie PWA z ekranu głównego): brak wibracji, ekran się wygasza w trakcie gry. Pierścień czasu działa, przejścia „dość płynne, ale może da się jeszcze bardziej”.

**B. Prośby koordynatorów (organizacja konkursu):**
- kody uczestników 4-cyfrowe, nadawane w pliku importu, z limitem prób po stronie serwera;
- automatyczny myślnik po prefiksie miasta przy wpisywaniu kodu;
- naruszenia (anty-cheat) per uczestnik w raporcie XLSX;
- średni czas odpowiedzi z 2 miejscami po przecinku;
- zmiana kolejności pytań przeciąganiem;
- widok uczestników rozłączonych/utkniętych dla admina (otwarta sprawa z 24.09.2026).

Poza zakresem: przejście na plan Supabase Pro i test obciążeniowy na 500 (osobna czynność operacyjna przed wydarzeniem), próba generalna.

</domain>

<decisions>
## Implementation Decisions

### G8 — projektor po końcu testu (P7-PROJ-END)
- Sesja w statusie `results` albo `ended` → projektor pokazuje ekran „Koniec testu” (np. 🏁, „Koniec testu”, „Dziękujemy! Wyniki za chwilę.”), NIE „Oczekiwanie”. Pozostaje, dopóki admin nie wypchnie podium (broadcast `podium` — wtedy podium jak dziś).
- `waiting` (lobby) → bez zmian: „Oczekiwanie” + QR.
- Przyczyna w kodzie: `src/hooks/useLiveProjection.js` `tickPlan` — gdy `!v.item` (lobby / results / ended / legacy) zawsze `setPhase("waiting")`.

### G9 — iPhone (P7-IOS-WAKE, P7-IOS-HAPTIC, P7-VT-SMOOTH)
- Testowane środowisko: **najnowszy iOS, Google Chrome** (WebKit pod spodem), nie tryb ikony na ekranie głównym. Rozwiązanie musi działać w Chrome i Safari na iOS.
- Wake lock: ekran nie może gasnąć w trakcie gry (lobby → koniec testu). Jeśli Screen Wake Lock API niedostępne albo odmówione → fallback (np. ukryte, wyciszone, zapętlone wideo inline, wzorzec NoSleep.js) uruchamiany przy geście użytkownika (np. przycisk wejścia/dołączenia). Bez zewnętrznych bibliotek UI; mała biblioteka lub własna implementacja — do decyzji po researchu (Claude's discretion), preferencja: własna, mała implementacja.
- Uwaga: wygaszenie ekranu = `visibilitychange` → naruszenie `tab_switch` w `useAntiCheat` — dlatego wake lock jest też sprawą uczciwości raportu naruszeń.
- Haptyka: `navigator.vibrate` nie działa na iOS. Na iOS 18+ użyć haptyki przełącznika `<input type="checkbox" switch>` (klik w powiązany `<label>` w trakcie gestu użytkownika) przy wyborze odpowiedzi. Na Androidzie zostaje `navigator.vibrate`.
- Płynność: obecnie po pierwszym przejściu View Transition > 150 ms VT wyłącza się do końca życia hooka (poprawka G7, `src/lib/viewTransition.js`). Dopuszczalne złagodzenie (np. ponowna próba po N stabilnych klatkach / wyłączenie tylko dla wolnych przejść), ALE bez pogorszenia startu pytania względem planu (sonda: devDom ≤ 1500 ms, cel < 400 ms). Priorytet niższy niż G8/G9.

### Kody uczestników (P7-CODE-4, P7-CODE-DASH, P7-CODE-RATE)
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

### Naruszenia w raporcie (P7-VIOL-REPORT)
- XLSX (`src/lib/resultsXlsx.js`, bieżąca sesja i Historia): kolumna „Naruszenia” w arkuszu Ranking + w karcie uczestnika wiersze: łączna liczba naruszeń oraz rozbicie per typ (`tab_switch` = „Wyjście z aplikacji / wygaszenie ekranu”, `screenshot_attempt` = „Próba zrzutu ekranu”).
- Łączna liczba ma odpowiadać licznikowi na telefonie. Dziś zapis do bazy jest deduplikowany (max 1 wiersz/10 s/typ, `useAntiCheat.js`), a `getViolationsForSession` ma `limit(200)` → raport musi pobierać wszystkie wiersze sesji (stronicowanie) i brać sumę faktyczną. Claude's discretion: np. zapis licznika per typ w polu `count` + max(count) per uczestnik/typ, albo dosłanie brakujących zdarzeń po oknie deduplikacji — bez zwiększania obciążenia bazy przy 500 osobach.
- Uczestnik bez naruszeń → 0.

### Średni czas (P7-AVG-2DP)
- 2 miejsca po przecinku WSZĘDZIE, gdzie pokazany jest średni czas: lista wyników w panelu (dziś `toFixed(1)`, `AdminPanel.jsx` ~1311), XLSX (dziś `secs()` zaokrągla do 0,1 s — Ranking i karta uczestnika; czasy pojedynczych odpowiedzi też na 2 miejsca), CSV (już 2), podium (już 2).
- **Brak reguły remisu** (decyzja użytkownika: przy 2 miejscach remis jest praktycznie niemożliwy). Ranking w SQL zostaje: poprawne DESC, avg_ms ASC.

### Kolejność pytań (P7-Q-REORDER)
- Zakładka Pytania (`PytaniaTab`): zmiana kolejności w obrębie modułu przeciąganiem (HTML5 drag & drop na komputerze) oraz przyciskami ↑/↓ (telefon / dostępność). Zapis do `questions.sort_order`. Bez usuwania i ponownego dodawania.
- Plan quizu już sortuje po (module, sort_order, id) w JS (`plan.js`) i SQL (parzystość `verify-plan` 47/47) → po zmianie kolejności nowy start używa nowej kolejności. Trwająca sesja ma plan zamrożony — zmiany jej nie dotyczą (opisać w UI: „Zmiana kolejności działa od następnego startu”).
- Bez bibliotek (constraint projektu: brak zewnętrznych bibliotek UI).

### Widok uczestników dla admina (P7-ADMIN-STUCK)
- W panelu sesji: lista uczestników z kodami miasta ze stanem: w poczekalni / online w grze / rozłączony (brak obecności Realtime) / nie odpowiedział na bieżące pytanie; przy każdym przycisk 🔓 (releaseCode, z potwierdzeniem) do przepięcia na inny telefon.
- Źródła danych do researchu: presence Realtime (Lobby już `ch.track`), answers bieżącego pytania, `participant_codes.device_id/used`. Nie zwiększać obciążenia ponad dzisiejsze poll 1 s / 3 s.

### Zasady przekrojowe
- Migracje SQL wyłącznie addytywne, jako nowa sekcja w `SUPABASE_FIXES.sql` (następna: 44) z markerem dla `verify-prod`; ręczne wgranie przez użytkownika (checkpoint), jak sekcje 42/43.
- Testy: Vitest dla czystej logiki (parsowanie CSV kodów, formatowanie myślnika, agregacja naruszeń, format średniej, kolejność); sonda produkcyjna po zmianach w ścieżce gry (G8/G9/VT) — za zgodą użytkownika, z blokadą uśpienia komputera i kontrolą resztek przed serią.
- Wdrożenie frontu poza wydarzeniem (Service Worker autoUpdate), push na `main` → Vercel.
- Język UI: polski.

### Claude's Discretion
- Konkretny mechanizm limitu prób (tabela prób, klucz identyfikacji, okno) — po researchu.
- Implementacja fallbacku wake lock i haptyki (własna vs mała biblioteka).
- Sposób dokładnego zliczania naruszeń.
- Podział na plany i fale.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wynik testu i luki
- `.planning/phases/06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji/06-17-GATE.md` — sekcje „Test na telefonach” (G8, G9), „Seria 3” (metryki sond: start pytań, VT off), „Czasy modułów”
- `.planning/debug/resolved/g7-zawieszony-snapshot-blokuje-plan.md` — dlaczego VT wyłącza się po wolnym przejściu (ograniczenia skipTransition)

### Kod
- `src/hooks/useLiveProjection.js` (`tickPlan` ~170–213) i `src/screens/LiveView.jsx` (ekran „Oczekiwanie” ~85–92) — G8
- `src/hooks/useWakeLock.js`, `src/App.jsx:58` (fazy z aktywnym wake lock) — G9 wake
- `src/screens/Quiz.jsx:~164` (`navigator.vibrate?.(15)`) — G9 haptyka
- `src/lib/viewTransition.js`, `src/hooks/useParticipantGame.js` (`pushView`) — płynność
- `src/lib/supabase.js`: `CITY_PREFIX` :36, `randomCodeBody` :42, `generateParticipantCode` :156, `claim/validate` ~110–130, `recordViolation`/`getViolationsForSession` :796–826, `getSessionResults` ~492–523, `getSessionDetailedResults`, `addQuestion` (sort_order) ~260–270
- `src/screens/CodeEntry.jsx` (pole kodu, :37 `toUpperCase`)
- `src/screens/AdminPanel.jsx`: `PytaniaTab` :95, `KodyTab` :335 (import CSV :363–395, 🔓 :398/498), `SesjaTab` :510 (naruszenia :1231, lista wyników :1305–1317, CSV :873/1676), `HistoriaTab` :1644
- `src/hooks/useAntiCheat.js` (deduplikacja 10 s)
- `src/lib/resultsXlsx.js` (`secs`, `buildResultsSheets`) + `src/lib/resultsXlsx.test.js`
- `src/lib/plan.js` (sortowanie module, sort_order, id)
- `SUPABASE_FIXES.sql`: `validate_participant_code` :653, `claim_participant_code` :990, `get_session_results` §43.2 :2653, ostatnia sekcja 43 (:2611)
- `scripts/verify-prod.js`, `scripts/verify-plan.js`, `scripts/probe-gameplay.js`

### Pamięć projektu
- Migracje addytywne (testy na prod, brak stagingu); sonda: przed serią sprawdź resztki `[SONDA]`, blokuj uśpienie.

</canonical_refs>

<specifics>
## Specific Ideas

- Przykład kodu z importu: `Jan;Kowalski;1111` w Krakowie → `KRK-1111`.
- Komunikat limitu: „Za dużo prób — spróbuj za minutę”.
- Ekran końca na projektorze: w stylu istniejących ekranów LiveView (Bebas Neue, kolory #F5C518/#9B89CC).

</specifics>

<deferred>
## Deferred Ideas

- Plan Supabase Pro + test obciążeniowy 500 jednoczesnych (operacyjne, przed wydarzeniem).
- Reguła remisu (ex aequo / dodatkowe kryterium) — świadomie odrzucona.
- Próba generalna z kilkoma osobami i projektorem na tydzień przed TWE.

</deferred>

---

*Phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu*
*Context gathered: 2026-09-28 z rozmowy po teście 06-17*
