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
