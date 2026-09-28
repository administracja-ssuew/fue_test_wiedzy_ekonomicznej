---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 10
subsystem: admin-pytania
tags: [kolejnosc-pytan, drag-and-drop, reorder, admin-panel, vitest, tdd, ui-spec-6]
requires:
  - "07-05: wzorzec soft-fallbacku PGRST202 dla RPC sekcji 44"
  - "src/lib/plan.js buildPlanItems (wejście posortowane module, sort_order, id)"
provides:
  - "src/lib/reorder.js: moveItem, moveById, applyModuleOrder"
  - "supabase.js: reorderQuestions(ids, { city, isPractice }), getActiveQuizSession(city, isPractice)"
  - "PytaniaTab: przeciąganie kart (≥ 900 px), ↑/↓, zapis z rollbackiem, blokada w trakcie quizu"
affects: [07-12]
tech-stack:
  added: []
  patterns:
    - "Natywne HTML5 drag & drop bez bibliotek DnD"
    - "Optymistyczny setState + zapis + rollback przy błędzie"
key-files:
  created:
    - src/lib/reorder.js
    - src/lib/reorder.test.js
  modified:
    - src/lib/supabase.js
    - src/screens/AdminPanel.jsx
decisions:
  - "applyModuleOrder z niepełną / nieznaną listą id zwraca kopię bez zmian (ochrona przed zgubieniem pytań z widoku)"
  - "Miejsce upuszczenia (przed / za) liczone w onDrop z samego zdarzenia, a nie ze stanu overPlace — brak ryzyka nieaktualnej wartości"
  - "onDragOver ignoruje przeciągania spoza listy (np. plik z pulpitu) — preventDefault tylko, gdy przeciągana jest nasza karta"
  - "Po zapisie sprawdzany jest zakres (miasto|pula); jeśli admin przełączył miasto lub pulę w trakcie, wynik zapisu nie nadpisuje nowej listy"
  - "Zmiana miasta / puli zeruje saveState i blokadę przed ponownym odczytem sesji"
metrics:
  duration: 15min
  completed: 2026-09-28
  tasks: 2
  files: 4
---

# Faza 07 Plan 10: Zmiana kolejności pytań w module — podsumowanie

Zakładka Pytania pozwala teraz ustawiać kolejność pytań w module bez kasowania i ponownego dodawania: na komputerze przeciąganiem całej karty (natywne HTML5 DnD, uchwyt ⠿), wszędzie przyciskami ↑/↓ (na telefonie 44×44). Lista zmienia się od razu, a zapis idzie jednym RPC `admin_reorder_questions` (sekcja 44) z gęstą numeracją 0..n-1; przed wgraniem sekcji 44 działa fallback N × `update sort_order`, w DEMO — localStorage. Gdy w mieście trwa quiz dla tej samej puli (`running`/`paused`), przestawianie jest zablokowane z żółtym komunikatem.

## Zadania

| # | Zadanie | Commity | Pliki |
|---|---------|---------|-------|
| 1 | reorder.js + testy (TDD) i warstwa danych | `336ebe4` (RED), `d6710b5` (GREEN) | src/lib/reorder.js, src/lib/reorder.test.js, src/lib/supabase.js |
| 2 | PytaniaTab — przeciąganie, ↑/↓, zapis, blokada | `8c9c729` | src/screens/AdminPanel.jsx |

## Co powstało

**reorder.js** (14 testów)
- `moveItem(list, from, to)` — kopia; indeks poza zakresem albo `from === to` → kopia bez zmian.
- `moveById(list, dragId, targetId, place)` — `before`/`after`, indeks celu przeliczony po wyjęciu elementu; ten sam lub nieznany id → bez zmian.
- `applyModuleOrder(questions, module, orderedIds)` — bez globalnego sortowania: pytania modułu wstawione na dotychczasowe pozycje modułu jako kopie z `sort_order` = indeks; inne moduły (także bez `sort_order`) to te same obiekty.
- Test z `buildPlanItems`: plan po `applyModuleOrder` ma nową kolejność id w module (kryterium ROADMAP 8); remisy `sort_order` (0,0,1) → gęsto 0,1,2.

