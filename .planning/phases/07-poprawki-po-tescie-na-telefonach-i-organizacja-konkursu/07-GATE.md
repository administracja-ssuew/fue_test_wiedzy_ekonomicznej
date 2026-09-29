# Faza 7 — bramka

## Sekcja 44

**Wgranie:** 2026-09-29 (rano; potwierdzenie użytkownika „wgrane”, weryfikacja 09:14), ręcznie w SQL Editorze projektu `ytbwmmqwbfcugouourih`.
**Zakres:** `SUPABASE_FIXES.sql` linie 2744–3014 (od `-- ─── 44. FAZA 7…` do `NOTIFY pgrst, 'reload schema';` kończącego 44.14), bez bloku `/* 44.Z */`. Bez błędów SQL.

**Przed wgraniem** (`npm run verify-prod`): jedyne ❌ dotyczyły sekcji 44 (11 pozycji, w tym `validate_participant_code — anon MA DOSTĘP`); sekcje 39–43 zielone.
Sprawdzone przed wgraniem: stary front (bundle przed fazą 7) woła `validate_participant_code` wyłącznie przy PGRST202 z `claim_participant_code` — claim jest na prod od §34, więc REVOKE z 44.7b nie psuje starego frontu.

**Po wgraniu:**

| Polecenie | Wynik |
|-----------|-------|
| `npm run verify-prod` | kod 0 — „PRODUKCJA GOTOWA pod kątem SQL (65 OK, 1 uwag)”; jedyna ⚠️: `debug_request_ip_echo — jeszcze istnieje` (usuwa 44.Z) |
| `npm run verify-plan` | kod 0 — parzystość JS↔SQL 47/47 |
| `npm run verify-code-limit` | kod 0 — „LIMIT PRÓB DZIAŁA (7 OK, 1 uwag)” (przebieg po poprawce skryptu, patrz niżej) |
| `npx vite-node scripts/check-planless.js` | kod 0 — brak sesji running/paused bez planu |

**Kroki verify-code-limit** (kod testowy `PRB-2523`, urządzenia A/B):
- 5 błędnych kodów z urządzenia A → `not_found` ✅
- 6. próba z A → `rate_limited`, `retry_after_s=60` ✅
- urządzenie B z poprawnym kodem → `ok:true` ✅
- po 61 s urządzenie A znów może próbować ✅
- `record_violation` zapisuje `count=3`, `type_count=2` ✅
- `record_violation` z nieistniejącym kodem — cisza (brak wyroczni, brak wiersza) ✅
- resztki: 0 ✅

**Poprawka skryptu (odstępstwo):** pierwszy przebieg `verify-code-limit` zakończył się kodem 1 — test nagłówka IP wysyłał naraz `X-Forwarded-For`, `CF-Connecting-IP` i `X-Real-IP`, a Cloudflare odrzuca całe żądanie z podrobionym `CF-Connecting-IP` (błąd 1000 „DNS points to prohibited IP”, strona HTML). Wynik łączny nic nie mówił o dwóch pozostałych nagłówkach, a skrypt z braku odpowiedzi wyprowadzał „podrabialne”. Skrypt sprawdza teraz każdy nagłówek osobno; odrzucenie przez brzeg Cloudflare = nagłówek nie dociera do PostgREST. Wszystkie kroki limitu przeszły w obu przebiegach.

**Werdykt IP (dosłownie):** `IP: niepodrabialne → wariant 44.Z-A`
- `X-Forwarded-For: 1.1.1.1` → baza widzi prawdziwe IP (bez zmian)
- `CF-Connecting-IP: 2.2.2.2` → żądanie odrzucone przez Cloudflare (nie dociera)
- `X-Real-IP: 3.3.3.3` → baza widzi prawdziwe IP (bez zmian)

## Nagłówek IP

**Werdykt:** `IP: niepodrabialne → wariant 44.Z-A` (z sekcji „Sekcja 44”).
**Wgrany wariant:** 44.Z-A (2026-09-29, potwierdzenie „wgrane 44.Z”) — `code_limit_ip_enabled()` zwraca `true`, `debug_request_ip_echo()` usunięta.
**Uzasadnienie:** żaden z podrobionych nagłówków nie zmienia IP widzianego przez bazę (`X-Forwarded-For`, `X-Real-IP` — bez zmian; `CF-Connecting-IP` — żądanie odrzucane przez Cloudflare). Klucz urządzenia (`p_device`) podaje klient, więc skrypt może go zmieniać przy każdej próbie — dopiero warstwa IP (≥ 100 porażek / 10 min, wyjątek dla urządzeń z przypiętym kodem) zatrzymuje takie przeglądanie kodów przez ścieżkę `claim`.

