---
phase: quick-261007-ihg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/screens/Welcome.jsx
  - src/styles/global.css
  - src/data/questions.js
  - public/uek.jpg
  - public/sgh.png
  - public/uep.png
  - public/uewr.png
  - public/uekat.png
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
  - src/screens/Break.jsx
  - src/screens/LiveView.jsx
  - src/App.jsx
  - scripts/verify-plan.js
  - scripts/verify-prod.js
  - scripts/probe-gameplay.js
  - SUPABASE_FIXES.sql
  - src/components/ConfirmDialog.jsx
  - src/components/ConfirmDialog.test.jsx
  - src/lib/contentLock.js
  - src/lib/contentLock.test.js
  - src/lib/supabase.js
  - src/screens/AdminPanel.jsx
autonomous: true
requirements: [TWE-FIX-1, TWE-FIX-2, TWE-FIX-3, TWE-FIX-4, TWE-FIX-5, TWE-FIX-6, TWE-FIX-7, TWE-FIX-8, TWE-FIX-9]

must_haves:
  truths:
    - "Landing nie ma karuzeli logo uczelni ani linku „TWE 2026 — Strona wydarzenia”; zakładka Organizatorzy pokazuje uczelnie i samorządy bez obrazków (skrót w kolorze uczelni + nazwa)"
    - "Informator nie ma wyboru miasta i pokazuje jeden przycisk „Pobierz infopack” (INFOPACK_URL)"
    - "Zegar na stronie głównej odlicza do 27.10.2026 10:00 czasu polskiego niezależnie od strefy telefonu"
    - "Nowo budowany plan sesji (JS i SQL) ma przerwę planową wyłącznie po ostatnim pytaniu modułu 3; plany zamrożone wcześniej (h po 2 i 4) nadal są poprawnie projektowane"
    - "Klik „🏆 Podium” otwiera okno „Na pewno ogłosić podium?”; dopiero „Potwierdź” przechodzi do podium, „Anuluj”/Escape nic nie robi"
    - "Superadmin włącza/wyłącza blokadę edycji; przy włączonej city_admin nie może dodać/edytować/usunąć/przestawić pytań (baza odrzuca, UI blokuje przyciski i pokazuje baner), a zapis modułów jest zawsze tylko dla superadmina"
    - "Średni czas odpowiedzi w liście wyników, CSV (Sesja i Historia), podium i XLSX ma 3 miejsca po przecinku (przecinek dziesiętny w CSV/UI)"
  artifacts:
    - path: "src/screens/Welcome.jsx"
      provides: "Landing bez tickera/EVENT_LINK/logo, INFOPACK_URL, TEST_START z offsetem"
      contains: "2026-10-27T10:00:00+01:00"
    - path: "src/lib/gameLogic.js"
      provides: "BREAK_AFTER_MODULES = [3]"
      contains: "BREAK_AFTER_MODULES = [3]"
    - path: "src/lib/plan.fixtures.json"
      provides: "fixture v3.items (przerwa tylko po module 3) obok v2 (plan sprzed sekcji 46)"
      contains: "\"v3\""
    - path: "SUPABASE_FIXES.sql"
      provides: "Sekcja 46: build_plan_items (przerwa po 3), app_settings + content_locked(), polityki questions/modules, blokada w admin_delete_*, schema_marker_46"
      contains: "schema_marker_46"
    - path: "scripts/verify-prod.js"
      provides: "Blok SEKCJA 46 + blok 42 niezależny od reguły przerw"
      contains: "schema_marker_46"
    - path: "src/components/ConfirmDialog.jsx"
      provides: "Okno potwierdzenia w stylu aplikacji (inline styles)"
    - path: "src/lib/contentLock.js"
      provides: "canEditContent, friendlyWriteError, CONTENT_LOCKED_TEXT"
    - path: "src/lib/supabase.js"
      provides: "getContentLock, updateContentLock; updateQuestion wykrywa 0 zmienionych wierszy"
      exports: ["getContentLock", "updateContentLock"]
  key_links:
    - from: "src/lib/plan.js buildPlanItems"
      to: "SUPABASE_FIXES.sql 46.1 build_plan_items"
      via: "lustro reguły przerwy (BREAK_AFTER_MODULES = [3] ↔ v_prev_m = 3), sprawdzane przez npm run verify-plan na fixture v3"
      pattern: "v_prev_m = 3"
    - from: "SesjaTab „🏆 Podium”"
      to: "onPodium(results)"
      via: "ConfirmDialog onConfirm"
      pattern: "ConfirmDialog"
    - from: "questions_city_admin_write (RLS)"
      to: "public.content_locked()"
      via: "USING/WITH CHECK ... AND NOT public.content_locked()"
      pattern: "NOT public.content_locked\\(\\)"
    - from: "AdminPanel (pasek superadmina)"
      to: "app_settings.content_locked"
      via: "getContentLock / updateContentLock w src/lib/supabase.js"
      pattern: "updateContentLock"
---

<objective>
Paczka 9 poprawek od organizatorów FUE przed TWE 27.10.2026: landing (1–5), przerwa tylko po module 3 (6), potwierdzenie podium (7), blokada edycji treści przez superadmina wymuszona w bazie (8), 3 miejsca po przecinku w raportach średniego czasu (9).

Purpose: ostatnie zmiany organizacyjne przed konkursem; zmiany SQL wyłącznie addytywne (testy na produkcji, brak stagingu).
Output: zmiany frontu + nowa sekcja 46 w SUPABASE_FIXES.sql + rozszerzone verify-prod/verify-plan + testy (cały zestaw zielony, build OK).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/261007-ihg-paczka-9-poprawek-przed-twe-27-10/261007-ihg-CONTEXT.md
@CLAUDE.md

