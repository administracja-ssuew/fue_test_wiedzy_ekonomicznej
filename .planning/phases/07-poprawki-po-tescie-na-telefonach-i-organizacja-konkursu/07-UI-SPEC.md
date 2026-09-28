---
phase: 7
slug: poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
status: approved
reviewed_at: 2026-09-28
shadcn_initialized: false
preset: none
created: 2026-09-28
---

# Faza 7 — Kontrakt UI

> Kontrakt wizualny i interakcyjny dla fazy 7. Wygenerowany przez gsd-ui-researcher, do weryfikacji przez gsd-ui-checker.
> Zasada nadrzędna: **faza nie wprowadza nowego systemu wizualnego.** Wszystkie nowe elementy składamy z istniejących tokenów w kodzie: `C` (`src/screens/AdminPanel.jsx:23`), `W` (`src/screens/Ended.jsx:4`), klasy `.fue-input`, `.fue-page`, `.su`, `.fi`, `.pi`, `.shake` oraz keyframes `pulse` (`src/styles/global.css`). Nowe wartości wolno dodać tylko tam, gdzie ten dokument je wymienia.

---

## Design System

| Właściwość | Wartość |
|------------|---------|
| Narzędzie | none. Style inline (obiekty `style`) plus globalny `src/styles/global.css`. Ograniczenie z CLAUDE.md, bez zmian |
| Preset | nie dotyczy |
| Biblioteka komponentów | none. Zakaz zewnętrznych bibliotek UI (także DnD: bez dnd-kit i react-beautiful-dnd) |
| Ikony | emoji Unicode, tak jak w całej aplikacji (🏁 🔓 ⠿ ↑ ↓ 💡 🔒 ⚠️ ✓). Bez biblioteki ikon |
| Font | `"Bebas Neue"` dla liczb, kodów i nagłówków ekranowych; `"Space Grotesk",sans-serif` dla całej reszty (ładowane z Google Fonts w `index.html`, wagi 300–700) |
| Motyw | ciemny, tło `var(--fue-bg)` = `linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)` |
| Breakpoint | 900 px (`isDesktop` / `useWindowWidth`); ekrany uczestnika projektujemy od telefonu |
| Język UI | polski |

**Źródło:** CLAUDE.md, 07-CONTEXT.md („Bez bibliotek”), 07-RESEARCH.md („Instalacja: brak nowych pakietów”), skan kodu.

---

## Spacing Scale

Wartości deklarowane dla **nowych** elementów tej fazy (wielokrotności 4):

| Token | Wartość | Użycie w fazie 7 |
|-------|---------|------------------|
| xs | 4px | odstęp między wierszami listy (roster, błędy importu), odstęp ↑/↓ |
| sm | 8px | gap w wierszu roster / karcie pytania, odstęp przycisków w pasku akcji |
| md | 16px | padding poziomy kart (`C.card`) i paska w Lobby, odstęp między sekcjami karty |
| lg | 24px | margines pod ikoną i nagłówkiem na projektorze, padding ekranu |
| xl | 32px | odstęp od nagłówka LIVE do bloku „Koniec testu” (jak inne bloki LiveView) |
| 2xl | 48px | nie używamy |
| 3xl | 64px | rozmiar emoji 🏁 na projektorze (jak ⏳/☕/⏸️) |

Dodatkowe wartości (też wielokrotności 4): **12px** (padding pionowy wiersza roster i paska Lobby, gap siatki), **80px** (rezerwa pod stałym paskiem w Lobby, żeby nie zasłaniał stopki).

Wyjątki:
- **Tokeny odziedziczone bez zmian.** `C.btn` (padding `10px 18px`, radius 10), `C.card` (radius 14), `C.input` (padding `11px 14px`), `.fue-input` (padding `14px 16px`), wiersz presence (`6px 10px`). Nie przepisujemy ich na siatkę 4 px, bo zmieniłoby to wygląd całego panelu. Nowe elementy tej fazy używają tych obiektów tak, jak są.
- **Małe przyciski i pigułki.** Małe przyciski w wierszach list: override `C.btn` z `padding: "4px 10px"` (wzorzec KodyTab, `AdminPanel.jsx:498`); pigułki: `padding: "2px 10px"` (wzorzec PytaniaTab, `AdminPanel.jsx:316`). Odziedziczone bez zmian — nowe ↑/↓, 🔓, przełącznik „Tylko problemy” i pigułki rostera wyglądają jak istniejące.
- **Cele dotyku.** Przyciski ↑/↓ i 🔓 w panelu admina: min. **44×44 px** przy szerokości < 900 px, min. **32×32 px** na komputerze. Kafelki odpowiedzi w `Quiz.jsx` zostają bez zmian (minHeight 100).
- **Nakładka haptyki** w kafelku ma `inset: 0` i dokładnie pokrywa kafelek. Nie dodaje paddingu ani marginesu.

---

## Typography

Nowe elementy fazy używają dokładnie 4 rozmiarów i 2 wag:

