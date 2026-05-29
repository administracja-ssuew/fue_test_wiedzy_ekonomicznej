# Testy FUE Quiz

Czterowarstwowa strategia testów, ze szczególnym naciskiem na **funkcjonalność**
i **precyzję realtime** (w quizie liczy się każda sekunda).

| Warstwa | Co sprawdza | Czym | Sieć? | Komenda |
|---|---|---|---|---|
| 1. Unit | Logika punktów, **projekcja czasu i synchronizacja sekund** | Vitest | nie | `npm test` |
| 2. Integracja | Warstwa danych: CRUD, sesja, scoring, ranking | bot-runner (Node) | tak | `npm run bot` |
| 3. Bezpieczeństwo | Granice RLS / RPC z perspektywy anon | rls-check (Node) | tak | `npm run rls` |
| 4. Obciążenie/Realtime | 100/500 połączeń, latencja, exactly-once | load-runner (Node) | tak | `LOAD_TEST_CONFIRM=1 npm run load` |

---

## ⚠️ Środowisko — używaj projektu STAGING

Warstwy 2–4 **piszą do bazy** wskazanej w `VITE_SUPABASE_URL`. Nie odpalaj ich na
produkcji, zwłaszcza blisko wydarzenia — zużywają quotę Realtime i tworzą obciążenie.
Zalecane: osobny projekt Supabase z tym samym schematem (`SUPABASE_SCHEMA.sql` +
`SUPABASE_FIXES.sql`). Każdy skrypt sprząta po sobie, ale staging eliminuje ryzyko.

`.env` (nie commitowany):
```
# PRODUKCJA — aplikacja + npm run bot
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...        # Settings → API → service_role (sekret)
BOT_ADMIN_EMAIL=...            # tylko dla npm run bot
BOT_ADMIN_PASSWORD=...

# STAGING — TYLKO npm run load / npm run rls (aplikacja ich nie używa)
VITE_SUPABASE_URL_STAGE=...
VITE_SUPABASE_ANON_KEY_STAGE=...
SUPABASE_SERVICE_KEY_STAGE=...
```
`load`/`rls` używają kluczy `*_STAGE` (fallback na produkcyjne z ostrzeżeniem),
więc produkcji nie trzeba „przełączać z powrotem".

### Postawienie projektu staging (5 min, darmowe)
1. supabase.com → New project (np. `fue-quiz-staging`).
2. SQL Editor → uruchom **najpierw `SUPABASE_SCHEMA.sql`** (cały), **potem `SUPABASE_FIXES.sql`** (sekcje 1–21).
   Kolejność jest ważna — FIXES zakłada, że tabele ze SCHEMA już istnieją.
3. Settings → API → skopiuj Project URL / anon / service_role do kluczy `*_STAGE` w `.env`.

---

## 1. Unit (`npm test`) — uruchamiane też w CI, bez sieci

Najważniejsza dla precyzji realtime. Pokrywa m.in.:
- `calcPts` — punktacja na granicach,
- `projectLiveState` — projekcja stanu sesji na fazę (waiting/paused/quiz/reveal),
  odliczanie 3→2→1, okno reveal, granice sekund, clamp indeksu, regresja „90s",
- `remainingSeconds` — **dowód, że uczestnik i LiveView pokazują tę samą sekundę**
  (równoważność wzorów sprawdzana co 100 ms przez całe pytanie dla 30/45/60/90 s).

To tutaj pilnujemy, że „sekunda się nie rozjedzie" — deterministycznie, bez flaków.

## 2. Integracja (`npm run bot`)

Pełny przebieg quizu botami przez warstwę `src/lib/supabase.js`: admin CRUD,
generowanie kodów, dołączanie, odpowiadanie, ranking. Konfiguracja:
`BOT_CITY`, `BOT_COUNT`, `BOT_ANSWER_DELAY_MS`.

## 3. Bezpieczeństwo (`npm run rls`)

Z osobnym klientem **anon** sprawdza granice wprowadzone w `SUPABASE_FIXES.sql` (16–20):
- anon nie czyta `answers` ani `get_session_results`,
- `get_participant_answers` zwraca tylko własne odpowiedzi,
- anon nie zmienia `quiz_sessions` (RLS) ani nie woła `update_quiz_session_admin`,
- anon może wstawić odpowiedź i czytać sesję/pytania (poprawna ścieżka gry),
- dedupe `23505` działa.

Jeśli któraś asercja padnie → brakuje uruchomionej sekcji SQL 16–20.

## 4. Obciążenie / Realtime (`LOAD_TEST_CONFIRM=1 npm run load`)

Symuluje N uczestników z **osobnym WebSocketem każdy** (jak N telefonów),
z podziałem na miasta. Parametry:
```
LOAD_TOTAL=100          # łączna liczba uczestników (dzielona na miasta)
LOAD_ROUNDS=8           # liczba pytań
LOAD_CITIES=Kraków,Warszawa,Poznań,Wrocław,Katowice
LOAD_ANSWER_MAX_MS=4000 # maks. losowe opóźnienie odpowiedzi
```

Mierzy i raportuje:
- **liczbę utrzymanych połączeń Realtime** — jeśli < N, trafiono w limit planu
  (Supabase Free = 200 jednoczesnych; to empiryczna weryfikacja decyzji o Pro),
- **latencję advance→odbiór** u uczestnika: p50 / p95 / p99 / max,
- throughput i błędy zapisu odpowiedzi, duplikaty (23505),
- **exactly-once advance** — przy ~50 równoczesnych `advanceSessionQuestion`
  wygrywa dokładnie jeden (optimistic lock),
- reconciliację: liczba odpowiedzi w bazie.

### Progi akceptacji (orientacyjne — quiz)
- Latencja advance→odbiór **p95 < 1.5 s** (cel: wszyscy widzą pytanie ~równocześnie).
- **Wszystkie** połączenia Realtime wstają (inaczej: limit planu → Pro + zapas).
- **0** błędów zapisu odpowiedzi pod obciążeniem.
- Exactly-once advance: zawsze 1.

### Skala 500 i sharding
500 WebSocketów z jednej maszyny (zwł. Windows) może uderzyć w limity socketów.
Aby przetestować pełne 500: uruchom kilka procesów/VM z różnym `LOAD_CITIES`
(np. każdy proces obsługuje 1 miasto × 100), albo `LOAD_TOTAL` rozbity na shardy.
Pamiętaj: 500 połączeń wymaga planu Pro (Free=200) — to test, który to potwierdzi.

---

## Scenariusze edge do ręcznej weryfikacji (UI, warstwa „realny klient")

Tego Node nie złapie — sprawdź na 2 telefonach + LiveView + panel:
start z odliczaniem 3‑2‑1; zgodność licznika i okna reveal (5 s) między ekranami;
pauza/wznowienie (LiveView „Wstrzymano" i wraca); „Powtórz pytanie"; odświeżenie
telefonu w trakcie (wynik nie znika); zmiana czasu modułu w bazie odzwierciedlona
wszędzie (regresja 90 s).