## Środowisko wykonawcy (WAŻNE)
- Pracujesz w git worktree pod `.claude/worktrees/<agent>/` w repo `D:\Projects\fue-quiz-project`. Jeśli gałąź worktree jest za `main` (brak katalogu `.planning/quick/261007-ihg-...`), najpierw `git merge --ff-only main`.
- NIE twórz junction/symlinka `node_modules` w worktree (wcześniej `git worktree remove --force` skasował przez to główny node_modules). Node znajdzie `node_modules` głównego repo, idąc w górę drzewa.
- Testy: `node ../../../node_modules/vitest/vitest.mjs run` (z katalogu głównego worktree; ścieżkę sprawdź `ls ../../../node_modules/vitest/vitest.mjs`). Build: `node ../../../node_modules/vite/bin/vite.js build`. Stan wyjściowy: 343/343 testów.
- Styl: inline styles, bez bibliotek UI, podwójne cudzysłowy, komentarze po polsku w stylu otoczenia. Bez `window.confirm` w nowych oknach (punkt 7/8).
- SQL wgrywa użytkownik ręcznie — Ty tylko dopisujesz sekcję do pliku. Nie łącz się z produkcją, nie uruchamiaj `verify-prod`/`verify-plan`/sond (wymagają wgranego SQL).

## Numer sekcji SQL
Na prod jest sekcja 44 (ostatnia w pliku, l.2744–3038, stopka „Done” l.3040). Numer 45 jest ZAREZERWOWANY przez plan 07-13 (utwardzenie wyroczni kodów, `schema_marker_45`) — jeszcze nie ma go w pliku. Ta paczka używa **sekcji 46**, wstawionej przed stopką „Done”. W nagłówku zapisz: „Sekcja 45 zarezerwowana dla planu 07-13”.

## Ustalenie dot. ryzyka kolejności wdrożenia (do SUMMARY)
`BREAK_AFTER_MODULES` w froncie jest używane na produkcji TYLKO w trybie DEMO (`startQuizSessionV2` DEMO, `src/lib/supabase.js` l.1098) oraz w testach i `verify-plan`. Plan produkcyjny buduje SQL (`start_quiz_session_v2` → `build_session_plan` → `build_plan_items`) i zamraża go przy starcie; front (stary i nowy) czyta znacznik `h` z planu. Zatem po wgraniu sekcji 46 stary front poprawnie pokaże przerwę po module 3 w NOWYCH sesjach. Realne ryzyka: (a) sesja wystartowana przed wgraniem SQL zachowa przerwy po 2 i 4; (b) stary `verify-prod` (blok 42 sprawdza „h po module 2”) zgłosi ❌ po wgraniu 46 — używać nowego skryptu; (c) stary front city_admina przy włączonej blokadzie: edycja kończy się cichym brakiem zmian (RLS), bez banera. Zalecana kolejność mimo to: SQL 46 → zaraz deploy frontu, nie w trakcie trwającej sesji.

<interfaces>
Istniejące (nie zmieniać sygnatur):
- `src/lib/plan.js`: `buildPlanItems(questions, modules)` (l.24–38; reguła przerwy l.30 `BREAK_AFTER_MODULES.includes(prev.m)`), `holdDue`, `breakIdxAt`, `projectPlanState` — czytają `h` z items, nie znają numerów modułów.
- `SUPABASE_FIXES.sql` 42.2 `public.build_plan_items(p_questions JSONB, p_modules JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = public` (l.2301–2339; reguła l.2320 `v_prev_m IN (2, 4)`; granty l.2338–2339). Wzór znacznika: 44.14 (l.3008–3014).
- `SUPABASE_SCHEMA.sql`: `get_my_role()` / `get_my_city()` (SECURITY DEFINER STABLE); polityki questions l.135–146 (`questions_city_admin_write` FOR ALL USING (get_my_role()='city_admin' AND city=get_my_city()), `questions_superadmin`, `questions_admin_select`); modules l.248–252 (`modules_anon_select` USING(true), `modules_admin_all` FOR ALL dla city_admin i superadmin).
- `SUPABASE_FIXES.sql` sekcja 30 `admin_delete_city_questions(p_city TEXT, p_practice BOOLEAN) RETURNS INT` (l.870–882) i sekcja 32 `admin_delete_question(p_id UUID) RETURNS VOID` (l.948–956) — SECURITY DEFINER, omijają RLS. `admin_reorder_questions` (44.9) jest SECURITY INVOKER → RLS go blokuje sam.
- `scripts/verify-prod.js`: helpery `ok/bad/note/isMissing/isDenied`, `DUMMY`, `callRpc`; blok 42 l.276–320, blok 44 l.346–397, podsumowanie l.399.
- `scripts/verify-plan.js`: `checkBuild()` l.109–134 porównuje SQL/JS/fixture `V2.items`.
- `src/screens/AdminPanel.jsx`: `PytaniaTab({ city })` l.102 (handlery: `importQuestionsCsv` l.164, `copyFromCity` l.180, `openAdd/openEdit` l.196–197, `save` l.199–204, `remove/removeAll` l.205–211, `locked/canReorder` l.214–216, przyciski l.291–292, 327, 350, 386–387, 439–444); `SesjaTab({ city, adminId, onPodium })` l.704, przycisk Podium l.1520–1524, pełny ekran Live z `zIndex: 2000` l.1451; `TABS` l.2114; `AdminPanel({ admin, isDesktop, onLogout, onPodium })` l.2123, `isSuperadmin` l.2124, pasek superadmina z `CityPicker` l.2144–2148, render zakładek l.2160–2173. Obiekt stylów `C` (l.30) z `C.btn(variant, extra)` i `C.card(extra)`.
- `src/lib/supabase.js`: `DEMO`, `supabase`; `updateQuestion(id, updates)` l.320–332 (dziś bez wykrywania 0 wierszy), `deleteQuestion` l.334, `addQuestion` zwraca `{ data, error }`.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Landing (pkt 1–5) + 3 miejsca po przecinku w raportach czasu (pkt 9)</name>
  <files>src/screens/Welcome.jsx, src/styles/global.css, src/data/questions.js, public/uek.jpg, public/sgh.png, public/uep.png, public/uewr.png, public/uekat.png, src/screens/AdminPanel.jsx, src/screens/Podium.jsx, src/lib/resultsXlsx.js, src/lib/resultsXlsx.test.js, src/lib/xlsx.js, src/lib/xlsx.test.js</files>
  <action>