| Rola | Rozmiar | Waga | Wysokość linii | Font | Gdzie |
|------|---------|------|----------------|------|-------|
| Label | 11px | 700 | 1.4 | Space Grotesk, UPPERCASE, `letterSpacing: 1` | nagłówki kart (roster, blokada kolejności), statusy w wierszach roster, druga linia paska w Lobby, opis formatu CSV |
| Body | 13px | 400 | 1.5 | Space Grotesk | treść wierszy (imię i nazwisko, błędy importu), komunikaty zapisu, komunikat limitu prób, pasek w Lobby (linia 1 w wadze 700) |
| Heading | 16px | 400 | 1.5 | Space Grotesk | podtytuł „Dziękujemy! Wyniki za chwilę.” na projektorze (jak podtytuł „Oczekiwanie”), uchwyt ⠿ |
| Display | 48px | 400 | 1.2 | Bebas Neue, `letterSpacing: 2` | „Koniec testu” na projektorze (jak „Oczekiwanie”, „Przerwa”, „Wstrzymano”) |

Wagi: **400** (regular) i **700** (bold, akcenty tekstu, pierwsza linia paska, przyciski).

Odziedziczone bez zmian (nie liczą się do nowego zestawu): `C.lbl` (11/600) w nowym polu „Kod (opcjonalnie)”, `C.btn` (13/700; małe przyciski w wierszach list 12/700 jak dziś w KodyTab: 🔓, ✕), `C.input` (14/400, także stały prefiks `KRK-` w polu Kod), pole kodu w `CodeEntry` (22/700, `letterSpacing: 3`), kody w Bebas Neue 13–17 px (wzorzec z listy presence i KodyTab), emoji 64 px na projektorze.

---

## Color

| Rola | Wartość | Użycie |
|------|---------|--------|
| Dominujący (60%) | `#070215` → `#0E0435` (gradient `--fue-bg`) | tło wszystkich ekranów, pasek w Lobby (`rgba(7,2,21,.96)`, jak paski w `Quiz.jsx`) |
| Drugorzędny (30%) | `rgba(255,255,255,.05)` + obrys `rgba(255,255,255,.09)` (`C.card`); tekst drugorzędny `#9B89CC`; tekst główny `#EDE9FE`; tekst przycisków ghost `#C4B5FD` | karty pytań, wiersze roster, karta importu, podgląd poprawnych wierszy, opisy |
| Akcent (10%) | `#6B21E8` (gradient `#6B21E8→#4F46E5` w `C.btn("primary")`) | tylko elementy z listy niżej |
| Destrukcyjny / błąd | `#E8376B` (tło błędu `rgba(232,55,107,.1)`, obrys `rgba(232,55,107,.3)`) | błędy (limit prób, błędne wiersze CSV, błąd zapisu kolejności), stan „Rozłączony”, przyciski usuwania ✕/🗑 |

**Akcent zarezerwowany dla:**
1. przycisku „Dołącz do quizu →” w `CodeEntry` (bez zmian) i przycisku „🎟️ Generuj kod” w KodyTab (dziś „🎟️ Generuj”, zmiana tylko etykiety),
2. obrysu fokusu pola kodu (`.fue-input:focus`, bez zmian),
3. **linii miejsca upuszczenia** przy przeciąganiu pytania (2 px `#6B21E8`) i obrysu karty nad celem (`rgba(107,33,232,.6)`),
4. plakietki numeru pytania (`rgba(107,33,232,.25)`, bez zmian).

Akcent nie służy do kolorowania statusów, ↑/↓, 🔓 ani uchwytu ⠿. Te elementy są neutralne (ghost / `#9B89CC`).

**Kolory semantyczne (istniejące, przypisane do znaczeń w tej fazie):**

| Znaczenie | Kolor | Gdzie |
|-----------|-------|-------|
| sukces / OK | `#10D9A0` | status „W grze”, liczba poprawnych wierszy importu, „✓ Kolejność zapisana”, karta importu (`rgba(16,217,160,.04)`, jak dziś) |
| uwaga / oczekiwanie | `#F5C518` | „Koniec testu” na projektorze, status „Brak odpowiedzi”, pasek „Dotknij ekranu…” w Lobby, karta blokady kolejności (`rgba(245,197,24,.06)` / obrys `.3`) |
| konflikt urządzeń | `#FF9A3C` | status „Inny telefon próbuje wejść” (ten sam pomarańcz co timer w LiveView) |
| neutralny | `#9B89CC` | status „W poczekalni”, uchwyt ⠿, opisy |

---

## Kontrakty ekranów (per wymaganie)

### 1. Projektor — „Koniec testu” (P7-PROJ-END) · `src/screens/LiveView.jsx`

