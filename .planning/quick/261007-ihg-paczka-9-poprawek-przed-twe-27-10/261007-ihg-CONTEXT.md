# Quick Task 261007-ihg: Paczka 9 poprawek przed TWE 27.10 - Context

**Gathered:** 2026-10-07
**Status:** Ready for planning

<domain>
## Task Boundary

Lista 9 poprawek od organizatorów FUE przed Testem Wiedzy Ekonomicznej (27.10.2026):

1. Usunąć karuzelę logo uczelni z landingu (`UniversityTicker` w `src/screens/Welcome.jsx`).
2. Usunąć link do wydarzenia („TWE 2026 — Strona wydarzenia”, `EVENT_LINK` w `SocialBar`).
3. Usunąć logotypy uczelni (zakładka Organizatorzy: „Uczelnie partnerskie” i „Samorządy studenckie”) — zostają same nazwy (skrót w kolorze uczelni jako znaczek jest OK, bez obrazków).
4. Informator: jeden infopack dla wszystkich miast.
5. Zegar odliczania do 27 października.
6. Przerwa między modułami: obowiązkowa TYLKO między modułem 3 a 4, poza tym żadnych przerw do końca.
7. Przed ogłoszeniem podium trzeba kliknąć „Potwierdź” (podwójne zabezpieczenie).
8. Przycisk dla superadmina: blokada edytowania modułów i pytań dla wszystkich miast i innych kont admin.
9. Trzy miejsca po przecinku przy raporcie średniego czasu.

</domain>

<decisions>
## Implementation Decisions (zablokowane — od użytkownika)

### (4) Infopack
- Na razie ZAŚLEPKA: stała `INFOPACK_URL = "#"` (wzorem `REGISTRATION_URL`), przycisk „Pobierz infopack” w Informatorze.
- Informator przestaje zależeć od miasta: znika `CitySelector` w Informatorze. Zakładka Koordynatorzy (kontakty per miasto) zostaje bez zmian.

### (5) Zegar
- `TEST_START` = 27.10.2026, 10:00 czasu polskiego. 27.10 to już czas zimowy (CET, UTC+1) — zapisać jawnie z offsetem: `new Date("2026-10-27T10:00:00+01:00")`, żeby nie zależeć od strefy telefonu.

### (6) Przerwy
- Przerwa planowa tylko po module 3 (gdy następny jest inny moduł). `BREAK_AFTER_MODULES = [3]` w `src/lib/gameLogic.js` + lustro w SQL `build_plan_items` (obecnie `v_prev_m IN (2, 4)` w sekcji 42.2 `SUPABASE_FIXES.sql`).
- Zmiana SQL jako NOWA addytywna sekcja (CREATE OR REPLACE) w `SUPABASE_FIXES.sql` ze znacznikiem dla `npm run verify-prod`, wzorem poprzednich sekcji. Sprawdź najwyższy numer sekcji (44 jest na prod; 45 mogło być zarezerwowane w 07-13 — nie koliduj; jeśli 45 jest zajęte w pliku/planie, użyj kolejnego wolnego).
- Testy (gameLogic.test.js, plan.test.js, plan.fixtures.json jeśli zawiera przerwy) zaktualizować.

### (7) Podium
- Potwierdzenie przy przycisku „🏆 Podium” w `SesjaTab` (`AdminPanel.jsx`): klik → okno „Na pewno ogłosić podium?” z „Potwierdź” / „Anuluj”; dopiero „Potwierdź” woła `onPodium(results)`. Okno w stylu aplikacji (inline styles), NIE `window.confirm`. Dotyczy każdego miejsca, gdzie admin przechodzi do podium (sprawdź też HistoriaTab, jeśli tam jest przycisk podium).