| Polecenie | Wynik |
|-----------|-------|
| `npm run verify-code-limit` | kod 0 — „LIMIT PRÓB DZIAŁA (8 OK)”; `echo usunięte (44.Z wgrany)`; wszystkie kroki limitu jak wcześniej (kod testowy `PRB-8158`), resztki 0 |
| `npm run verify-prod` | kod 0 — „PRODUKCJA GOTOWA pod kątem SQL (66 OK)”; `debug_request_ip_echo — usunięte` |

**Ryzyko rezydualne:** limit chroni ścieżkę UI (`claim_participant_code`, a `validate_participant_code` jest odebrane anonowi). Inne wyrocznie istnienia kodu — `get_participant_state` („invalid code”), `submit_answer_v2`, `code_exists` (RPC) i anon INSERT do `violations` — nie mają limitu i pozwalają skryptowi przejrzeć kody miasta w kilka minut. Ich utwardzenie (REVOKE `code_exists` od anona, usunięcie polityki anon INSERT na `violations` po przejściu frontu na `record_violation`) to decyzja o sekcji 45 w planie 07-13, wgrywanej PO wdrożeniu frontu fazy 7.

## Sondy

**Data:** 2026-09-29, ok. 09:25–10:40. **Build:** HEAD `d73fe14` (kod fazy 7 kompletny), lokalny bundle `assets/index-bJmiVcCG.js` serwowany przez `vite preview` (:4173). **Stary front na produkcji:** `assets/index-DXJufQaC.js` (sprzed fazy 7).
**Zgoda (dosłownie):** „sondy OK, ale też pamiętaj o implemetacji sond na wszystkich miastach równocześnie!” → sondy wielomiastowe zapisane jako zadanie `.planning/todos/pending/2026-09-29-sonda-wszystkie-miasta-rownoczesnie.md` (równoległe instancje obecnej sondy nie są bezpieczne: każda nadpisuje i przywraca globalne `modules.time_per_q`).

**Przed serią:** `npm test` 343/343 (kod 0), `npm run build` (kod 0), `verify-prod` 66 OK, `verify-plan` 47/47, `verify-code-limit` 8 OK, `check-planless` 0; resztki: pytania `[SONDA]` 0, kody `PRB-%` 0, konta `probe-*` 0; `time_per_q` = 20/30/60/75/20; aktywne sesje: 8× `waiting` (żadna running/paused). Blokada uśpienia (SetThreadExecutionState) przez całą serię, zakończona po serii.

| # | Tryb | Front | Kod | Widoczność vs plan 31,5 s | devDom maks. | devSample maks. | VT (tel.1/tel.2, maks. cb−call) | RTT maks. | idx w bazie | results (zamiatacz) | SC5 | Log |
|---|------|-------|-----|---------------------------|--------------|-----------------|--------------------------------|-----------|-------------|---------------------|-----|-----|
| 1 | podstawowa (SC10) | stary, vercel.app | 0 | 31,0–31,4 s ✅ | 272 ms | 453 ms | — (bez TRACE) | — | 111/111, 0→1→2 | 786 ms | 21 ✅ | p7-01-sc10-old.log |
| 2 | podstawowa TRACE | nowy, :4173 | 0 | 31,0–31,3 s ✅ | 493 ms | 776 ms | 10/10, 142 ms | 1188 ms | 111/111, 0→1→2 | 1302 ms | 21 ✅ | p7-02-basic1.log |
| 3 | podstawowa TRACE | nowy | 0 | 30,8–31,3 s ✅ | 318 ms | 514 ms | 6/10, 155 ms | 730 ms | 112/112, 0→1→2 | 1136 ms | 21 ✅ | p7-03-basic2.log |
| 4 | podstawowa TRACE | nowy | 0 | 30,6–31,3 s ✅ | 734 ms | 778 ms | 9/6, 180 ms | 684 ms | 112/112, 0→1→2 | 814 ms | 21 ✅ | p7-04-basic3.log |
| 5 | podstawowa TRACE | nowy | 0 | 31,2 s ✅ | 294 ms | 254 ms | 6/9, 309 ms | 395 ms | 111/111, 0→1→2 | 735 ms | 21 ✅ | p7-05-basic4.log |
| 6 | podstawowa TRACE | nowy | 0 | 30,8–31,2 s ✅ | 322 ms | 517 ms | 7/9, 185 ms | 642 ms | 107/107, 0→1→2 | 1212 ms | 21 ✅ | p7-06-basic5.log |
| 7 | ADMIN_EXIT | nowy | 0 | 31,0–31,4 s ✅ | 26 ms | 249 ms | — | — | 111/111, 0→1→2 | 813 ms (bez admina) | 21 ✅ | p7-07-adminexit.log |