- Nowy blok `phase === "ended"`, **1:1 w stylu bloków „Oczekiwanie” / „Przerwa”** (linie 85–112): kontener `textAlign: center`; emoji **🏁** `fontSize: 64, marginBottom: 16`; tytuł **„Koniec testu”** Bebas Neue 48, `letterSpacing: 2`, `#F5C518`; podtytuł **„Dziękujemy! Wyniki za chwilę.”** 16 px, `#9B89CC`, `marginTop: 8`.
- **Bez kodu QR** (QR jest tylko w „Oczekiwanie”, bo zaprasza do dołączenia).
- Nagłówek `LIVE · {city}` zostaje. Licznik „… odp.” się nie pokazuje (dotyczy tylko quiz/reveal, bez zmian).
- Panel audio 🔊 zostaje.
- Kolejność ważności: podium (`podium?.results?.length`) → odliczanie → `ended` → reszta. Ekran trwa do wypchnięcia podium z panelu.
- Korzeń LiveView dostaje atrybut `data-fue-live-phase={phase}` (dla sondy, niewidoczny).
- Wejście: klasa `.fi` (0,3 s). Bez nowych animacji.

### 2. Lobby — pasek „Dotknij ekranu, aby nie gasł” (P7-IOS-WAKE) · `src/screens/Lobby.jsx`

Stan pobierany z kontrolera `src/lib/wakeLock.js` (subskrypcja: `wanted`, `held`, `failed`).

| Stan | Co widać |
|------|----------|
| `held` (blokada natywna albo wideo) | **nic**. Pasek znika (brak toastu „sukces”, żeby nie rozpraszać) |
| `wanted && !held` | stały pasek u dołu ekranu |
| `wanted && !held && failed` (po geście obie drogi zawiodły) | ten sam pasek, treść awaryjna |

Pasek:
- `position: fixed; bottom: 0; left: 0; right: 0; zIndex: 200`, tło `rgba(7,2,21,.96)`, `borderTop: 1px solid rgba(245,197,24,.4)`, padding `12px 16px`, `textAlign: center`. Wzorzec: dolne paski w `Quiz.jsx`.
- Linia 1: 13/700 `#F5C518`: **„💡 Dotknij ekranu, aby nie gasł”**.
- Linia 2: 11/400 `#9B89CC`: **„Telefon nie może się wygasić w trakcie testu.”**
- Cały pasek jest dotykalny (`role="button"`, `aria-label="Dotknij, aby ekran nie gasł"`). Dotknięcie **w dowolnym miejscu ekranu** też uzbraja blokadę (globalny nasłuch `click`/`touchend`/`keydown` w fazie przechwytywania), więc pasek jest tylko podpowiedzią.
- Znikanie: `animation: fi .3s reverse` albo po prostu odmontowanie. Pojawienie się: `cbslide` odwrócony nie jest wymagany, wystarczy `.fi`.
- Gdy pasek jest widoczny, na końcu `.fue-page` dodajemy odstęp `height: 80` (stopka „Forum Uczelni Ekonomicznych” nie może być zasłonięta).
- Treść awaryjna (`failed`): linia 1 **„⚠️ Ekran może się wygasić”**, linia 2 **„Wyłącz tryb oszczędzania energii i nie blokuj telefonu do końca testu.”** Kolor linii 1 zostaje `#F5C518` (to ostrzeżenie, nie błąd).
- Korzeń aplikacji (albo Lobby) dostaje atrybut `data-fue-wake="held|off"` do testów ręcznych i sondy (niewidoczny).
- **Poza Lobby paska nie ma.** W `CodeEntry` blokadę uzbraja kliknięcie „Dołącz do quizu →”, w `Quiz` dotknięcie odpowiedzi (globalny nasłuch). Ekrany intro/odliczanie/pytanie/przerwa/koniec nie dostają nowego UI.

### 3. Kafelki odpowiedzi — nakładka haptyki (P7-IOS-HAPTIC) · `src/screens/Quiz.jsx`

**Kontrakt: zero zmian wizualnych.** Kafelek przed i po zmianie ma wyglądać i reagować identycznie.

- Nakładka `<label aria-hidden="true">` wewnątrz `<button className="ans-btn">`: `position: absolute; inset: 0; zIndex: 1; background: transparent; WebkitTapHighlightColor: "transparent"; touchAction: "manipulation"; cursor: inherit`. Bez obrysu, cienia, radiusa ani fokusu.
- Ukryty przełącznik: `position: absolute; width: 1; height: 1; margin: 0; visibility: hidden` (**nie** `display: none`, **nie** `opacity: 0` na labelu).
- Nakładka istnieje **tylko** gdy `HAS_SWITCH_HAPTICS && !answered && picked === null`. Po wyborze znika, a znaczniki „✔ wybrano” / ✓ / ✗ w prawym górnym rogu działają jak dziś.
- Obszar dotyku = cały kafelek (min. 100 px wysokości, jak dziś). Hover `scale(1.02)` z `.ans-btn` działa dalej, bo label jest dzieckiem przycisku.
- Litera A–D, treść odpowiedzi, kolory `ANSWER_BG`, obrys wyboru (`3px solid rgba(255,255,255,.9)`), pulsowanie zapisu (`pulse 1s`) i dolny pasek „✔ Twoja odpowiedź…” bez zmian.
- Jedno dotknięcie wywołuje `onPick` **dokładnie raz** (`stopPropagation` na przełączniku).
- Android: `navigator.vibrate(15)` bez zmian. Brak haptyki (stary iOS, wyłączona „Haptyka systemowa”) niczego nie pokazuje: bez komunikatu i bez fallbacku wizualnego.