### (8) Blokada edycji
- Blokuje WSZYSTKICH poza superadminami: city_admin nie może tworzyć/edytować/usuwać pytań ani modułów, gdy blokada jest włączona; każdy superadmin może edytować i włączać/wyłączać blokadę.
- Wymuszone w bazie (RLS), nie tylko w UI: tabela/wiersz ustawień globalnych (np. `app_settings` z kolumną `content_locked BOOLEAN DEFAULT false`), SELECT dla adminów, zapis tylko superadmin; polityki `questions_city_admin_write` i `modules_admin_all` dostają warunek „nie zablokowane” (przez funkcję SECURITY DEFINER STABLE, np. `content_locked()`).
- Przy okazji: `modules_admin_all` obecnie pozwala city_admin pisać do modułów na poziomie bazy (UI tylko ukrywa zakładkę) — domknąć: zapis modułów tylko superadmin (city_admin może czytać).
- UI: przełącznik w panelu superadmina (np. w Ustawieniach albo nad zakładkami) z wyraźnym stanem „🔒 Edycja zablokowana”; city_admin w zakładce Pytania widzi baner o blokadzie i nieaktywne przyciski edycji.

### (9) Średni czas
- `toFixed(3)` zamiast `toFixed(2)` we wszystkich raportach/eksportach średniego czasu odpowiedzi (CSV w AdminPanel ~l.1115 i ~l.1902, lista wyników ~l.1536, eksport XLSX w `src/lib/resultsXlsx.js` jeśli formatuje czas). Przecinek dziesiętny zostaje. Projektorowy „⌀ czas” (LiveView w AdminPanel, Math.round w sekundach) — poza zakresem, chyba że to ten sam raport.

### Claude's Discretion
- Usunięcie nieużywanych plików logo z `public/` (uek.jpg, sgh.png, uep.png, uewr.png, uekat.png) — TAK, jeśli po zmianach nic ich nie używa (sprawdź grep w src/, index.html, vite.config.js). Zmniejsza precache PWA.
- Usunięcie martwego kodu (UniversityTicker, EVENT_LINK, keyframes `ticker`/`borderGlow` jeśli nieużywane).

</decisions>

<specifics>
## Ograniczenia krytyczne

- **Testy na produkcji, brak stagingu**: każda migracja SQL musi być addytywna (CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY jest OK). Nie zmieniać sygnatur funkcji używanych przez obecnie wdrożony front.
- **Kolejność wdrożenia (6)**: obecnie wdrożony front ma `BREAK_AFTER_MODULES = [2,4]` w plan.js (lustro do przewidywania przerw). Po wgraniu nowej sekcji SQL stary front i baza się rozjadą → SQL i front muszą iść razem (najpierw SQL, zaraz po nim deploy frontu), albo przed rozpoczęciem jakiejkolwiek sesji. Zapisać to wprost w SUMMARY jako krok ręczny dla użytkownika.
- SQL wgrywa użytkownik ręcznie w Supabase SQL Editor — SUMMARY ma zawierać ponumerowane, konkretne kroki (po polsku).
- Worktree: NIE tworzyć junction/dowiązania `node_modules` w worktree. Testy uruchamiać przez `node ../../../node_modules/vitest/vitest.mjs run` (albo ścieżkę względną do głównego node_modules).
- Styl: inline styles, bez bibliotek UI, podwójne cudzysłowy, komentarze po polsku w stylu otoczenia.
- Cały zestaw testów musi przechodzić (obecnie 343/343) + `npm run build` bez błędów.

</specifics>

<canonical_refs>
## Canonical References

- `src/screens/Welcome.jsx` — landing (pkt 1–5)
- `src/screens/AdminPanel.jsx` — SesjaTab/podium (7), PytaniaTab/ModulyTab/UstawieniaTab (8), raporty (9)
- `src/lib/gameLogic.js`, `src/lib/plan.js` + testy — przerwy (6)
- `SUPABASE_FIXES.sql` sekcja 42.2 `build_plan_items`; sekcje 41.5/42.8/44.14 — wzór znacznika dla verify-prod
- `SUPABASE_SCHEMA.sql` l.135–146 (polityki questions), l.248–254 (polityki modules)
- `scripts/` — skrypt `verify-prod` (dopisać nowy znacznik sekcji)

</canonical_refs>