**supabase.js** (dopisane po `deleteQuestion`, reszta bez zmian)
- `reorderQuestions(ids, { city, isPractice })` — RPC `admin_reorder_questions({ p_ids })`; PGRST202 / „Could not find the function” → `Promise.all` N × `update({ sort_order: i })`; inny błąd → `{ error }`; DEMO: `fue_questions_*` / `fue_practice_*` + stabilne sortowanie.
- `getActiveQuizSession(city, isPractice)` — sesja `running`/`paused` dla danej puli albo `null` (DEMO: `fue_session_${city}[_practice]`).

**PytaniaTab**
- Karta: `[⠿] [numer] [treść + odpowiedzi] [↑ ↓] [✏️ 🗑️]`, `gap: 8`; na telefonie ↑ ↓ ✏️ 🗑️ w jednym rzędzie pod treścią (↑↓ z lewej, ✏️🗑️ z prawej).
- Przeciąganie tylko przy `isDesktop && canReorder`: `setData("text/plain")` (Firefox), karta przeciągana `opacity: .4`, cel z obrysem `rgba(107,33,232,.6)` i linią 2 px nad/pod zależnie od połowy karty, `onDragEnd` (Esc / poza listą) czyści stan bez zapisu.
- `commitOrder`: optymistyczny `setQuestions` → świeże `getActiveQuizSession` (trwa → rollback + blokada) → `reorderQuestions` → błąd: rollback + komunikat czerwony; sukces: „✓ Kolejność zapisana” znika po 2 s.
- Nad listą opis „Przeciągnij pytanie (komputer) albo użyj ↑/↓…” i status zapisu `aria-live="polite"` (Zapisuję kolejność… / ✓ Kolejność zapisana / błąd).
- Blokada: karta `🔒 Quiz w mieście {city} trwa. …`, uchwyty ukryte, `draggable={false}`, ↑/↓ `disabled` z `title="Zablokowane w trakcie quizu"`. ✏️/🗑️ i dodawanie pytań bez zmian.
- ✏️/🗑️ mają `aria-label` i `title` „Edytuj pytanie” / „Usuń pytanie”.

## Weryfikacja

- `npx vitest run src/lib/reorder.test.js src/lib/plan.test.js` — 142/142.
- `npx vitest run` (całość) — 16 plików, 324/324.
- `npx vite build` — kod 0.
- Wszystkie kryteria `grep` z planu spełnione (`setData("text/plain"` = 1, `⠿` = 1, aria-label ↑/↓ = 2, `reorderQuestions(` = 1, `getActiveQuizSession(` = 2, teksty stanów zapisu po 1, `e.preventDefault()` w onDragOver i onDrop).
- Nic nie było uruchamiane na produkcyjnym Supabase. Test ręczny (przestawienie → nowy start w nowej kolejności; blokada w trakcie quizu) zostaje w bramce 07-12.

## Odchylenia od planu

### Poprawki automatyczne

**1. [Reguła 1 — błąd] Wyścig przy przełączeniu miasta / puli w trakcie zapisu**
- **Znalezione w:** zadaniu 2
- **Problem:** rollback `setQuestions(prev)` po błędzie zapisu wstawiłby pytania poprzedniego miasta do widoku nowego miasta.
- **Poprawka:** `scopeRef` (`city|isPractice`); po każdym `await` w `commitOrder` wynik jest ignorowany, jeśli zakres się zmienił. Efekt ładujący blokadę ma flagę `alive` i zeruje `saveState`/`lockedSession`.
- **Commit:** `8c9c729`

**2. [Reguła 2 — poprawność] Ochrony w logice przestawiania**
- `applyModuleOrder` przy niepełnej liście id zwraca kopię bez zmian (zamiast gubić pytania); `commitOrder` nic nie zapisuje, gdy kolejność się nie zmieniła; `onDragOver` reaguje tylko na przeciąganie naszej karty.
- **Commity:** `d6710b5`, `8c9c729`

Drobne: miejsce upuszczenia liczone z `onDrop` (nie ze stanu), nieaktywne ↑/↓ mają `cursor: not-allowed`, treść karty ma `minWidth: 0` (zawijanie długich pytań obok przycisków), błąd zapisu logowany `console.error`.

## Known Stubs

Brak.

## Self-Check: PASSED

- FOUND: src/lib/reorder.js, src/lib/reorder.test.js, src/lib/supabase.js, src/screens/AdminPanel.jsx
- FOUND commits: 336ebe4, d6710b5, 8c9c729