### 4. Wpisywanie kodu (P7-CODE-DASH, P7-CODE-RATE) · `src/screens/CodeEntry.jsx`

Pole (styl bez zmian: `.fue-input`, 22/700, `letterSpacing: 3`, wyśrodkowane):
- `placeholder="KRK-1234"`, `maxLength={10}` (mieści stare `XXX-NNNNNN`), `autoCapitalize="characters"`, `autoCorrect="off"`, `autoComplete="off"`, `spellCheck={false}`, `inputMode="text"`.
- Myślnik dopisuje się sam po 3. literze (`KRK` → `KRK-`). Backspace na `KRK-` daje `KRK`, a nie zapętla myślnika. Wklejenie `krk1111`, `KRK 1111` albo `krk-1111` daje `KRK-1111`.
- Podpowiedź pod nagłówkiem: **„Przykład: KRK-1111”** (zamiast `KRK-482910`).

Stany błędu (ten sam styl co dziś: pole z obrysem `#E8376B` i tłem `rgba(232,55,107,.1)`, tekst 13 px `#E8376B`, wyśrodkowany, klasa `.shake`):

| Sytuacja | Komunikat | Przycisk |
|----------|-----------|----------|
| puste pole | „Wprowadź kod uczestnika.” (bez zmian) | aktywny |
| zły format przed wysłaniem (klient, bez RPC) | „Kod ma postać KRK-1234: 3 litery miasta (np. KRK, WAR), myślnik i 4 cyfry.” | aktywny |
| kod nieznany | „Nie znaleziono kodu. Sprawdź litery i cyfry na karcie od organizatora.” (dziś „Nie znaleziono kodu.”; zmiana w `validateParticipantCode`) | aktywny |
| kod na innym telefonie | „Ten kod jest już używany na innym urządzeniu. Poproś organizatora o jego zwolnienie.” (bez zmian) | aktywny |
| **limit prób** (`reason: "rate_limited"`) | **„Za dużo prób — spróbuj za minutę”** (dosłownie, z półpauzą, bez kropki) | **nieaktywny** z odliczaniem: „Odczekaj {n} s” (n z `retry_after_s`, domyślnie 60). Po zejściu do 0 wraca „Dołącz do quizu →”, a komunikat znika |

- Podczas blokady przycisk ma `opacity: .5`, `cursor: not-allowed`. Pole zostaje edytowalne. Enter nie wysyła.
- Edycja pola czyści komunikat błędu (jak dziś), **ale nie** komunikat limitu, dopóki trwa odliczanie.
- „Sprawdzanie…” w trakcie wywołania bez zmian.

### 5. Admin → Kody: import CSV i pole Kod (P7-CODE-4) · `KodyTab`

**Formularz ręczny** (karta „Generuj kod dla uczestnika”, układ flex jak dziś):
- Trzecie pole po „Nazwisko”: etykieta `C.lbl` **„Kod (opcjonalnie)”**, `minWidth: 120, flex: "0 0 140px"`. Po lewej w polu stały prefiks miasta (np. `KRK-`, 14 px `#9B89CC`, nieedytowalny, w tym samym kontenerze `C.input`), dalej pole na 4 cyfry: `inputMode="numeric"`, `maxLength={4}`, `placeholder="losowy"`, tylko cyfry (inne znaki odrzucane przy wpisywaniu).
- Błędy (13 px `#E8376B`, pod formularzem, jak dziś `err`):
  - „Kod musi mieć 4 cyfry (np. 0042) — albo zostaw pole puste, a numer zostanie wylosowany.”
  - „Kod {KRK-1111} jest już zajęty w mieście {city}.”
- Po sukcesie pola się czyszczą (jak dziś).

**Karta importu** (zielona, jak dziś):
- Opis formatu (11 px, `rgba(155,137,204,.7)`, fragmenty kodu `monospace #C4B5FD`):
  > Format pliku: nagłówek `Imię;Nazwisko;Kod`, potem jeden uczestnik w wierszu (separator: średnik lub przecinek). **Kod** to 4 cyfry bez prefiksu miasta, np. `1111` → `{PREFIX}-1111`. Puste pole = losowy wolny numer. **W Excelu sformatuj kolumnę Kod jako Tekst**, inaczej Excel usunie zera z przodu (`0042` → `42`).
- „📄 Pobierz przykład” → `przyklad_uczestnicy.csv`:
  ```
  Imię;Nazwisko;Kod
  Jan;Kowalski;1111
  Anna;Nowak;0042
  Piotr;Wiśniewski;
  ```
- „Wybierz plik CSV” bez zmian.

