---
quick_id: 260902-lp2
description: Naprawy po audycie obciążeniowym + 5 zadań użytkownika
date: 2026-09-02
branch: fix/audyt-obciazeniowy-260902
status: done
tests: 48 passed (było 23)
build: ok
---

# Quick Task 260902-lp2 — Podsumowanie

## Commity

| Hash | Zakres |
|---|---|
| `4bcb1c2` | SQL sekcja 37 — Realtime, indeks, seed modułów, RPC eksportu |
| `d717988` | Interwały polli 167 → 25 zapytań/s |
| `392bed8` | Debounce naruszeń, rewrite SPA |
| `27a5622` | Ukrycie zakładki Harmonogram |
| `2370ca5` | Uczestnik przestaje sterować przejściem pytania (+ migotanie) |
| `6994860` | Własny zapis .xlsx bez zależności |
| `5d76829` | Admin kierowcą, auto-skip, moduły, eksport XLSX |

## Efekt liczbowo

| Faza | Przed | Po |
|---|---|---|
| Poczekalnia (20–30 min) | 133 zapytań/s | ~40 |
| Przerwa / czekanie na podium | 200 zapytań/s | ~32 |
| Przejście pytania (szczyt) | ~2000 zapytań / ~700 na s | ~2 zapytania |
| Zegar serwera (stałe tło) | 33 zapytań/s | 7 |

Piku 500 równoczesnych wywołań `advance_session_question` serializowanych na
blokadzie jednego wiersza `quiz_sessions` — nie ma już wcale przy normalnym
przebiegu (fallback z jitterem odpala się tylko, gdy admin faktycznie milczy).

## Zgłoszenia użytkownika

1. **Auto-skip / auto-przejście** — dwie przyczyny. (a) plateau wymagało `total > 0`,
   więc pytanie bez odpowiedzi zawieszało quiz; kierowca admina nie patrzy już na
   liczbę odpowiedzi. (b) próg „wszyscy odpowiedzieli" liczony był względem liczby
   **wydanych kodów** — kody-widma trwale go zawyżały, więc warunek nie odpalał się
   nigdy. Teraz progiem jest realna frekwencja z poprzednich pytań (samo się kalibruje).
2. **Moduły nie do edycji** — dwie niezależne usterki: rozjazd kluczy snake_case
   vs camelCase (gubił czas i opis) oraz pusta tabela `modules` → UPDATE w 0 wierszy
   bez błędu. Plus `save()` w końcu pokazuje błąd. Zakładka tylko dla superadmina.
3. **Harmonogram** — ukryty za `SHOW_HARMONOGRAM = false`, kod sekcji nietknięty.
4. **Indywidualne podsumowania w Excelu** — arkusz per uczestnik + ranking + płaska
   tabela. Własny generator .xlsx zamiast SheetJS (patrz „Odstępstwa").
5. **Migotanie pytania podczas 3-2-1** — ta sama przyczyna co #1 audytu: ścieżka
   przegranego wyścigu ustawiała `qIdx` przy `qStartedAtRef === null`, więc render
   pokazywał następne pytanie zanim dotarł znacznik z przyszłości. Znika z konstrukcji.

## Odstępstwa od planu

**T6 — SheetJS odrzucony po instalacji.** Plan i ustalenie z użytkownikiem zakładały
dodanie zależności `xlsx`. Po instalacji okazało się, że paczka z npm (0.18.5) ma dwa
otwarte advisory o wysokiej wadze (prototype pollution, ReDoS) i **nie ma na npm wersji
z poprawką** — SheetJS przeniósł wydania na własny CDN, więc `npm audit fix` tego nie
zamknie. Oba dotyczą parsowania cudzych plików, czego ten kod nie robi, ale wnoszenie
tego do projektu po audycie bezpieczeństwa to dług nie do spłacenia. Zamiast tego
~190 linii własnego generatora (`src/lib/xlsx.js`), zgodnego z zasadą projektu
„wszystko własne, bez bibliotek". Zależności repo bez zmian.

**Ekran `module_intro` przestał być ścieżką produkcyjną.** Przejście przez granicę
modułu obsługuje teraz lead 30 s od admina → `ModuleIntroFS`, który jest
zsynchronizowany z Live View. Lokalny `ModuleIntro` zostaje wyłącznie dla ścieżki
awaryjnej (sesja bez `q_started_at`) i DEMO.

**Commity nie są 1:1 z zadaniami.** `AdminPanel.jsx` i `supabase.js` są dotknięte
przez trzy zadania naraz, a rozdzielenie wymagałoby `git add -p` (interaktywne,
niedostępne). Zgrupowane po granicach plików.

## Weryfikacja

- `npx vitest run` — **48/48** (było 23; +12 dla sterowania przejściem, +13 dla .xlsx)
- `npm run build` — przechodzi; chunk `xlsx` 4,95 kB, ładowany dynamicznie
- Generator .xlsx sprawdzony **niezależnym czytnikiem** (`python zipfile`) na próbce
  201 arkuszy × 58 pytań: wszystkie CRC OK, 206 wpisów, 201 arkuszy w `workbook.xml`,
  2,57 MB, sharedStrings zdusiło 11 600 komórek do 19 unikalnych ciągów

## NIE zweryfikowane — wymaga człowieka

- **Przebieg na żywo z dwoma klientami.** Zmiana sterowania przejściem pytania to
  najbardziej inwazyjna rzecz w tej paczce i nie da się jej sprawdzić testem
  jednostkowym. Przed konferencją: sesja próbna, dwa telefony, przejście przez
  granicę modułu, pauza/wznowienie w środku pytania, reconnect po odświeżeniu.
- **Sekcja 37 SQL nie została wgrana** na żaden projekt Supabase. Bez niej działa
  stary kod, ale nie znika ani lawina Realtime, ani przyczyna usterki modułów.
- **Eksport XLSX na realnych danych** — testowany na danych syntetycznych.
  Excel z 500 zakładkami otwiera się wolno; arkusz „Wszystkie odpowiedzi" jest
  praktyczniejszy do pracy, karty per osoba do wydania uczestnikowi.

## Poza zakresem (świadomie)

- **B1 audytu** — plan Pro + podniesienie limitu połączeń do 800. Decyzja zakupowa,
  długi czas realizacji, jedyna pozycja której nie da się załatwić kodem.
- **M3 audytu** — zawężenie `GRANT ALL ON ALL TABLES TO authenticated`. Zmiana
  uprawnień tuż przed eventem to większe ryzyko niż sam problem.
- **M2 audytu** — realistyczny test obciążeniowy na 500 botach. Wymaga stagingu
  i 3 maszyn; `load-runner.js` nadal steruje driverem serwisowym, więc po tej
  zmianie mierzy jeszcze mniej realnej ścieżki niż wcześniej.