**Welcome.jsx (pkt 1–5):**
1. (1) Usuń `UniversityTicker` (l.136–151) i jego użycie `<UniversityTicker />` (l.725).
2. (2) Usuń `EVENT_LINK` (l.9) i cały blok `<a href={EVENT_LINK} …>…TWE 2026 — Strona wydarzenia…</a>` razem z lewym wrapperem (l.158–176); w `SocialBar` ustaw `justifyContent: "flex-end"` (zostają same ikony SOCIAL_LINKS).
3. (3) W `UNIVERSITIES` (l.38–44) usuń pola `logo`. W `OrganizatorszyTab` usuń gałęzie `u.logo ? <img …> : …` (l.466–467 i l.485–486) — zawsze znaczek ze skrótem w kolorze uczelni (`linear-gradient(135deg,${u.color}30,${u.color}12)`, `color: u.color`) + nazwa jak dziś.
4. (4, decyzja: zaślepka) Obok `REGISTRATION_URL` (l.311) dodaj `const INFOPACK_URL = "#";` z komentarzem „Jeden infopack dla wszystkich miast — podmień na link do PDF.” Przebuduj `InformatorTab` na niezależny od miasta: sygnatura `InformatorTab({ onShowCoordinators })`; usuń `CitySelector`, `coord`, `address`, sekcję „📞 Kontakt”. Sekcje: `[...(SHOW_HARMONOGRAM ? harmonogram : []), { id: "infopack", label: "📄 Infopack" }]`, domyślnie infopack. Karta infopacku (W.card, styl jak reszta): nagłówek „📄 Infopack uczestnika”, tekst „Jeden informator dla wszystkich miast — zasady testu, harmonogram i praktyczne informacje.”, przycisk-link `<a href={INFOPACK_URL} target="_blank" rel="noopener noreferrer">📥 Pobierz infopack</a>` w stylu złotego CTA (jak „Zapisz się”, l.375–380, mniejszy padding). Pod kartą mała linia „Kontakt do koordynatora Twojej uczelni →” jako przycisk ghost wołający `onShowCoordinators`. Harmonogram (za flagą, dziś `false`) ma używać `SCHEDULE.default` bez karty „📍 Miejsce” — usuń `CITY_ADDRESSES` (nieużywane po zmianie). W `Welcome` render: `<InformatorTab onShowCoordinators={() => setTab("koordynatorzy")} />`; `city`/`setCity` zostają tylko dla `KoordynatorzyTab` (bez zmian, decyzja z CONTEXT).
5. (5) `TEST_START` (l.4–5): `const TEST_START = new Date("2026-10-27T10:00:00+01:00");` z komentarzem: „27.10 to już czas zimowy (CET, UTC+1) — jawny offset, żeby nie zależeć od strefy telefonu.” Usuń stary TODO.

**Martwy kod / pliki (dyskrecja z CONTEXT):** w `src/styles/global.css` usuń `@keyframes ticker` (l.18) i `@keyframes borderGlow` (l.27) — używa ich tylko usuwany kod (sprawdź grep `ticker\b|borderGlow` w `src/`, poza komentarzami w hookach). W `src/data/questions.js` usuń pola `logo` z `CITIES` (l.2–6) — nic nie czyta `.logo` (grep `\.logo\b` w src = 0). Następnie grep `uek.jpg|sgh.png|uep.png|uewr.png|uekat.png` w `src/ index.html vite.config.js e2e/ scripts/`; przy 0 trafień `git rm public/uek.jpg public/sgh.png public/uep.png public/uewr.png public/uekat.png` (mniejszy precache PWA). Zdjęcia osób (`kr_*.png`, `pre_*.png`, `przewo_wro.png`) i `fue.png` ZOSTAJĄ.