**Podgląd po wczytaniu pliku:**
1. Linia podsumowania (13 px `#9B89CC`): „Do importu: **{N}** · Błędy: **{M}**” (N w `#10D9A0`, M w `#E8376B`; gdy M = 0, część „· Błędy” znika).
2. Poprawne wiersze: pierwsze 5 w istniejącym stylu (zielone pigułki), format: `{KRK-1111}` (Bebas Neue 13, `#C4B5FD`) + „Jan Kowalski”. Wiersz z pustym kodem: `{PREFIX}-····` i dopisek „(losowy)” w `#9B89CC`. Dalej „… i {N−5} więcej”, jak dziś.
3. Błędne wiersze: **wszystkie**, w osobnym bloku pod poprawnymi, `maxHeight: 240; overflowY: auto`. Każdy wiersz: tło `rgba(232,55,107,.08)`, obrys `rgba(232,55,107,.25)`, radius 6, padding `4px 8px`, 13 px `#EDE9FE`, powód w `#E8376B`. Format: **„Wiersz {nr}: {Imię Nazwisko} — {powód}”**. `{nr}` to numer linii w pliku (licząc nagłówek jako 1).
   Powody (dokładne brzmienie):
   - „brak imienia lub nazwiska”
   - „kod „{surowy}” musi mieć 4 cyfry”. Gdy komórka ma same cyfry i mniej niż 4, dopisać: „ — jeśli w Excelu zniknęły zera z przodu, sformatuj kolumnę Kod jako Tekst”
   - „kod {KRK-1111} powtarza się w pliku (wiersze {a} i {b})”. Oznaczamy oba wiersze
   - „kod {KRK-1111} jest już zajęty w mieście {city}”
   - „kod {WAR-1111} należy do innego miasta”
4. Pod błędami (11 px `#F5C518`): „Błędne wiersze zostaną pominięte. Popraw je w pliku i wgraj go ponownie albo dodaj te osoby ręcznie.”
5. Przyciski: **„✅ Importuj {N} poprawnych”** (`C.btn("success")`) i **„Odrzuć plik”** (ghost; czyści podgląd, niczego nie importuje). Gdy N = 0: przycisk nieaktywny (`opacity: .5`) i komunikat 13 px `#E8376B`: „Brak wierszy do importu — popraw plik i wgraj ponownie.”
6. W trakcie: „Importuję {i}/{N}…” (bez zmian).
7. Po imporcie (13 px): „Zaimportowano {n}.” (`#10D9A0`). Jeśli wiersz odpadł na wyścigu 23505: dopisać listę w stylu błędów: „Wiersz {nr}: kod {KRK-1111} został zajęty w międzyczasie — dodaj tę osobę ręcznie.”

Lista kodów, liczniki „Wszystkie / Wolne / Użyte” i przyciski 🔓 / ✕: bez zmian. Kody 4- i 6-cyfrowe wyglądają tak samo (Bebas Neue 17).

### 6. Admin → Pytania: zmiana kolejności (P7-Q-REORDER) · `PytaniaTab`

**Karta pytania** (dziś: numer · treść · ✏️ 🗑️). Nowy układ poziomy, `gap: 8`:
`[⠿ uchwyt] [numer] [treść + odpowiedzi] [↑ ↓] [✏️ 🗑️]`

- Uchwyt **⠿**: 16 px `#9B89CC`, `cursor: grab` (`grabbing` w trakcie), `title="Przeciągnij, aby zmienić kolejność"`. Widoczny tylko na komputerze (≥ 900 px). Na telefonie go nie ma, bo HTML5 DnD na iOS jest zawodne.
- Przeciągać można **całą kartę** (`draggable` na karcie) tylko na komputerze.
- ↑ / ↓: `C.btn("ghost", { padding: "4px 10px", fontSize: 13 })`, na telefonie min. 44×44, `aria-label="Przesuń wyżej"` / `"Przesuń niżej"`. Pierwsza karta ma ↑ nieaktywne, ostatnia ↓ nieaktywne. Przyciski zostają w układzie z `opacity: .3` i `disabled`, żeby kolumna się nie przesuwała.
- ✏️ i 🗑️ dostają `aria-label` i `title`: „Edytuj pytanie” / „Usuń pytanie”.
- Na telefonie (< 900 px) przyciski ↑ ↓ ✏️ 🗑️ przechodzą do jednego rzędu pod treścią (`flexWrap`), ↑ ↓ po lewej, ✏️ 🗑️ po prawej.

**Stany przeciągania:**

| Stan | Wygląd |
|------|--------|
| karta przeciągana | `opacity: .4` |
| karta pod kursorem (cel) | obrys `rgba(107,33,232,.6)` + linia 2 px `#6B21E8` (`boxShadow: "0 -2px 0 #6B21E8"` nad kartą albo `"0 2px 0 #6B21E8"` pod nią, zależnie od połowy karty) |
| po upuszczeniu | lista od razu w nowej kolejności (optymistycznie), numery 1..n przeliczone |
| przeciąganie poza listę / Esc | powrót do stanu sprzed przeciągania, bez zapisu |