We wszystkich przebiegach: telefon vs telefon ≤ 1 s, najdłuższy bezruch w pytaniu ≤ 19,9 s (limit 23 s), stare snapshoty 0, VT bez callbacku / nakładających się 0, sprzątanie „✅ czysto”, `check-planless` 0 po każdym przebiegu. Ślady: `test-results/probe-trace-2026-09-29T*.json`.

**Porównanie z serią 3 fazy 6 (devDom 43–304 ms):** 4 z 6 przebiegów na nowym froncie mieszczą się w tym zakresie lub tuż nad nim (26–322 ms); dwa odstające pojedyncze starty: przebieg 2 q3 +493 ms (tel. 2, RTT 1188 ms) i przebieg 4 q3 +734/+688 ms — w przebiegu 4 opóźnienie jest na OBU telefonach jednocześnie, więc to spóźnione zdarzenie po stronie sieci/Realtime, a nie renderowanie na jednym telefonie (VT cb−call w tym przebiegu ≤ 180 ms). Starty q1/q2 (bez VT na starcie pytania, 07-04) są zwykle 1–100 ms.
**P7-VT-SMOOTH: start pytania bez pogorszenia — TAK** (kryterium ≤ 1500 ms spełnione w każdym przebiegu; cel < 400 ms spełniony w 27 z 30 startów pytań na nowym froncie; odstające starty skorelowane z RTT, nie z VT).
**SC10 (stary front po sekcji 44): TAK** — przebieg 1 kod 0 na `index-DXJufQaC.js`.

**Po serii:** resztki 0/0/0, `time_per_q` = 20/30/60/75/20, `check-planless` 0, blokada uśpienia i `vite preview` zakończone.

## Wdrożenie

**Decyzja (dosłownie):** „wdrażaj” (2026-09-29).
**Przed:** `check-planless` 0; `git status` czysty (poza `.claude/settings.json` użytkownika i pustymi `.gitkeep`); `npm run build` z HEAD `02b24bc` → `dist/assets/index-bJmiVcCG.js`.
**Push:** 10:06, `git push origin main` → `272dbf0..02b24bc` (67 commitów fazy 7). **Vercel:** o 10:13:50 `https://fue-quiz.vercel.app/` serwuje `assets/index-bJmiVcCG.js` = lokalny `dist/` ✅.

| # | Tryb | Kod | Widoczność vs plan | devDom maks. | idx w bazie | results (zamiatacz) | SC5 | Log |
|---|------|-----|--------------------|--------------|-------------|---------------------|-----|-----|
| 8 | podstawowa | — (niewykonana) | — | — | — | — | — | p7-08-deploy-basic.log |
| 9 | podstawowa (powtórka) | 0 | 30,8–31,2 s ✅ | 307 ms | 111/111, 0→1→2 | 1246 ms | 21 ✅ | p7-09-deploy-basic.log |
| 10 | ADMIN_EXIT | 0 | 31,1–31,4 s ✅ | 26 ms | 111/111, 0→1→2 | 474 ms (bez admina) | 21 ✅ | p7-10-deploy-adminexit.log |

**Przebieg 8 — błąd środowiska, nie aplikacji:** Playwright nie znalazł `chromium_headless_shell-1223`. O 10:05–10:06 wspólny katalog `%LOCALAPPDATA%\ms-playwright` został zmieniony spoza tego repo (pojawił się `webkit-2359`, zniknęła rewizja 1223 używana przez `@playwright/test` 1.60.0 z lockfile — prawdopodobnie instalacja przeglądarek w innym projekcie). Sonda zakończyła się w SETUP, sprzątanie „✅ czysto”. Naprawa: `npx playwright install chromium` z repo (pobrana rewizja 1223), powtórka = przebieg 9.

**Po:** `check-planless` 0; resztki 0/0/0; `time_per_q` = 20/30/60/75/20; blokada uśpienia zakończona.

## Czasy modułów

**Przed testem na telefonach** (odczyt `modules.time_per_q`, 2026-09-29 po wdrożeniu): moduł 1: 20 s · 2: 30 s · 3: 60 s · 4: 75 s · 5: 20 s — zgodne z oczekiwanymi (20/30/60/75/20).
**Po teście:** _(do uzupełnienia)_
