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