**3 miejsca po przecinku (pkt 9):**
- `AdminPanel.jsx` l.1115 (CSV Sesja), l.1536 (lista wyników), l.1902 (CSV Historia): `.toFixed(2)` → `.toFixed(3)` (przecinek przez `.replace(".", ",")` zostaje).
- `Podium.jsx` l.8 `fmtAvg`: `.toFixed(3)` (ten sam średni czas, który rozstrzyga remisy na podium).
- `resultsXlsx.js` l.11–14: `secs = (ms) => (ms == null ? "" : Math.round(ms) / 1000)` (ms całkowite → 3 miejsca, 12345 → 12.345), komentarz „3 miejsca, spójnie z CSV i podium”; `secsCell` z `fmt: "0.000"` i komentarzem „Excel pokaże „12,300””.
- `xlsx.js`: dodaj format własny — w `STYLES_XML` (l.113–122) zaraz po `<styleSheet …>` wstaw `<numFmts count="1"><numFmt numFmtId="164" formatCode="0.000"/></numFmts>` (kolejność wymagana przez ECMA-376: numFmts przed fonts); `cellXfs count="3"` z trzecim `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`. W komórce (l.97): `fmt === "0.00"` → `s="1"`, `fmt === "0.000"` → `s="2"`, inne → bez `s`. Zaktualizuj komentarze l.93–94, l.110–112 i JSDoc l.172–173, l.227 (`fmt?: "0.00" | "0.000"`).
- Testy: `resultsXlsx.test.js` — oczekiwania `fmt: "0.00"` → `"0.000"` (l.36–39, 62, 75–80), `secs(12345)` → `12.345` (l.143); `xlsx.test.js` — test styles (l.100–108): `cellXfs count="3"`, zawiera `numFmtId="164"` i `formatCode="0.000"`, `<numFmts` przed `<fonts`; dodaj test `{ v: 12.345, fmt: "0.000" }` → `<c r="A1" s="2"><v>12.345</v></c>`; test `"0.00"` → `s="1"` zostaje.

Projektorowy „⌀ czas” w LiveView (Math.round w sekundach) — poza zakresem (CONTEXT).
  </action>
  <verify>
    <automated>node ../../../node_modules/vitest/vitest.mjs run src/lib/resultsXlsx.test.js src/lib/xlsx.test.js && node ../../../node_modules/vite/bin/vite.js build && grep -c "UniversityTicker\|EVENT_LINK\|CitySelector city={city} setCity={setCity} />" src/screens/Welcome.jsx | grep -q "^1$" && grep -q "2026-10-27T10:00:00+01:00" src/screens/Welcome.jsx && grep -q "INFOPACK_URL" src/screens/Welcome.jsx && ! grep -rqE "toFixed\(2\)" src/screens/AdminPanel.jsx src/screens/Podium.jsx</automated>
  </verify>
  <done>Welcome.jsx: brak tickera, EVENT_LINK i obrazków logo; jedyne `CitySelector` to w Koordynatorach; Informator z przyciskiem infopacku; TEST_START z offsetem +01:00. Pięć plików logo usuniętych z public/ (0 referencji). Średni czas w UI/CSV/podium/XLSX z 3 miejscami; testy XLSX zielone; build OK.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Przerwa planowa tylko po module 3 — JS + sekcja 46.1 SQL + fixture'y + verify-plan/verify-prod (pkt 6)</name>
  <files>src/lib/gameLogic.js, src/lib/gameLogic.test.js, src/lib/plan.js, src/lib/plan.test.js, src/lib/plan.fixtures.json, SUPABASE_FIXES.sql, scripts/verify-plan.js, scripts/verify-prod.js, scripts/probe-gameplay.js, src/screens/Break.jsx, src/screens/LiveView.jsx, src/App.jsx</files>
  <behavior>
    - BREAK_AFTER_MODULES równa się [3]
    - buildPlanItems(v2.questions, v2.modules) (moduły 1,1,2,3,4,5) === fixtures.v3.items; znacznik h tylko na i=3
    - buildPlanItems(v2.questions.slice(0,4)) (moduł 3 ostatni) → brak h; slice(0,5) → h na [3]
    - projekcja/holdDue/breakIdxAt na fixtures.v2.items (plan sprzed sekcji 46, h na 2 i 4) działa bez zmian — istniejące testy przechodzą bez modyfikacji oczekiwań
  </behavior>
  <action>
