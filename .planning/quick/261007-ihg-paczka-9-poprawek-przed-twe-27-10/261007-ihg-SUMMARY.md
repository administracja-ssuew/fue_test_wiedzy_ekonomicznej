---
phase: quick-261007-ihg
plan: 01
subsystem: landing, rozgrywka (plan sesji), panel admina, SQL
tags: [twe-2026, landing, przerwy, podium, rls, blokada-edycji, raporty]
requires: [sekcja 42 (build_plan_items), sekcja 44 (admin_reorder_questions)]
provides:
  - "Sekcja 46 SUPABASE_FIXES.sql (46.1–46.9, schema_marker_46)"
  - "BREAK_AFTER_MODULES = [3]"
  - "ConfirmDialog (src/components/ConfirmDialog.jsx)"
  - "Blokada edycji treści: app_settings.content_locked + content_locked() + UI"
affects: [Welcome, AdminPanel (Pytania, Sesja, pasek superadmina), Podium, eksport XLSX/CSV, verify-prod, verify-plan]
tech-stack:
  added: []
  patterns: ["createPortal dla okien modalnych", "fallback frontu przed wgraniem sekcji SQL (available: false)", "wykrywanie 0 zmienionych wierszy po UPDATE pod RLS"]
key-files:
  created:
    - src/components/ConfirmDialog.jsx
    - src/components/ConfirmDialog.test.jsx
    - src/lib/contentLock.js
    - src/lib/contentLock.test.js
  modified:
    - src/screens/Welcome.jsx
    - src/styles/global.css
    - src/data/questions.js
    - src/screens/AdminPanel.jsx
    - src/screens/Podium.jsx
    - src/lib/resultsXlsx.js
    - src/lib/resultsXlsx.test.js
    - src/lib/xlsx.js
    - src/lib/xlsx.test.js
    - src/lib/gameLogic.js
    - src/lib/gameLogic.test.js
    - src/lib/plan.js
    - src/lib/plan.test.js
    - src/lib/plan.fixtures.json
    - src/lib/supabase.js
    - src/screens/Break.jsx
    - src/screens/LiveView.jsx
    - src/App.jsx
    - scripts/verify-plan.js
    - scripts/verify-prod.js
    - scripts/probe-gameplay.js
    - SUPABASE_FIXES.sql
  deleted:
    - public/uek.jpg
    - public/sgh.png
    - public/uep.png
    - public/uewr.png
    - public/uekat.png
decisions:
  - "Sekcja 46 (nie 45 — zarezerwowana dla 07-13): build_plan_items z v_prev_m = 3, app_settings + content_locked(), polityki questions/modules, blokada w admin_delete_*"
  - "Zapis modułów w bazie wyłącznie dla superadmina (modules_superadmin_write zastępuje modules_admin_all)"
  - "ConfirmDialog renderowany przez portal do body — przodek z transform (animacja su) psułby position: fixed"
  - "Fixture v2 zostaje (plany sprzed sekcji 46, h po 2 i 4); budowa planu porównywana z nowym v3"
metrics:
  duration: 12min
  completed: 2026-10-07
  tasks: 3
  tests: 359/359
---

# Quick 261007-ihg: Paczka 9 poprawek przed TWE 27.10 — podsumowanie

Landing bez karuzeli logo, linku do wydarzenia i obrazków uczelni, wspólny infopack i zegar do 27.10 10:00 (CET). Przerwa planowa jest teraz tylko po module 3, zarówno w JS, jak i w SQL 46.1. Podium wymaga potwierdzenia w oknie aplikacji. Superadmin może zablokować edycję treści, a blokadę wymusza RLS w bazie. Średni czas w raportach ma 3 miejsca po przecinku.

## Co zrobiono (9 punktów)

| # | Punkt | Realizacja |
|---|-------|------------|
| 1 | Karuzela logo | Usunięta karuzela uczelni u dołu landingu i `@keyframes ticker` |
| 2 | Link do wydarzenia | Usunięty z paska społecznościowego (zostały ikony FB/IG/WWW, wyrównane do prawej) i `@keyframes borderGlow` |
| 3 | Logotypy uczelni | Organizatorzy: znaczek ze skrótem w kolorze uczelni + nazwa, bez obrazków; 5 plików logo usuniętych z `public/` (0 referencji, mniejszy precache PWA); pola `logo` usunięte z `CITIES` |
| 4 | Jeden infopack | Informator bez wyboru miasta: karta „📄 Infopack uczestnika” + przycisk „📥 Pobierz infopack” (`INFOPACK_URL = "#"` — zaślepka) + link „Kontakt do koordynatora Twojej uczelni →” (przełącza na zakładkę Koordynatorzy) |
| 5 | Zegar | `TEST_START = new Date("2026-10-27T10:00:00+01:00")` — jawny offset CET |
| 6 | Przerwa tylko po module 3 | `BREAK_AFTER_MODULES = [3]`; SQL 46.1 `build_plan_items` z `v_prev_m = 3`; fixture `v3`; verify-plan/verify-prod zaktualizowane |
| 7 | Potwierdzenie podium | „🏆 Podium” → okno „Na pewno ogłosić podium?”; `onPodium(results)` wołane wyłącznie w `onConfirm` (jedyne wejście do podium — HistoriaTab nie ma przycisku) |
| 8 | Blokada edycji | Przełącznik w pasku superadmina (z potwierdzeniem); city_admin przy blokadzie: baner, nieaktywne przyciski, handlery z wczesnym `return`; baza odrzuca zapis (RLS + warunek w funkcjach SECURITY DEFINER) |
| 9 | 3 miejsca po przecinku | `toFixed(3)` w CSV Sesja/Historia, liście wyników, podium; XLSX: `secs()` z 3 miejscami, format `0.000` (własny `numFmtId 164`) |

