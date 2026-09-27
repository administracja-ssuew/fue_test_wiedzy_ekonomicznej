# 06-DIAG — diagnoza luk G2 (pauza w reveal/countdown) i G7 (start pytania 1,9–2,8 s po planie)

**Data serii:** 2026-09-27, 13:39–14:52 UTC · **Cel:** produkcja (`PROBE_TARGET=prod PROBE_CONFIRM=1`), miasto Kraków, 2 telefony
**Build aplikacji:** HEAD `92e3770` (zawiera 06-15 do `c74421b` i 06-14 do `38159b9`), `vite preview` :4173
**Sonda:** `scripts/probe-gameplay.js` z 06-13 (`bae8c50` + `92e3770`), od przebiegu 03 z poprawką parsera Realtime `aecdc01`
**Zgoda użytkownika:** „sondy OK” · `verify-prod` przed serią: kod 0 (54 ✅, sekcje 42 i 43 wgrane)
**Po każdym przebiegu:** `check-planless` = 0; sprzątanie „✅ czysto” (pytania / kody / plany sondy 0); czasy modułów przywrócone (20/30/60/75/20); wszystkie sesje miast `waiting` jak przed serią

Surowe dane (lokalnie, `test-results/` jest w `.gitignore`): logi `test-results/sonda-<nr>-<tryb>.log` i zrzuty `test-results/probe-trace-<czas>-<tryb>.json`.

## Tabela przebiegów

Kolumny: **reveal** = `r − c` z `state.plan` (ms). **start DOM / próbka** = maks. |odchylenie| startu pytania od planu z chwili zmiany `data-fue-phase` (MutationObserver) oraz z próbki co 250 ms. **VT** = maks. `cb − call` startViewTransition z pominięciem pierwszego przejścia po załadowaniu strony (w nawiasie wartość z przejściem przy ładowaniu) / liczba nakładających się przejść. **skok off.** = maks. skok `serverNow()` telefonu między kolejnymi próbkami. **stare snap.** = snapshoty wysłane przed wierszem Realtime, odebrane po nim, z innym stanem (H1). **idx** = `current_question_idx` zgodny z planem + sekwencja w bazie.

| # | tryb | tpq | reveal (ms) | kod | widoczność pytań (s, plan) | start DOM / próbka (ms) | VT maks. (ms) / overlap | skok off. (ms) / maks. RTT | stare snap. | idx w bazie | P1–P6 pauzy |
|---|------|-----|-------------|-----|-----------------------------|--------------------------|-------------------------|-----------------------------|-------------|-------------|-------------|
| 01 | podstawowy | 20 | 11500 | 0 | 31,0 / 31,1 / 31,2 (31,5) | 65 / 316 | 123 (756) / 1 | 178 / 528 | — ¹ | 111/111, 0→1→2 | — |
| 02 | podstawowy | 20 | 11500 | 0 | 31,1 / 31,3 / 31,2 (31,5) | 37 / 308 | 23 (169) / 0 | 74 / 265 | — ¹ | 112/112, 0→1→2 | — |
| 03 | podstawowy | 20 | 11500 | 0 | 31,4 / 31,2 / 31,0 (31,5) | 80 / 295 | 69 (78) / 0 | 219 / 1407 | 0 | 112/112, 0→1→2 | — |
| 04 | podstawowy | 20 | 11500 | 0 | 31,2 / 31,2 / 31,2 (31,5) | 50 / 280 | 42 (133) / 0 | 89 / 261 | 0 | 109/109, 0→1→2 | — |
| 05 | podstawowy | 20 | 11500 | 0 | 31,2 / 31,0 / 31,3 (31,5) | 41 / 275 | 27 (122) / 0 | 180 / 631 | 0 | 112/112, 0→1→2 | — |
| 06a | pauza reveal pyt.2 | 20 | 11500 | 0 | 31,2 / 31,0 / 31,3 (31,5) | 91 / 308 | 79 (114) / 0 | 66 / 235 | 0 | 113/113, 0→1→2 | P1–P5 ✅; P6: klik→baza 152 ms, lądowanie reveal q2 |
| 07a | pauza reveal pyt.2 | 20 | 11500 | 0 | 31,3 / 30,9 / 31,2 (31,5) | 88 / 251 | 73 (88) / 0 | 64 / 244 | 0 | 110/110, 0→1→2 | P1–P5 ✅; P6: 189 ms, reveal q2 |
| 08a | pauza countdown po pyt.2 | 20 | 11500 | 0 | 31,2 / 31,3 / 31,2 (31,5) | 83 / 291 | 63 (79) / 0 | 103 / 1286 | 0 | 112/112, 0→1→2 | P1–P5 ✅; P6: 141 ms, countdown q3 |
| 09a | pauza countdown po pyt.2 | 20 | 11500 | 0 | 31,3 / 31,1 / 31,1 (31,5) | 80 / 287 | 71 (103) / 0 | 76 / 643 | 0 | 113/113, 0→1→2 | P1–P5 ✅; P6: 167 ms, countdown q3 |
| 10a | pauza reveal pyt.2 | 60 | 11500 | 1 ² | 47,4 / 47,3 / 47,5 (71,5 ²) | 50 / 271 | 36 (61) / 0 | 98 / **3949** | 0 | 160/160, 0→1→2 | P1–P5 ✅; P6: 233 ms, reveal q2 |
| 11a | pauza countdown po pyt.2 | 60 | 11500 | 1 ² | 47,6 / 47,8 / 47,4 (71,5 ²) | 56 / 191 | 54 (92) / 0 | 111 / 343 | 0 | 159/159, 0→1→2 | P1–P5 ✅; P6: 161 ms, countdown q3 |

