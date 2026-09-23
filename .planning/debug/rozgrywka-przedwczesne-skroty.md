# Debug: rozgrywka — przedwczesne skróty pytań i rozjazd czasu host/telefon

**Data:** 2026-09-23
**Status:** ROOT CAUSE FOUND
**Regresja z:** `5d76829` (02.09.2026) — „Admin kierowca przejścia pytania"

## Objawy (zgłoszone)

- czasy rozjeżdżają się między telefonem a hostem
- quiz nagle staje albo przeskakuje pytanie
- finał za ~miesiąc, obecny stan niedopuszczalny

## Co WYKLUCZONO pomiarem

| Podejrzenie | Wynik |
|---|---|
| Publikacja Realtime | ✅ poprawna (`quiz_sessions` jest, `answers` nie) |
| `postgres_changes` martwe (problem z 02.09) | ✅ **naprawione** — dociera w 672 ms |
| Broadcast | ✅ 58 ms między klientami |
| Rozrzut `server_now` | ✅ 66 ms na 6 próbkach — zegar nie jest źródłem |
| `MODULES` niestabilne → przebudowa interwału kierowcy | ✅ odpada, `modules` siedzi w `useState` |
| Zmiany w kodzie po moim merge | ✅ brak, `44e3627` to HEAD |

## ROOT CAUSE 1 — runaway auto-skipu (krytyczny)

`AdminPanel.jsx` ~670. Próg „wszyscy odpowiedzieli" to `expectedRef` = maksimum
liczby odpowiedzi z POPRZEDNICH pytań. Wprowadziłem to 02.09 jako odporność na
kody-widma. Problem: **próg zapamiętuje liczbę z pytania, które samo zostało
przedwcześnie ucięte** — i zamyka się pętla dodatnia.

Symulacja (`shouldAdvance` i `REVEAL_SECONDS` z prawdziwego `gameLogic.js`,
zegar wirtualny, logika kierowcy skopiowana 1:1):

**A. Wasz test — 3 telefony, pytanie 60 s**
```
pyt.1: TRWAŁO 10s z 60s   (skrót po 4s: countReached, 3/3, próg=3)
pyt.2: TRWAŁO 10s z 60s
pyt.3: TRWAŁO 10s z 60s
pyt.4: TRWAŁO 10s z 60s
```
Każde 60-sekundowe pytanie trwa 10 sekund. To jest dokładnie to „przeskakiwanie",
które widzicie na testach.

**B. Realne 500 osób — pierwsze pytanie ma zastój po szybkich odpowiedziach**
```
pyt.1: TRWAŁO 18s z 60s   (plateau 8s przy 60/500 odpowiedzi)
pyt.2: TRWAŁO 10s z 60s   (countReached, próg=60)
pyt.3: TRWAŁO 10s z 60s   (próg=60)
pyt.4: TRWAŁO 10s z 60s   (próg=60)
pyt.5: TRWAŁO 10s z 60s   (próg=60)
```
**440 z 500 uczestników nigdy nie zdąży odpowiedzieć na żadne pytanie poza pierwszym.**
Wystarczy jedna 8-sekundowa cisza na pierwszym pytaniu — a to jest normalne, bo
szybcy odpowiadają w pierwszych sekundach, a wolniejsi po kilkunastu.

Dwa niezależne wyzwalacze, oba za ostre:
- `plateau` 8 s ciszy → 8 s bez nowej odpowiedzi w środku pytania to norma, nie sygnał
- `countReached` bez ŻADNEJ dolnej granicy czasu pytania

## ROOT CAUSE 2 — cofanie `q_started_at` zależy od zgody obu stron co do `timePerQ`