**Opis nad listą** (zawsze, 11 px `rgba(155,137,204,.7)`, `marginBottom: 12`):
> „Przeciągnij pytanie (komputer) albo użyj ↑/↓, żeby zmienić kolejność w module. Zmiana kolejności działa od następnego startu.”

**Informacja o zapisie** (13 px, w tej samej linii co opis, wyrównana do prawej, `aria-live="polite"`):
- w trakcie: „Zapisuję kolejność…” `#9B89CC`; ↑/↓ i przeciąganie nieaktywne do końca zapisu,
- sukces: „✓ Kolejność zapisana” `#10D9A0`, znika po 2 s,
- błąd: „Nie udało się zapisać kolejności — przywrócono poprzednią. Spróbuj ponownie.” `#E8376B`, zostaje do następnej akcji; lista wraca do stanu sprzed zmiany.

**Blokada w trakcie quizu** (sesja miasta dla tej samej puli ma status `running` albo `paused`):
- Nad listą karta: tło `rgba(245,197,24,.06)`, obrys `rgba(245,197,24,.3)`, padding `12px 16px`, 13 px `#F5C518`:
  **„🔒 Quiz w mieście {city} trwa. Zmiana kolejności działa od następnego startu, dlatego jest zablokowana do końca quizu.”**
- Uchwyty ukryte, `draggable={false}`, ↑/↓ `disabled` z `opacity: .3` i `title="Zablokowane w trakcie quizu"`. ✏️ / 🗑️ i dodawanie pytań zachowują się jak dziś (poza zakresem).
- Pytania próbne: blokada tylko wtedy, gdy trwa sesja próbna; w przeciwnym razie przestawianie dozwolone.

Po przestawieniu numery na plakietkach odpowiadają kolejności planu kolejnego startu. Liczniki w przyciskach modułów bez zmian.

### 7. Admin → Sesja: lista uczestników „kto utknął” (P7-ADMIN-STUCK) · `SesjaTab`

**Miejsce:** zastępuje siatkę „Uczestnicy ({N})” (dziś ~1249–1269) w statusach `waiting`, `running`, `paused`. Karta „👥 W poczekalni — N online” (tylko `waiting`) zostaje bez zmian nad nią. W `ended`/`results` lista się nie pokazuje (tam są „Wyniki końcowe”).

**Karta** `C.card({ padding: "16px", marginBottom: 16 })`:
- Nagłówek (Label 11/700 uppercase `#9B89CC`): **„👥 Uczestnicy — {N}”**. Po prawej przycisk-przełącznik ghost `fontSize: 11, fontWeight: 700, padding: "4px 10px"` (typografia jak nagłówek karty, padding jak małe przyciski KodyTab): **„Tylko problemy”** / **„Pokaż wszystkich”**. Domyślnie w `running`/`paused`: **Tylko problemy** włączone; w `waiting`: wyłączone.
- Pod nagłówkiem pigułki podsumowania (11/700, radius 20, padding `2px 10px`, tło = kolor stanu z alfą `.12`, tekst w kolorze stanu), tylko dla stanów z licznikiem > 0: „W grze {n}”, „Brak odpowiedzi {n}”, „Rozłączeni {n}”, „Inny telefon {n}”, „W poczekalni {n}”.
- Podpis 11 px `rgba(155,137,204,.7)`: „Stan po ostatnim zamkniętym pytaniu — odświeża się co pytanie.” (w `waiting`: „Stan poczekalni na żywo.”)

**Wiersz** (flex, `gap: 8`, padding `8px 12px`, radius 8, tło `rgba(255,255,255,.03)`, obrys w kolorze stanu z alfą `.25` dla stanów problemowych, `rgba(255,255,255,.06)` dla pozostałych; odstęp między wierszami 4 px):
`[kropka 8px w kolorze stanu] [kod Bebas Neue 13 #C4B5FD, minWidth 76] [imię i nazwisko 13/400 #EDE9FE, flex 1, ellipsis] [status 11/700 w kolorze stanu] [🔓]`
- Na telefonie status schodzi pod nazwisko (`flexWrap`), 🔓 zostaje po prawej.
- Kropka pulsuje (`pulse 1.5s`) tylko dla „W grze” i „W poczekalni”.
- Lista: `maxHeight: 360; overflowY: auto`.
- Sortowanie: najpierw „Inny telefon próbuje wejść”, potem „Rozłączony”, „Brak odpowiedzi”, dalej reszta; w każdej grupie po kodzie rosnąco.

**Stany** (z `classifyParticipant` w `src/lib/roster.js`):

| Stan | Etykieta w wierszu | Kolor | Problem? |
|------|--------------------|-------|----------|
| `lobby` | „W poczekalni” | `#9B89CC` | nie |
| `online` / `answered` | „W grze” | `#10D9A0` | nie |
| `no_answer` | „Brak odpowiedzi na bieżące pytanie” (na telefonie skrót „Brak odpowiedzi”) | `#F5C518` | tak |
| `disconnected` | „Rozłączony” | `#E8376B` | tak |
| `conflict` | „Inny telefon próbuje wejść · {n} min temu” | `#FF9A3C` | tak |