## Commity

| Zadanie | Commit | Opis |
|---------|--------|------|
| 1 | `222e3dd` | feat: landing (pkt 1–5) + 3 miejsca po przecinku (pkt 9) |
| 2 (RED) | `f00c271` | test: przerwa tylko po module 3 (fixture v3) |
| 2 (GREEN) | `a472268` | feat: BREAK_AFTER_MODULES = [3], SQL 46.1 + 46.9, verify-plan/verify-prod |
| 3 (RED) | `485c08e` | test: ConfirmDialog + contentLock |
| 3 (GREEN) | `7511563` | feat: potwierdzenie podium + blokada edycji (SQL 46.2–46.8, UI, warstwa danych) |

Testy: **359/359** (wcześniej 343 + 1 xlsx + 7 contentLock + 8 ConfirmDialog). Build: OK.

## Kroki ręczne dla Ciebie (po polsku)

1. **Sprawdź, czy żadna sesja nie trwa.** W panelu otwórz zakładkę Sesja i przejdź po wszystkich 5 miastach: nigdzie nie może być „Trwa quiz” ani „☕ Przerwa”. Sesje uruchomione PRZED wgraniem SQL zachowają stare przerwy (po modułach 2 i 4), bo plan zamraża się przy starcie.
2. **Wgraj sekcję 46 SQL.** Supabase → projekt `ytbwmmqwbfcugouourih` → SQL Editor → New query → wklej CAŁĄ sekcję 46 z `SUPABASE_FIXES.sql`: od linii `-- ─── 46. PACZKA 261007-ihg…` do `NOTIFY pgrst, 'reload schema';` w 46.9 włącznie (przed stopką „Done”) → Run. Wynik ma być bez błędów.
3. **Od razu wdróż front** tak samo jak w 07-12 (push na `main` → Vercel produkcja) i poczekaj, aż build się skończy.
4. **W terminalu w `D:\Projects\fue-quiz-project` uruchom `npm run verify-prod`.** Oczekiwany kod 0, a w bloku „☕ SEKCJA 46” same ✅: `schema_marker_46`, `build_plan_items — h tylko po module 3`, `content_locked() — działa`, `app_settings niedostępne dla anon`. Używaj nowej wersji skryptu, bo stara zgłosiłaby fałszywy ❌ w bloku 42.
5. **Uruchom `npm run verify-plan`.** Oczekiwany kod 0 i linia „[budowa] build_plan_items (6 pytań, 5 modułów, reveal 11,5 s, przerwa po module 3)”.
6. **Przetestuj blokadę.** Zaloguj się jako superadmin → pod wyborem miasta kliknij „Zablokuj edycję” → „Zablokuj”. Chip zmieni się na „🔒 Edycja zablokowana dla adminów miast”. W drugiej przeglądarce (albo oknie incognito) zaloguj się jako admin miasta → zakładka Pytania: widać baner 🔒, a przyciski „+ Dodaj pytanie”, ✏️, 🗑️, ↑/↓, import i kopiowanie są nieaktywne. Wróć do superadmina i kliknij „Odblokuj edycję” → „Odblokuj”.
7. **Przetestuj podium.** Po zakończonej sesji próbnej kliknij „🏆 Podium”. Pojawi się okno „Na pewno ogłosić podium?”. „Anuluj” (albo Escape lub klik w tło) nic nie robi, a „Potwierdź” otwiera podium.
8. **Podmień linki, gdy organizatorzy je przekażą.** W `src/screens/Welcome.jsx` zmień `INFOPACK_URL` (link do PDF infopacku) i `REGISTRATION_URL` (formularz zapisów), a potem wdróż front.
9. **(Opcjonalnie) uruchom sondę `PROBE_FULL=1 npm run sonda`.** Oczekiwana jest jedna przerwa planowa, po pytaniu kończącym moduł 3. Przed sondą sprawdź resztki [SONDA] i zablokuj uśpienie laptopa.

## Ryzyko kolejności wdrożenia