`goToNextQuestion` cofa znacznik o `curQuestionTimePerQ`, liczone z **`session`
(stan React)**, podczas gdy kierowca liczy `tpq` z `sessionRef`. Uczestnik kończy
pytanie tylko gdy `elapsed >= modTimePerQRef.current`. Jeśli admin cofnie o mniej
niż uczestnik oczekuje, **żadna gałąź `handleUpdate` nie zadziała** — uczestnik
liczy dalej ze starym znacznikiem i przeskakuje dopiero, gdy 6 s później admin
przesunie pytanie. To jest objaw „zatrzymuje się i przeskakuje".

## ROOT CAUSE 3 — podgląd Live w panelu nie dostaje własnego broadcastu

Zmierzone na produkcji: `broadcast do SIEBIE (self) = BRAK` (domyślne `self:false`).
Panel admina rozgłasza przejście na `quiz-<id>`, ale jego własny wbudowany
`LiveTab` tego nie odbiera — zostaje mu `postgres_changes` (~670 ms) i **własny
poll co 5 s**. Stąd „czasy rozjeżdżają się u hosta": telefon dostaje zmianę
w ~58 ms, host nawet do 5 s później.

## Znalezisko poboczne (blokuje przygotowania)

**Staging nie istnieje** — `iaehipybmcxrvgyfmcfr.supabase.co` → DNS `ENOTFOUND`.
Cały harness Playwright (`playwright.config.js` wskazuje na klucze `*_STAGE`)
jest dziś nieuruchamialny, więc nie ma gdzie przećwiczyć finału poza produkcją.

## Naprawy

1. Dolna granica czasu pytania przed jakimkolwiek skrótem + plateau 8 s → 12 s
   + próg frekwencji odporny na zatrucie
2. `goToNextQuestion` dostaje `tpq` od kierowcy (jedno źródło), koniec rozjazdu
3. Poll projekcji w embedzie admina 5 s → 1 s
4. Re-sync zegara po powrocie karty na pierwszy plan (telefon po odblokowaniu)
5. Logika decyzyjna wyniesiona do czystych funkcji + testy regresyjne z symulacji

---

## Rekalibracja pod docelowy format (23.09, po informacji od użytkownika)

Pytania TWE mają trwać **maksymalnie 20 s**, nie 60–90 s. To unieważniło pierwszą
kalibrację: podłoga „min 20 s" równała się całemu czasowi pytania, więc skrót
nigdy by się nie odpalił.

Podłoga jest teraz proporcjonalna (60% czasu modułu, dolne 8 s), a plateau skaluje
się z czasem pytania. Pomiar przy 20 s:

| Scenariusz | Trwanie pytania | Oszczędność ze skrótu |
|---|---|---|
| 3 telefony | 18 s z 20 s | 2 s |
| 500 osób | 23 s (z reveal) | 3 s |

**Wniosek: przy 20-sekundowych pytaniach auto-skrót oszczędza 2–3 s.** Za taką
oszczędność nie warto płacić ryzykiem ucięcia komuś odpowiedzi, więc jest
bramkowany progiem `AUTO_SKIP_MIN_TPQ = 45`. Przy 20 s jest wyłączony, przy
90-sekundowych obliczeniach nadal działa. Prowadzący ma ręczny przycisk zawsze.

## Status: ROZWIĄZANE (czeka na weryfikację na urządzeniach)

Testy 58/58. Niezweryfikowane: przebieg na realnych telefonach — brak środowiska
testowego (staging usunięty, brak miejsca na planie Free, brak Dockera na maszynie).

---

## ROOT CAUSE 4 — socket Realtime uczestnika umierał po wyjściu z poczekalni

Znalezione 23.09 sondą Playwright z podsłuchem ramek WebSocket, na **buildzie
produkcyjnym** (nie dev — StrictMode wykluczony osobnym przebiegiem).

```
-5.9s  SOCKET-OPEN    wss://...supabase.co/realtime/v1/websocket
 0.3s  BROADCAST      quiz_event          <- start quizu dociera
 0.7s  POSTGRES_CHANGES                   <- zmiana sesji dociera
 0.9s  SOCKET-CLOSE                       <- i koniec, 17 ramek łącznie
```