**Przycisk 🔓** w każdym wierszu: `C.btn("ghost", { padding: "4px 10px", fontSize: 12 })`, telefon min. 44×44, `title="Zwolnij kod z telefonu (zmiana urządzenia)"`, `aria-label="Zwolnij kod {KOD}"`.
- Kod bez przypiętego telefonu: przycisk `disabled`, `opacity: .3`, `title="Kod nie jest przypięty do telefonu"`.
- Kliknięcie → `confirm()` (wzorzec z KodyTab):
  **„Zwolnić kod {KOD} ({Imię Nazwisko}) z telefonu? Uczestnik wpisze ten sam kod na innym urządzeniu.”**
- Po potwierdzeniu: `releaseCode(id)` i przeładowanie listy. Przy błędzie `alert("Nie udało się zwolnić kodu: {błąd}. Spróbuj ponownie.")`.

**Puste stany:**
- Nikt nie dołączył: 13 px `rgba(155,137,204,.5)`: „Nikt jeszcze nie dołączył. Uczestnicy pojawią się tu po wpisaniu kodu na telefonie.”
- Filtr „Tylko problemy” i brak problemów: 13 px `#10D9A0`: „✓ Wszyscy uczestnicy są w grze.”

### 8. Średni czas — 2 miejsca (P7-AVG-2DP)

- Lista „Wyniki końcowe” w SesjaTab (~1311): `⏱ {(ms/1000).toFixed(2).replace(".", ",")} s`, np. **„⏱ 12,35 s”**. Brak czasu: „—” (bez zmian). Reszta wiersza bez zmian.
- Podpis „Przy równej liczbie pkt decyduje krótszy średni czas.” zostaje (reguła rankingu bez zmian).
- XLSX: komórki „Śr. czas (s)” (Ranking) i „Czas (s)” (odpowiedzi, karta uczestnika) jako **liczby** z formatem `0.00` (Excel z polskimi ustawieniami pokaże „12,35”). Nie tekst.
- CSV i podium: już 2 miejsca, bez zmian.

### 9. XLSX — naruszenia (P7-VIOL-REPORT) · `src/lib/resultsXlsx.js` (tylko treść)

- Arkusz **Ranking**: nowa kolumna **„Naruszenia”** na końcu, po „Śr. czas (s)”. Wartość = liczba całkowita, uczestnik bez naruszeń = **0** (nie puste).
- **Karta uczestnika**: po wierszu „Bez odpowiedzi” trzy wiersze (kolumna A etykieta, B liczba):
  1. **„Naruszenia łącznie”**
  2. **„Wyjście z aplikacji / wygaszenie ekranu”**
  3. **„Próba zrzutu ekranu”**