**RED → GREEN (testy najpierw):**
1. `src/lib/plan.fixtures.json`: dodaj klucz `"v3"` (obok `"v2"`) z `"items"` = dokładnie `v2.items` z przesuniętym znacznikiem: usuń `"h": true` z i=2 i i=4, dodaj `"h": true` do i=3 (`{ "i": 3, "id": "00000000-0000-0000-0000-000000000031", "m": 3, "tpq": 20, "lead": 30, "o": 178500, "c": 198500, "r": 210000, "h": true }`). Pozostałe pola (o/c/r/lead/tpq) identyczne — reguła przerw nie zmienia czasów. `v2` zostaje bez zmian: to plan zamrożony przy sekcji 42 (sesje sprzed sekcji 46 nadal istnieją i muszą być projektowane).
2. `plan.test.js`: l.12 komentarz `V2` → „plan zamrożony przy sekcji 42 (przerwy po 2 i 4) — sesje sprzed sekcji 46”; dodaj `const V3 = fixtures.v3; // sekcja 46: przerwa tylko po module 3`. l.31–33: `expect(buildPlanItems(V2.questions, V2.modules)).toEqual(V3.items)` (nazwa: „…zgodne z fixture'ami v3 (kontrakt z SQL build_plan_items, sekcja 46)”). l.45–51: nazwa „znacznik h tylko na ostatnim pytaniu modułu 3, gdy po nim jest kolejny moduł”, oczekiwanie `[3]`; `slice(0, 4)` (moduł 3 ostatni) → `[]`; `slice(0, 5)` → `[3]`. l.418 `expect(items).toEqual(V3.items)`. Wszystkie pozostałe testy na `V2.items` (hold/breakIdxAt/projectPlanState, l.97–363) zostają bez zmian.
3. `gameLogic.test.js` l.11–13: „przerwa planowa tylko po module 3 (decyzja 261007-ihg)”, `toEqual([3])`.
4. Uruchom testy → muszą paść (RED) na l.31/l.46/l.418 i gameLogic. Commit testów.
5. `gameLogic.js` l.18–20: `export const BREAK_AFTER_MODULES = [3];` komentarz: „Przerwa planowa tylko między modułem 3 a 4 (decyzja organizatorów 261007-ihg; wcześniej [2, 4] — decyzja 06-09). Lustro w SQL: build_plan_items (sekcja 46.1). Na produkcji plan buduje SQL — tu reguła działa w DEMO, testach i verify-plan.” `plan.js` l.3 komentarz: „budowa i przerwy — sekcja 42, reguła przerwy — sekcja 46”. Testy zielone (GREEN).

**SQL — nowa sekcja 46 w `SUPABASE_FIXES.sql`** (wstaw przed stopką „Done”, l.3040). Nagłówek:
```
-- ─── 46. PACZKA 261007-ihg: PRZERWA TYLKO PO MODULE 3 + BLOKADA EDYCJI TREŚCI ──
-- Addytywnie: CREATE OR REPLACE z IDENTYCZNYMI sygnaturami, nowa tabela/funkcja,
-- DROP POLICY IF EXISTS + CREATE POLICY. Bez DROP funkcji. Sekcja 45 zarezerwowana dla planu 07-13.
-- 46.1 dotyczy TYLKO sesji startowanych po wgraniu (plan zamrażany przy starcie).
-- Stałe MUSZĄ być zgodne z src/lib/gameLogic.js (BREAK_AFTER_MODULES = [3]). Parzystość: `npm run verify-plan`.
-- Wgrywać RĘCZNIE w SQL Editorze projektu ytbwmmqwbfcugouourih — 46.1–46.9 jednym wklejeniem,
-- najlepiej gdy żadna sesja nie trwa; zaraz potem wdrożyć front.
```
`-- 46.1 — build_plan_items: przerwa planowa tylko po module 3 (lustro buildPlanItems, plan.js).` — pełna kopia ciała 42.2 (l.2301–2339) z JEDYNĄ zmianą w l.2320: `v_prev_m IN (2, 4)` → `v_prev_m = 3`; te same REVOKE/GRANT. Na końcu sekcji (Task 3 wstawi 46.2–46.8 PRZED nim):
```
-- 46.9 — znacznik wgrania sekcji 46 (dla `npm run verify-prod`) + przeładowanie cache PostgREST.
CREATE OR REPLACE FUNCTION public.schema_marker_46()
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
REVOKE EXECUTE ON FUNCTION public.schema_marker_46() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.schema_marker_46() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
```

**Skrypty:**
- `scripts/verify-plan.js` `checkBuild()` (l.109–134): porównuj z `fixtures.v3.items` (zmienna `V3 = fixtures.v3` obok `V2`, l.28); etykieta „…reveal 11,5 s, przerwa po module 3”; gdy jedyne różnice dotyczą pola `h` i SQL ma `h` na module 2/4 — dopisz do `why` wskazówkę „→ wgraj sekcję 46 (build_plan_items)”. Hold/pozycje dalej na `V2.items` (czyste funkcje, agnostyczne co do numeru modułu). Zaktualizuj nagłówek pliku (l.5–7).
- `scripts/verify-prod.js` blok 42 (l.276–320): tekst l.281 → „reveal 11,5 s + przerwy planowe”; l.284–292: sprawdzaj tylko `r − c = 11500` (bez warunku `h`, bo reguła zmienia się w 46); l.294–304: do `plan_hold_due` podaj `items.map((x, k) => (k === 0 ? { ...x, h: true } : x))` (funkcja czysta — test granicy nie zależy od reguły). Nowy blok po bloku 44 (przed podsumowaniem l.399): `console.log("\n☕ SEKCJA 46 (przerwa tylko po module 3, blokada edycji):\n")` → `schema_marker_46` (isMissing → `bad("schema_marker_46 — BRAK", "→ uruchom sekcję 46 (paczka 261007-ihg)")`; `true` → ok); `build_plan_items` z `qs` modułów 2,3,4 (id DUMMY, …01, …02), `mods` 2/3/4 po 20 s → ok gdy `!items[0].h && items[1].h === true && !items[2].h` („h tylko po module 3”), inaczej bad z JSON. Zaktualizuj nagłówek pliku (l.3–13) o sekcję 46.
- Komentarze „po modułach 2 i 4” → „po module 3 (sekcja 46; plany sprzed 46: 2 i 4)”: `src/screens/Break.jsx` l.7, `src/screens/LiveView.jsx` l.103, `src/App.jsx` l.132, `scripts/probe-gameplay.js` l.71, l.135, l.217 (logika sondy czyta `h` z planu — l.626 — bez zmian w kodzie).
  </action>
  <verify>
    <automated>node ../../../node_modules/vitest/vitest.mjs run src/lib/plan.test.js src/lib/gameLogic.test.js src/lib/reorder.test.js && grep -q "v_prev_m = 3" SUPABASE_FIXES.sql && grep -q "schema_marker_46" SUPABASE_FIXES.sql && grep -q "schema_marker_46" scripts/verify-prod.js && grep -q "\"v3\"" src/lib/plan.fixtures.json</automated>
  </verify>
  <done>BREAK_AFTER_MODULES = [3]; fixture v3 dodany, v2 nietknięty; testy planu/gameLogic/reorder zielone; sekcja 46 z 46.1 i 46.9 w pliku przed stopką; verify-plan porównuje z v3; verify-prod: blok 42 niezależny od reguły, nowy blok 46.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Potwierdzenie podium (pkt 7) + blokada edycji treści przez superadmina, wymuszona RLS (pkt 8)</name>
  <files>src/components/ConfirmDialog.jsx, src/components/ConfirmDialog.test.jsx, src/lib/contentLock.js, src/lib/contentLock.test.js, src/lib/supabase.js, src/screens/AdminPanel.jsx, SUPABASE_FIXES.sql, scripts/verify-prod.js</files>
  <behavior>
    - ConfirmDialog open=false → nic nie renderuje; open=true → tytuł/treść + „Potwierdź” i „Anuluj”; klik „Potwierdź” woła onConfirm raz; „Anuluj”, klik w tło i Escape wołają onCancel, nie onConfirm
    - canEditContent({role:"superadmin", locked:true}) === true; ({role:"city_admin", locked:true}) === false; ({role:"city_admin", locked:false}) === true; ({role:undefined}) === false
    - friendlyWriteError(null) === null; komunikat z "content locked" / "row-level security" / "zablokowan" → tekst z CONTENT_LOCKED_TEXT + „Zmiana nie została zapisana.”; inny komunikat → bez zmian
  </behavior>
  <action>
**Kontrakty i testy najpierw:**
1. `src/lib/contentLock.js`: `export const CONTENT_LOCKED_TEXT = "🔒 Edycja pytań i modułów jest zablokowana przez superadmina.";` `export function canEditContent({ role, locked })` (superadmin zawsze; city_admin tylko gdy !locked; inaczej false); `export function friendlyWriteError(msg)` wg behavior. + `contentLock.test.js`.
2. `src/components/ConfirmDialog.jsx`: `export default function ConfirmDialog({ open, title, message, confirmLabel = "Potwierdź", cancelLabel = "Anuluj", tone = "gold", onConfirm, onCancel })`. Overlay `position: "fixed", inset: 0, zIndex: 3000` (WYŻEJ niż pełny ekran Live, `zIndex: 2000`, AdminPanel l.1451), tło `rgba(7,2,21,.78)`, karta w stylu panelu (`#0E0435`, border `rgba(255,255,255,.12)`, radius 16, maxWidth 420, animacja `pi`/`su` z global.css jeśli istnieje). `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. Escape → onCancel (listener w useEffect tylko gdy open). Klik w tło → onCancel, klik w kartę nie propaguje. Fokus startowo na „Anuluj” (Enter nie potwierdza przypadkiem — „podwójne zabezpieczenie”). Przycisk potwierdzenia: złoty gradient (`tone="gold"`) albo czerwony (`tone="danger"`), inline styles. + `ConfirmDialog.test.jsx` (RTL, wzór: `src/screens/CodeEntry.test.jsx`).
3. Testy → RED, potem implementacja → GREEN.

**Podium (pkt 7, AdminPanel):** w `SesjaTab` dodaj `const [podiumAsk, setPodiumAsk] = useState(false);`; przycisk l.1521: `onClick={() => setPodiumAsk(true)}`; render `<ConfirmDialog open={podiumAsk} title="Na pewno ogłosić podium?" message="Wyniki zostaną pokazane na ekranie podium (również na projektorze w Live View)." onCancel={() => setPodiumAsk(false)} onConfirm={() => { setPodiumAsk(false); onPodium(results); }} />`. To jedyne wejście do podium (HistoriaTab nie ma przycisku podium; App.jsx l.349 tylko przekazuje callback) — sprawdź grep `onPodium` przed zamknięciem.

**SQL — sekcja 46, podsekcje 46.2–46.8 wstawione MIĘDZY 46.1 a 46.9** (dopisz w nagłówku 46 linię o blokadzie: „46.2–46.8: blokada edycji pytań/modułów — city_admin traci zapis przy content_locked; moduły zapisuje wyłącznie superadmin.”):
- `46.2` — tabela jednowierszowa: `CREATE TABLE IF NOT EXISTS public.app_settings (id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), content_locked BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL);` `INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;` `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` `DROP POLICY IF EXISTS` + `CREATE POLICY "app_settings_admin_select" FOR SELECT USING (public.get_my_role() IN ('city_admin','superadmin'))` i `"app_settings_superadmin_update" FOR UPDATE USING (public.get_my_role() = 'superadmin') WITH CHECK (public.get_my_role() = 'superadmin')` (bez INSERT/DELETE — wiersz jest jeden). `REVOKE ALL ON public.app_settings FROM anon; GRANT SELECT, UPDATE ON public.app_settings TO authenticated;`
- `46.3` — `CREATE OR REPLACE FUNCTION public.content_locked() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT COALESCE((SELECT content_locked FROM public.app_settings WHERE id = 1), false) $$;` `REVOKE … FROM PUBLIC; GRANT EXECUTE … TO anon, authenticated;` (komentarz: anon też — polityki FOR ALL bywają ewaluowane przy SELECT; zwraca tylko boolean).
- `46.4` — `DROP POLICY IF EXISTS "questions_city_admin_write" ON public.questions; CREATE POLICY "questions_city_admin_write" ON public.questions FOR ALL USING (public.get_my_role() = 'city_admin' AND city = public.get_my_city() AND NOT public.content_locked()) WITH CHECK (<to samo>);` (`questions_superadmin` i `questions_admin_select` bez zmian — city_admin dalej czyta pytania). Komentarz: `admin_reorder_questions` (INVOKER) zablokuje się sam przez RLS → RAISE „forbidden or missing question”.
- `46.5` — `DROP POLICY IF EXISTS "modules_admin_all" ON public.modules; DROP POLICY IF EXISTS "modules_superadmin_write" ON public.modules; CREATE POLICY "modules_superadmin_write" ON public.modules FOR ALL USING (public.get_my_role() = 'superadmin') WITH CHECK (public.get_my_role() = 'superadmin');` Komentarz: domyka lukę (city_admin pisał do modules na poziomie bazy); warunek blokady jest tu zbędny, bo superadmin nigdy nie jest blokowany (decyzja CONTEXT); odczyt dla wszystkich zostaje przez `modules_anon_select`.
- `46.6` — `admin_delete_question(p_id UUID)`: pełna kopia z sekcji 32 (l.948–956), po istniejącym sprawdzeniu roli dodaj `IF public.get_my_role() = 'city_admin' AND public.content_locked() THEN RAISE EXCEPTION 'content locked'; END IF;` — te same REVOKE/GRANT.
- `46.7` — `admin_delete_city_questions(p_city TEXT, p_practice BOOLEAN)`: kopia z sekcji 30 (l.870–882) z tym samym warunkiem; te same REVOKE/GRANT.
- `46.8` — komentarz-wyjaśnienie: wymiana polityk w jednym wklejeniu (SQL Editor wykonuje skrypt w jednej transakcji); sondy piszą pytania kluczem service role (omija RLS) — blokada ich nie dotyczy.

**verify-prod.js — rozszerz blok 46** (z Task 2): `content_locked` jako anon → brak błędu i wynik boolean → `ok("content_locked() — działa", "blokada = " + data)`, isMissing → bad „→ sekcja 46.3”; `anon.from("app_settings").select("id").limit(1)` → isDenied → ok „app_settings niedostępne dla anon”, błąd „does not exist”/PGRST205 → bad „→ sekcja 46.2”, brak błędu → bad „anon CZYTA app_settings”.

**Warstwa danych (`src/lib/supabase.js`, sekcja obok QUESTIONS):**
- `export async function getContentLock()` → `{ locked, available }`. DEMO: `localStorage.getItem("fue_content_locked") === "1"`, available true. Supabase: `from("app_settings").select("content_locked").eq("id", 1).maybeSingle()`; błąd (brak tabeli przed sekcją 46, brak uprawnień) → `{ locked: false, available: false }` (bez rzucania — front działa przed i po wgraniu 46, wzór 07-05); inaczej `{ locked: !!data?.content_locked, available: !!data }`.
- `export async function updateContentLock(locked)` → `{ error }`. DEMO: zapis localStorage. Supabase: `const { data: u } = await supabase.auth.getUser();` `update({ content_locked: !!locked, updated_at: new Date().toISOString(), updated_by: u?.user?.id ?? null }).eq("id", 1).select("content_locked")`; błąd → `{ error: error.message }`; 0 wierszy → `{ error: "Nie zapisano — blokadę zmienia tylko superadmin (albo sekcja 46 nie jest wgrana)." }`.
- `updateQuestion` (l.320–332): `.update(updates).eq("id", id).select("id")`; 0 wierszy → `{ error: "Zapis odrzucony — edycja zablokowana albo pytanie nie istnieje." }` (RLS UPDATE zwraca 0 wierszy bez błędu).

**UI blokady (AdminPanel.jsx):**
- Importy: `getContentLock, updateContentLock` z supabase.js; `ConfirmDialog` z `../components/ConfirmDialog.jsx`; `canEditContent, friendlyWriteError, CONTENT_LOCKED_TEXT` z `../lib/contentLock.js`.
- `AdminPanel` (l.2123): `const [lock, setLock] = useState({ locked: false, available: true });` `const refreshLock = () => getContentLock().then(setLock);` `useEffect(refreshLock, [tab])` (odświeżenie przy każdym przełączeniu zakładki — city_admin widzi świeży stan bez Realtime). `const editLocked = !canEditContent({ role: admin?.role, locked: lock.locked });`
- Pasek superadmina (l.2144–2148): obok `CityPicker` wiersz z chipem stanu — `lock.locked` → „🔒 Edycja zablokowana dla adminów miast” (czerwony/złoty akcent), inaczej „🔓 Edycja pytań odblokowana” (zielony); przycisk ghost „Zablokuj edycję” / „Odblokuj edycję” → `ConfirmDialog` (tytuł „Zablokować edycję pytań i modułów?” / „Odblokować edycję?”, treść: „Admini miast nie będą mogli dodawać, edytować, usuwać ani przestawiać pytań. Superadmini edytują dalej.” / odwrotnie; tone danger przy blokowaniu) → `updateContentLock(!lock.locked)` → błąd pokaż inline pod chipem (czerwony tekst), sukces → `refreshLock()`. Gdy `!lock.available`: chip „⚠️ Blokada niedostępna — wgraj sekcję 46 SQL”, przycisk disabled.
- `PytaniaTab` dostaje props `editLocked` i `lockActive` (= `lock.locked`): `<PytaniaTab city={city} editLocked={editLocked} lockActive={lock.locked} />`. Gdy `editLocked`: baner na górze zakładki (`C.card`, czerwona ramka, tekst `CONTENT_LOCKED_TEXT + " Możesz przeglądać pytania; zmiany wprowadza superadmin."`); `disabled` + `opacity: .5` dla „+ Dodaj pytanie” (l.291), „🗑 Usuń wszystkie” (l.292), wyboru pliku i „✅ Importuj wszystkie” (CSV, ~l.300–330), „📋 Kopiuj do” (l.350), ✏️/🗑️ (l.443–444), ↑/↓ (przez `canReorder = !locked && !busy && !editLocked`, l.216 — DnD wyłączy się samo przez `dndEnabled`), „Zapisz” w formularzu (l.387); handlery `openAdd`, `openEdit`, `save`, `remove`, `removeAll`, `importQuestionsCsv`, `copyFromCity`, `commitOrder` robią wczesny `return` przy `editLocked` (obrona w głąb, gdy blokada przyjdzie w trakcie). Gdy superadmin i `lockActive`: mała linia info „🔒 Blokada aktywna — admini miast nie mogą edytować pytań; Ty możesz.”
- Obsługa błędów zapisu (blokada włączona w trakcie): `save` — `const { error } = editId ? await updateQuestion(...) : await addQuestion(...)`; przy błędzie `alert(friendlyWriteError(error))` i NIE zamykaj formularza; `remove` — sprawdź `{ error }` z `deleteQuestion` i pokaż `friendlyWriteError`; pętle `importQuestionsCsv`/`copyFromCity` — przerwij na pierwszym błędzie `addQuestion` z `alert(friendlyWriteError(error))` i `reload()`. Istniejące `confirm()` przy usuwaniu zostają (poza zakresem).
- `ModulyTab` bez zmian w logice (już tylko superadmin, l.2017); opcjonalnie nic więcej.
  </action>
  <verify>
    <automated>node ../../../node_modules/vitest/vitest.mjs run && node ../../../node_modules/vite/bin/vite.js build && grep -q "NOT public.content_locked()" SUPABASE_FIXES.sql && grep -q "modules_superadmin_write" SUPABASE_FIXES.sql && grep -q "updateContentLock" src/screens/AdminPanel.jsx && grep -q "ConfirmDialog" src/screens/AdminPanel.jsx</automated>
  </verify>
  <done>Cały zestaw testów zielony (343 + nowe testy ConfirmDialog/contentLock/xlsx), build OK. Podium wymaga „Potwierdź”. Sekcja 46 kompletna (46.1–46.9) w kolejności numerów; verify-prod blok 46 sprawdza marker, regułę przerwy, content_locked i odmowę anona na app_settings. Superadmin ma przełącznik blokady z potwierdzeniem; city_admin przy blokadzie widzi baner i nieaktywne przyciski, a baza odrzuca zapis.</done>
</task>

</tasks>

<verification>
- `node ../../../node_modules/vitest/vitest.mjs run` — wszystkie testy zielone (343 + nowe).
- `node ../../../node_modules/vite/bin/vite.js build` — bez błędów.
- `grep -n "^-- ─── 46\.\|^-- 46\.[1-9]" SUPABASE_FIXES.sql` — podsekcje 46.1…46.9 po kolei, przed stopką „Done”; brak `DROP FUNCTION` w sekcji 46.
- `grep -rn "uek.jpg\|sgh.png\|uep.png\|uewr.png\|uekat.png" src index.html vite.config.js` — 0 trafień.
- `grep -n "onPodium(" src/screens/AdminPanel.jsx` — wywołanie tylko w `onConfirm` okna.
</verification>

<success_criteria>
- Wszystkie 9 punktów z listy organizatorów zrealizowane zgodnie z decyzjami z CONTEXT (D: infopack zaślepka, TEST_START z offsetem, BREAK_AFTER_MODULES=[3] + 46.1, ConfirmDialog zamiast window.confirm, blokada w RLS + modules tylko superadmin, toFixed(3)).
- SQL wyłącznie addytywny, sygnatury funkcji bez zmian; front działa przed i po wgraniu sekcji 46 (getContentLock z fallbackiem).
- Brak junction node_modules w worktree.
</success_criteria>

<output>
Po zakończeniu utwórz `.planning/quick/261007-ihg-paczka-9-poprawek-przed-twe-27-10/261007-ihg-SUMMARY.md`. SUMMARY MUSI zawierać sekcję **„Kroki ręczne dla Ciebie (po polsku)”** z ponumerowanymi krokami:
1. Sprawdź, że żadna sesja nie trwa (panel → Sesja we wszystkich miastach: brak „Trwa quiz”/„☕ Przerwa”). Sesje wystartowane PRZED wgraniem SQL zachowają stare przerwy (po modułach 2 i 4) — plan jest zamrażany przy starcie.
2. Supabase → projekt `ytbwmmqwbfcugouourih` → SQL Editor → New query → wklej CAŁĄ sekcję 46 z `SUPABASE_FIXES.sql` (od linii `-- ─── 46.` do `NOTIFY pgrst, 'reload schema';` w 46.9 włącznie) → Run → wynik bez błędów.
3. Od razu wdróż front (tak jak w 07-12 — push na `main` / Vercel produkcja) i odczekaj na zakończenie builda.
4. W terminalu w `D:\Projects\fue-quiz-project`: `npm run verify-prod` → kod 0, w bloku „SEKCJA 46” same ✅ (stara wersja skryptu zgłosiłaby fałszywy ❌ w bloku 42 — używaj nowej).
5. `npm run verify-plan` → kod 0 („budowa planu … przerwa po module 3”).
6. Test blokady: zaloguj się jako superadmin → „Zablokuj edycję” → Potwierdź; w drugiej przeglądarce zaloguj się jako admin miasta → zakładka Pytania: baner 🔒, przyciski nieaktywne; wróć do superadmina → „Odblokuj edycję”.
7. Test podium: po zakończonej sesji próbnej kliknij „🏆 Podium” → pojawia się okno → „Anuluj” nic nie robi, „Potwierdź” otwiera podium.
8. Gdy organizatorzy dadzą linki: podmień `INFOPACK_URL` (i `REGISTRATION_URL`) w `src/screens/Welcome.jsx` i wdróż.
9. (Opcjonalnie) sonda `PROBE_FULL=1 npm run sonda` — oczekiwana jedna przerwa planowa (po pytaniu kończącym moduł 3); przed sondą sprawdź resztki [SONDA] i zablokuj uśpienie laptopa.
Oraz akapit „Ryzyko kolejności wdrożenia” z ustaleniem z sekcji context (BREAK_AFTER_MODULES we froncie działa tylko w DEMO/testach; realne ryzyka a–c).
</output>