¹ Przebiegi 01–02: parser ramek Realtime w sondzie nie rozpoznawał wiersza (rekord Realtime ma spację po dwukropku: `"status": "running"`), więc detektor H1 nie miał danych. W 01 pokazał 2 fałszywe „stare snapshoty” (wiersz bez stanu). Poprawione w `aecdc01` (JSON.parse ramki). Od 03 detektor działa: 10–26 wierszy na przebieg, 0 nierozpoznanych.
² Kod 1 w 10a i 11a pochodzi WYŁĄCZNIE z kontroli „czas widoczności pytań”. Przy tpq ≥ 45 s panel admina robi auto-skrót, gdy wszyscy odpowiedzieli: kotwica przesunęła się 3× w każdym przebiegu (5 różnych kotwic w monitorze: start + 3 skróty + wznowienie), więc pytanie legalnie trwało ~47,5 s zamiast 71,5 s. Sonda porównuje z niezmienionym planem `r − o` i nie uwzględnia skrótów. To ograniczenie pomiaru sondy, nie błąd aplikacji: idx w bazie był zgodny z planem w 160/160 i 159/159 odczytach, sekwencja 0→1→2, a start pytań mieścił się w ≤ 56 ms.

Powtórek z kodem 2 (niewykonany): **0**. Każda pauza trafiła w zadaną fazę za pierwszym razem.

Szczegóły pauz (P1 = wejście telefonów w pauzę po `plan_paused_at`; „po wzn.” = pierwsza próbka z oboma telefonami poza pauzą po wznowieniu w bazie):

| # | faza | zostało fazy przy pauzie | klik→baza pauza / wznowienie | P1 t1 / t2 | po wzn. | przed → w pauzie → po (t1) |
|---|------|--------------------------|------------------------------|------------|---------|-----------------------------|
| 06a | reveal q2 | 2527 ms | 152 / 167 ms | 522 / 256 ms | +690 ms | reveal q2 3s → paused q2 3s → reveal q2 2s |
| 07a | reveal q2 | 2333 ms | 189 / 152 ms | 476 / 475 ms | +636 ms | reveal q2 3s → paused q2 3s → reveal q2 2s |
| 08a | countdown q3 | 1817 ms | 141 / 134 ms | 374 / 374 ms | +642 ms | countdown q3 3s → paused q3 2s → countdown q3 2s |
| 09a | countdown q3 | 1400 ms | 167 / 177 ms | 378 / 377 ms | +474 ms | countdown q3 2s → paused q3 2s → countdown q3 1s |
| 10a | reveal q2 (tpq 60) | 6817 ms | 233 / 153 ms | 543 / 544 ms | +666 ms | reveal q2 8s → paused q2 7s → reveal q2 7s |
| 11a | countdown q3 (tpq 60) | 2882 ms | 161 / 165 ms | 135 / 126 ms | +145 ms | countdown q3 4s → paused q3 3s → countdown q3 3s |

## Wynik ogólny

- **G2 nie odtworzono w 6 przebiegach pauzy** (reveal ×3, countdown ×3, tpq 20 i 60, także z aktywnym auto-skrótem). Po wznowieniu oba telefony za każdym razem wracały do tej samej fazy, tego samego pytania i licznika (±1 s). Nie było ani ucieczki z pauzy, ani utknięcia w niej. Idx w bazie rósł zawsze o 1.
- **G7 nie odtworzono w 11 przebiegach.** Start pytania według DOM był 8–91 ms po planie (limit 1500), a według próbki 13–316 ms. Wszystkie 66 startów (11 przebiegów × 3 pytania × 2 telefony) mieszczą się w ≤ 91 ms.