- Etykiety typów (jedno źródło, `VIOLATION_LABELS` w `src/lib/violations.js`): `tab_switch` → „Wyjście z aplikacji / wygaszenie ekranu”, `screenshot_attempt` → „Próba zrzutu ekranu”.
- Opcjonalnie (Claude's discretion, domyślnie **tak**): te same etykiety w bloku „⚠️ Naruszenia regulaminu” i w toaście naruszenia w SesjaTab, zamiast dzisiejszych „Zmiana zakładki” / „Screenshot”. Jedna nazwa zjawiska w panelu i w raporcie.

---

## Copywriting Contract

| Element | Tekst |
|---------|-------|
| Główne CTA (uczestnik) | „Dołącz do quizu →” (bez zmian; w trakcie limitu: „Odczekaj {n} s”) |
| Główne CTA (admin, import) | „✅ Importuj {N} poprawnych” |
| Główne CTA (admin, ręcznie) | „🎟️ Generuj kod” (zamiast „🎟️ Generuj”) |
| Odrzucenie podglądu importu | „Odrzuć plik” (zamiast „Anuluj”) |
| Ekran projektora po teście | „Koniec testu” / „Dziękujemy! Wyniki za chwilę.” |
| Pasek wake lock | „💡 Dotknij ekranu, aby nie gasł” / „Telefon nie może się wygasić w trakcie testu.” |
| Pasek wake lock (awaria) | „⚠️ Ekran może się wygasić” / „Wyłącz tryb oszczędzania energii i nie blokuj telefonu do końca testu.” |
| Pusty stan: roster | „Nikt jeszcze nie dołączył. Uczestnicy pojawią się tu po wpisaniu kodu na telefonie.” |
| Pusty stan: roster, filtr | „✓ Wszyscy uczestnicy są w grze.” |
| Pusty stan: import | „Brak wierszy do importu — popraw plik i wgraj ponownie.” |
| Błąd: limit prób | „Za dużo prób — spróbuj za minutę” (dosłownie, z CONTEXT) |
| Błąd: format kodu | „Kod ma postać KRK-1234: 3 litery miasta (np. KRK, WAR), myślnik i 4 cyfry.” |
| Błąd: wiersz CSV | „Wiersz {nr}: {Imię Nazwisko} — {powód}” (powody w §5) |
| Błąd: zapis kolejności | „Nie udało się zapisać kolejności — przywrócono poprzednią. Spróbuj ponownie.” |
| Informacja: kolejność | „Zmiana kolejności działa od następnego startu.” |
| Blokada: kolejność | „🔒 Quiz w mieście {city} trwa. Zmiana kolejności działa od następnego startu, dlatego jest zablokowana do końca quizu.” |
| Potwierdzenie destrukcyjne: 🔓 z rostera | Zwolnij kod: „Zwolnić kod {KOD} ({Imię Nazwisko}) z telefonu? Uczestnik wpisze ten sam kod na innym urządzeniu.” (`confirm()`) |
| Potwierdzenie destrukcyjne: 🔓 w KodyTab | bez zmian: „Zwolnić kod z urządzenia? Będzie mógł wejść z innego telefonu.” |

Akcje destrukcyjne w tej fazie: **tylko 🔓 (zwolnienie kodu)** z nowego rostera. Import CSV nie nadpisuje ani nie usuwa istniejących kodów, a zmiana kolejności jest odwracalna (↑/↓), więc nie wymagają potwierdzenia.

Styl tekstów: polski, zdania z kropką, poza dosłownym komunikatem limitu (bez kropki, jak w CONTEXT). Półpauza „—” jako separator, jak w istniejącym UI. Liczby dziesiętne z przecinkiem.

---

## Interakcje i dostępność (przekrojowo)

- `prefers-reduced-motion`: istniejąca reguła w `global.css` wyłącza animacje. Nowe elementy nie mogą polegać na animacji, żeby przekazać stan (kolor i tekst zawsze obecne).
- Komunikaty zmieniające się bez akcji użytkownika (zapis kolejności, odliczanie limitu, pasek wake lock) mają `aria-live="polite"`. Błędy formularzy: `role="alert"`.
- Stanu nie przekazuje sam kolor: każdy status rostera ma etykietę tekstową, każdy błędny wiersz ma powód.
- Nowe przyciski są prawdziwymi `<button>` (fokus z klawiatury). Wyjątek: nakładka haptyki (`aria-hidden`, poza kolejnością fokusu, bo przycisk-rodzic dalej jest fokusowalny).

---

## Registry Safety

| Registry | Użyte bloki | Bramka bezpieczeństwa |
|----------|-------------|-----------------------|
| none (projekt bez shadcn i bez rejestrów komponentów) | — | nie dotyczy |

Zewnętrzny kod: tylko plik mp4 jako data URI z NoSleep.js (MIT, 3753 B). To zasób multimedialny, nie komponent UI. Notka licencyjna zostaje w komentarzu `src/lib/wakeLock.js` (07-RESEARCH.md). Żadnych nowych pakietów npm.

---

## Pochodzenie decyzji

| Źródło | Użyte decyzje |
|--------|---------------|
| 07-CONTEXT.md | 11: ekran „Koniec testu” (emoji, teksty, kolory, czas trwania do podium), format kodu i prefiksy, auto-myślnik i zachowanie backspace/wklejania, dosłowny komunikat limitu, format CSV + przykład + wskazówka Excela, pole Kod opcjonalne, etykiety naruszeń, 2 miejsca średniej, DnD + ↑/↓, komunikat „od następnego startu”, statusy rostera + 🔓 z potwierdzeniem |
| 07-RESEARCH.md | 9: pasek „Dotknij ekranu” tylko w Lobby i przy `!held`, nakładka `<label>` (warunki, `visibility:hidden`), atrybuty pola kodu i placeholder `KRK-1234`, wszystkie błędy wierszy + numer linii, blokada przestawiania w `running`/`paused`, stany `classifyParticipant`, filtr „tylko problemy”, format `0.00` w XLSX, `data-fue-live-phase` |
| Kod (tokeny `C`, `W`, `global.css`, LiveView/Lobby/Quiz/KodyTab/SesjaTab) | cała warstwa wizualna: kolory, karty, przyciski, typografia, wzorce pasków i list |
| Claude's discretion (domyślne) | odliczanie „Odczekaj {n} s”, treść awaryjna paska wake lock, znikanie paska bez toastu, domyślny stan filtra, sortowanie rostera, kolor `#FF9A3C` dla konfliktu, uchwyt ⠿ tylko na komputerze, ujednolicenie etykiet naruszeń w panelu |
| Pytania do użytkownika | 0 (subagent bez interakcji) |

---

## Checker Sign-Off

- [ ] Wymiar 1 Copywriting: PASS
- [ ] Wymiar 2 Visuals: PASS
- [ ] Wymiar 3 Color: PASS
- [ ] Wymiar 4 Typography: PASS
- [ ] Wymiar 5 Spacing: PASS
- [ ] Wymiar 6 Registry Safety: PASS

**Approval:** pending