Po starcie quizu socket uczestnika zamykał się i **nigdy nie wracał**. Od tej chwili
telefon żył wyłącznie z polla awaryjnego co 10 s. Stąd mierzone zachowanie:

```
30.2s  host[q=1]  tel[q=1 t=0]    koniec czasu pytania 1
40.7s  host[q=2]  tel[q=1 t=0]    host już na pytaniu 2
44.2s  host[q=2]  tel[q=2 t=17]   telefon wskakuje 3 s PO starcie
```

Telefon stał 14 s na zerze, po czym wpadał w kolejne pytanie w locie, tracąc 3 z 20
sekund. To jest zgłaszane „zatrzymuje się i przeskakuje" — i jednocześnie źródło
„rozjazdu czasów", bo host był poprawny, a spóźniał się telefon.

**Mechanizm:** wyjście z poczekalni odmontowuje `Lobby`, które woła `removeChannel`
dla swoich kanałów. supabase-js rozłącza socket, gdy lista kanałów się opróżni, a raz
rozłączony socket sam nie wraca — kanał quizu zostawał martwy mimo poprawnej subskrypcji.

**Naprawa:** dozorca w `App.jsx` sprawdza co 3 s stan kanału i przy stanie innym niż
`joined`/`joining` odtwarza go (`supabase.realtime.connect()` + ponowny `subscribe`)
oraz dociąga stan z bazy. Generyczna, bo na sali to samo zrobi zanik wifi lub
przełączenie na LTE.

### Pomiar kontrolny na tym samym buildzie

| Metryka | Przed | Po |
|---|---|---|
| Czas trwania pytań (20 s + 6 s reveal) | 33,6 / 30,0 / 20,6 s | **26,3 / 26,9 / 26,1 s** |
| Rozjazd host vs telefon | 7,2% próbek, do 3,4 s | **0,0%, 0 ms** |
| Rozjazd timera telefon1 vs telefon2 | — | **max 1 s (3 próbki)** |
| Wejście w pytanie 2 | t=17 (strata 3 s) | **t=20** |
| Najdłuższy czas bez zmiany pytania | 33,6 s | 26,9 s (limit 35 s) |

Hipotezy ODRZUCONE pomiarem po drodze (żeby nikt do nich nie wracał):
- filtr `city=eq.Kraków` z polskimi znakami — działa, 532 ms
- nazwa kanału z polskimi znakami — działa, 725 ms
- kanał z dwoma bindingami (broadcast + postgres_changes) — działa, 579/277 ms
- dławienie timerów w kartach w tle — objaw identyczny z wyłączonym dławieniem

---

## Domknięcie: przyczyna usunięta, sonda w repo (23.09)

Obejście (dozorca odtwarzający kanał) zastąpione **usunięciem przyczyny**: jeden
kanał `fue-keepalive` subskrybowany raz na całe życie aplikacji sprawia, że lista
kanałów nigdy nie schodzi do zera, więc supabase-js nie ma powodu rozłączać socketu.
Dozorca zostaje jako druga linia obrony na realne zaniki sieci.

Pomiar po naprawie (`npm run sonda`, build produkcyjny, produkcja):

```
⏱️  pyt.1: 25.9s ✅   pyt.2: 26.8s ✅        (oczekiwane 26s = 20s + 6s)
🖥️  Host vs telefon: 0.0% rozbieżnych, 0 ms ✅
📱 Telefon vs telefon: maks. 1s ✅
🧊 Bez zmiany pytania: 26.8s (limit 34s) ✅
🔌 Socket: 1× otwarcie, 0× ZAMKNIĘCIE, 31 ramek ✅
```

Sonda dodana do repo jako `scripts/probe-gameplay.js` + `npm run sonda`, z progami
i kodem wyjścia — nadaje się na bramkę przed wydarzeniem. Opis w TESTING.md.