## Werdykty hipotez

| H | Hipoteza | Werdykt | Dowód |
|---|----------|---------|-------|
| H1 | Stary snapshot nadpisuje nowszy stan sesji (ucieczka z pauzy / utknięcie) | **NIEROZSTRZYGNIĘTA** (wskaźniki czyste) | 9 przebiegów z działającym detektorem (03–11): 305 snapshotów `get_participant_state`, 164 wiersze Realtime, **0 starych snapshotów**, także wokół 6 pauz i 6 wznowień. P4 (ucieczka) = 0 i P5 (utknięcie) = 0 we wszystkich pauzach. Mechanizm jest jednak w kodzie możliwy (`applySnapshot` nie porównuje świeżości), a okno wyścigu rośnie z RTT, które w serii sięgało 3949 ms (10a, telefon 1). Przy 2 telefonach zbieg nie wystąpił, przy 500 i wolnym RPC nie da się go wykluczyć. Zrzuty: `probe-trace-*-pauza-*.json` (pole `phones[].snaps` / `rows`). |
| H2 | View Transition opóźnia `setView` (asynchroniczny callback, nakładanie) | **OBALONA** | 11 przebiegów × 2 telefony, 12–15 VT na telefon: `cb − call` ≤ 123 ms po załadowaniu strony (typowo 13–80 ms), 0 przejść bez callbacku. Jedyne nałożenie (01, telefon 1) dotyczyło przejścia przy ładowaniu strony (0,4 s; `cb − call` 756 ms) i dało `pageerror: Transition was skipped`. Przy każdym starcie pytania VT poprzedzało zmianę DOM o 20–40 ms. VT nie wyjaśnia opóźnień rzędu 2 s. |
| H3 | Wyścig auto-skrótu w AdminPanel (tpq ≥ 45 s) — idx oceniony w złym momencie | **NIEROZSTRZYGNIĘTA** (nie zaobserwowano) | 10a i 11a: 6 auto-skrótów (po 3 na przebieg) plus pauza w trakcie. Idx zgodny z planem 160/160 i 159/159, sekwencja 0→1→2 bez przeskoków, start pytań ≤ 56 ms. W obecnym kodzie `goToNextQuestion` bierze `planPos()?.idx` synchronicznie przy wywołaniu (argument ewaluowany przed `await`, `AdminPanel.jsx:933`). Wyścig wymagałby wywołania efektu tuż na granicy fazy, a sonda takiego zbiegu nie wymusza. |
| H4 | `confirm()` przed pauzą opóźnia moment pauzy (pauza ląduje w innej fazie) | **NIEROZSTRZYGNIĘTA** — najbardziej prawdopodobna przyczyna G2 | Sonda auto-akceptuje `confirm()` (0 ms reakcji człowieka): klik→baza 141–233 ms, 6/6 pauz wylądowało w zadanej fazie. U człowieka czas czytania okna wlicza się jednak wprost w moment pauzy (`AdminPanel.jsx:1060`: `confirm` → dopiero potem `adminPauseSession`, pauza liczona czasem serwera w chwili RPC). Przy reveal zostało w tej serii 1,4–6,8 s fazy, a kilka sekund nad oknem „Czy na pewno chcesz zatrzymać quiz?” wystarczy, żeby pauza wylądowała w odliczaniu albo w NASTĘPNYM pytaniu. Po wznowieniu organizator widzi wtedy kolejne pytanie, co wygląda jak „pytanie zniknęło” (opis G2). Sonda tego nie zmierzy, bo nie ma ludzkiej latencji. |
| H5 | Skok offsetu `serverNow()` po próbce ze snapshotu (duże RTT) przesuwa fazę | **OBALONA** | Offset telefonu minus offset sondy przy każdym z 66 startów pytań: ≤ 10 ms. Maks. skok offsetu między próbkami 58–219 ms, mimo pojedynczych próbek z RTT 1286 / 1407 / 3949 ms, bo filtr pasma min-RTT odrzuca zaszumione próbki (`computeOffset`). Faza liczona z `serverNow()` nie przesuwa się o sekundy. |
| H6 | (kontrolna) artefakt pomiaru sondy: DOM zmienił się na czas, próbka przyszła późno | **NIEROZSTRZYGNIĘTA** (mechanizm potwierdzony, skala nie) | We wszystkich 66 startach próbka była późniejsza od DOM: DOM +8…+91 ms, próbka +13…+316 ms. W ramach jednej próbki oba telefony mają identyczne `devSample` (np. +316/+316, +223/+223), bo to wspólny tick pętli sondy, a nie stan telefonów. Artefakt istnieje, ale w tej serii ma skalę ≤ 0,3 s, a nie 1,9–2,8 s jak w 06-10. Wynik 06-10 (oba telefony naraz, widoczność 23,2 s zamiast 26 s, powtórka czysta) pasuje do chwilowego zatoru pętli sondy albo renderera przeglądarki testowej. Sonda liczy teraz kryterium startu z DOM, więc powtórka zjawiska od razu rozróżni „ekran naprawdę późno” od „próbka późno”. |

