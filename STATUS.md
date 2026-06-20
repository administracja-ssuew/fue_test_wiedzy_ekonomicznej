# TWE Quiz App — status na konferencję

**Stan na:** 13.06.2026 · **Cel skali:** ~500 uczestników (5 uczelni × ~100) · **Stack:** React 18 + Vite (PWA) + Supabase (PostgreSQL · Auth · Realtime · Storage)

> **Werdykt:** aplikacja jest funkcjonalnie i wydajnościowo gotowa. Wszystkie zautomatyzowane zestawy testów przechodzą, synchronizacja czasu działa co do sekundy, zmierzona skala to 200 jednoczesnych połączeń bez błędów (maksimum darmowego planu).

---

## 📊 Projekt w liczbach

| Metryka | Wartość |
|---|---|
| Ekrany aplikacji (`src/screens/`) | **15** |
| Funkcje warstwy danych (Supabase API) | **48** |
| Funkcje bazy (SQL, SECURITY DEFINER) | **35** |
| Miasta / uczelnie | **5** |
| Moduły quizu | **5** |
| Komponenty współdzielone / hooki | 3 / 6 |
| Zautomatyzowane zestawy testów | **12** komend |

---

## ✅ Wyniki testów (raporty)

| Zestaw | Co sprawdza | Wynik |
|---|---|---|
| **Jednostkowe** (`npm test`) | scoring, timer, projekcja faz, offset zegara | ✅ **27 / 27** |
| **Boty E2E** (`npm run bot`) | pełny przepływ: dołączenie → 58 pytań → ranking → sprzątanie | ✅ **27 / 27** |
| **Przeglądarka E2E** (Playwright) | uczestnik + Live View sync + lock-in odpowiedzi | ✅ **3 / 3** |
| **Bezpieczeństwo RLS** (`npm run rls`) | anon nie czyta odpowiedzi/kodów; RPC admina zablokowane | ✅ **14 / 14** granic |
| **Obciążenie** (`npm run load`) | jednoczesne połączenia, osobny WebSocket każdy | ✅ **do 200**, 0 błędów |
| **Zegar serwera** (`verify-clock`) | wspólna sekunda na wszystkich ekranach | ✅ rozjazd **0 s** po korekcie |
| **Realtime / re-join** (`verify-realtime`, `verify-mark`) | instant-push, licznik X/N nie zacina się | ✅ OK |

*Źródło: audyt przedprodukcyjny 08.06.2026 + ponowny przebieg jednostkowych 13.06.2026.*

---

## ⚡ Obciążenie i skala (pomiar)

| Wskaźnik | Wynik | Próg |
|---|---|---|
| Jednoczesne połączenia Realtime | **200 / 200** bez błędów | — |
| Latencja „Start → uczestnik widzi pytanie" (p95) | **591 ms** | < 1500 ms ✅ |
| Latencja p50 / p99 / max | 276 / 620 / 624 ms | — |
| Zapisy odpowiedzi | **724**, 0 duplikatów, 0 błędów | — |
| Równoczesne przejścia pytania (50 wywołań) | **dokładnie 1** wygrane (exactly-once) | brak podwójnych skoków |
| Latencja p95 od 20 do 200 osób | **płaska ≈0,6 s** | architektura liniowa |

**Skala docelowa 500:** plan darmowy Supabase = **200** połączeń, plan Pro = **500**.
Pomiar realny do 200 osób; **300 / 400 / 500 to projekcja modelowa**. Wąskim gardłem są **połączenia**, nie kod — dla 500 osób: plan Pro + wniosek o podniesienie limitu połączeń.

---

## 🔐 Bezpieczeństwo i integralność

- **Walidacja odpowiedzi po stronie serwera** — poprawność liczona w bazie, poprawna odpowiedź (`ans`) ukryta przed klientem (sekcje SQL 29–34, wdrożone po audycie).
- **Wiązanie kodu z urządzeniem** — jeden kod = jedno urządzenie (anty-współdzielenie).
- **Anti-cheat** — wykrywanie przełączania kart / zrzutów ekranu logowane do admina w czasie rzeczywistym.
- **Higiena sekretów** — `.env` poza repozytorium, brak kluczy w kodzie (grep czysty).
- Egzamin **stacjonarny z nadzorem** na 5 uczelniach jako dodatkowa warstwa.

---

## 🚧 Do uzupełnienia przed wydarzeniem (treści, nie kod)

| # | Element | Stan |
|---|---|---|
| 1 | Data i godzina startu testu | zaślepka 2026-10-01 |
| 2 | Link strony wydarzenia + formularz „Zapisy" | placeholder `#` |
| 3 | Numery sal (5 miast — adresy są, sale „TODO") | placeholder |
| 4 | Pełne oficjalne nazwy uczelni | placeholder |
| 5 | Lista partnerów | „wkrótce — trwają rozmowy" |
| 6 | Właściwy bank pytań (dodawany per miasto w panelu) | do wgrania |
| 7 | Plan Supabase **Pro** przed realnym 500 | przed eventem |

---

*Środowiska: produkcja `dmoydtavstpurqebkngu` + staging `iaehipybmcxrvgyfmcfr`. Testy obciążeniowe/E2E na staging; weryfikacja funkcji bazy na produkcji.*