`BREAK_AFTER_MODULES` we froncie działa na produkcji TYLKO w trybie DEMO (`startQuizSessionV2` w DEMO w `src/lib/supabase.js`), w testach i w `verify-plan`. Plan produkcyjny buduje SQL (`start_quiz_session_v2` → `build_session_plan` → `build_plan_items`) i zamraża go przy starcie sesji. Front, zarówno stary, jak i nowy, czyta znacznik `h` z planu i nie zna numerów modułów. Dlatego po wgraniu sekcji 46 nawet stary front pokaże w NOWYCH sesjach przerwę po module 3. Realne ryzyka:

- **(a)** Sesja wystartowana przed wgraniem SQL zachowa przerwy po modułach 2 i 4, bo jej plan jest już zamrożony.
- **(b)** Stary `verify-prod` (blok 42 sprawdzał „h po module 2”) po wgraniu sekcji 46 zgłosi ❌. Używaj nowego skryptu z tej paczki.
- **(c)** Stary front city_admina przy włączonej blokadzie: edycja pytania kończy się cichym brakiem zmian (RLS zwraca 0 wierszy bez błędu), bez banera i komunikatu. Nowy front wykrywa to w `updateQuestion` i pokazuje komunikat o blokadzie.

Zalecana kolejność mimo to: SQL 46, zaraz potem deploy frontu, nie w trakcie trwającej sesji. Nowy front działa też PRZED wgraniem SQL: `getContentLock` zwraca wtedy `available: false`, a superadmin widzi chip „⚠️ Blokada niedostępna — wgraj sekcję 46 SQL”.

## Odstępstwa od planu

### Poprawki automatyczne

**1. [Reguła 1 — błąd] ConfirmDialog renderowany przez portal do `<body>`**
- **Znalezione w:** zadaniu 3
- **Problem:** panel używa animacji `su` (transform). Przodek z `transform` sprawia, że `position: fixed` pozycjonuje się względem niego, a nie okna, więc okno mogłoby wylądować w środku karty wyników zamiast na całym ekranie.
- **Poprawka:** `createPortal(…, document.body)` w `ConfirmDialog`.
- **Commit:** `7511563`

**2. [Reguła 1 — błąd] Fokus okna nie skacze przy re-renderze rodzica**
- **Znalezione w:** zadaniu 3
- **Problem:** SesjaTab re-renderuje się co sekundę (poll), za każdym razem z nową funkcją `onCancel`. Efekt zależny od `onCancel` przestawiałby fokus i nasłuch Escape co sekundę.
- **Poprawka:** `onCancel` trzymane w refie, efekt zależy tylko od `open`.
- **Commit:** `7511563`

**3. [Reguła 2 — brakująca obsługa] Import CSV i kopiowanie pokazują, ile pytań weszło przed błędem**
- Komunikat `friendlyWriteError(...)` + „Zaimportowano X z N.” / „Skopiowano X z N.” Lista pytań jest odświeżana, a podgląd importu zostaje, żeby można było ponowić.
- **Commit:** `7511563`

**4. [Reguła 3] Katalog `node_modules/.vite` (cache vitest) w worktree**
- Vitest sam utworzył w worktree zwykły katalog `node_modules/.vite` (nie junction). Usunąłem go po testach, żeby worktree nie zawierał żadnego `node_modules`.

### Poza zakresem (odłożone)

- `admin_delete_question` (sekcja 32, skopiowana w 46.6 bez zmian semantyki) nie sprawdza miasta pytania dla city_admina. Admin miasta mógłby przez RPC usunąć pytanie innego miasta, jeśli zna jego UUID. Problem istniał już wcześniej i nie wynika z tej paczki. Do decyzji przy sekcji 45/47 (dodać `AND city = get_my_city()` dla city_admina).
- Projektorowy „⌀ czas” w LiveView (Math.round w sekundach) zgodnie z CONTEXT nie był zmieniany.

## Znane zaślepki

| Plik | Stała | Powód |
|------|-------|-------|
| `src/screens/Welcome.jsx` | `INFOPACK_URL = "#"` | Decyzja użytkownika (CONTEXT pkt 4): zaślepka do czasu przekazania PDF przez organizatorów. Krok ręczny 8. |
| `src/screens/Welcome.jsx` | `REGISTRATION_URL = "#"` | Istniała wcześniej, bez zmian. Krok ręczny 8. |

## Self-Check: PASSED

- Pliki utworzone istnieją: `src/components/ConfirmDialog.jsx`, `src/components/ConfirmDialog.test.jsx`, `src/lib/contentLock.js`, `src/lib/contentLock.test.js`.
- Commity istnieją: `222e3dd`, `f00c271`, `a472268`, `485c08e`, `7511563`.
- Sekcja 46: podsekcje 46.1…46.9 po kolei, przed stopką „Done”, 0 × `DROP FUNCTION`.
- 0 referencji do usuniętych plików logo w `src/`, `index.html`, `vite.config.js`.
- `onPodium(` w AdminPanel występuje wyłącznie w `onConfirm` okna.