## Inne przyczyny i obserwacje

1. **Ograniczenie sondy: kontrola widoczności ignoruje auto-skrót** (tpq ≥ 45 s). Daje fałszywy FAIL (kod 1) w każdym przebiegu z `PROBE_TPQ≥45`, w którym telefony odpowiadają. Poprawka po stronie sondy: oczekiwana widoczność = `r − o` z przesunięciem kotwicy (skróty widać w monitorze jako skok kotwicy wstecz bez pauzy). Plik: `scripts/probe-gameplay.js`, sekcja raportu 1 (`expOf`).
2. **Nieobsłużone odrzucenie View Transition** (`pageerror: Transition was skipped`, 01, telefon 1, 0,5 s po załadowaniu): dwa przejścia w ~20 ms przy starcie, drugie pomija pierwsze. Nieszkodliwe dla stanu, ale zaśmieca konsolę. Źródło: `src/hooks/useParticipantGame.js:112` (`startViewTransition` bez `.ready/.finished.catch`).
3. **Telefon wchodzi w pauzę 126–544 ms po zapisie w bazie** (ścieżka Realtime, P1 z limitem 1500 ms spełnione z zapasem). Pierwsza próbka po wznowieniu z oboma telefonami poza pauzą: +145…+690 ms. Mieści się w normie.
4. **Duże RTT pojedynczych snapshotów** (do 3949 ms) przy zwykłym łączu deweloperskim. To nie wpływa na zegar (H5), ale poszerza okno wyścigu H1.
5. **Błąd parsera sondy** (spacje w rekordzie Realtime) poprawiony w trakcie serii (`aecdc01`). W przebiegach 01–02 H1 nie było mierzone, co jest ujęte w tabeli.

## Zalecenia dla 06-16

**Przyczynowe (G2):**
- **H4: zastąpić `confirm()` przy „⏸ Pauza” przyciskiem uzbrajanym w panelu** („Kliknij ponownie, aby wstrzymać”, ≤ 3 s, bez modalnego okna). Pauza ląduje wtedy w fazie, w której organizator kliknął (drugi klik to ~0,3 s, a nie kilka sekund czytania okna). Dodatkowo: po pauzie pokazać adminowi, w jakiej fazie i przy którym pytaniu realnie stanęła („Pauza: odsłonięcie pyt. 2, zostało 2,5 s”). Wtedy nawet przy spóźnionym kliknięciu nie ma zaskoczenia „zniknęło pytanie”. Sonda obsługuje już drugi klik uzbrojonego przycisku (`res.armed`).

**Defensywne (nie potwierdzone pomiarem, tanie):**
- **H1:** w `applySnapshot` odrzucać snapshot starszy niż ostatnio zastosowany stan sesji, porównując wysłanie snapshotu z odbiorem ostatniego wiersza Realtime albo kotwicę/`plan_paused_at`/status z sekwencją. To zamyka okno wyścigu przy dużym RTT i 500 telefonach.
- **H3:** w efekcie auto-skrótu ocenić idx przed wywołaniem i pominąć wywołanie, jeśli faza bieżącego pytania to już nie `quiz` (skrót w reveal/countdown nie ma sensu).
- **VT:** łapać odrzucenia `startViewTransition` (`vt.ready.catch(() => {})`, `vt.finished.catch(() => {})`), żeby „Transition was skipped” nie było `pageerror`.

**G7 — bez poprawki przyczynowej w aplikacji:** w 11 przebiegach start ≤ 91 ms (DOM). Zalecenie: zostawić nowe kryterium startu z DOM w sondzie (już jest) i przy weryfikacji 06-16 wykonać ≥ 5 przebiegów podstawowych. Jeśli G7 się powtórzy, `devDom` od razu rozstrzygnie, czy ekran był naprawdę spóźniony (aplikacja), czy spóźniona była tylko próbka (sonda). Poprawić też kontrolę widoczności sondy przy auto-skrócie (obserwacja 1), inaczej przebiegi tpq ≥ 45 s dają fałszywe FAIL.
