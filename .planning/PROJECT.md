# FUE Quiz — Test Wiedzy Ekonomicznej

## What This Is

Własna platforma quizowa Forum Uczelni Ekonomicznych zastępująca Kahoota przy organizacji corocznego Testu Wiedzy Ekonomicznej (TWE). Aplikacja PWA umożliwia przeprowadzenie dwuetapowego konkursu wiedzy ekonomicznej dla ~500 studentów z 5 uczelni — z pełną kontrolą FUE nad brandingiem, danymi i przebiegiem rozgrywki.

## Core Value

Admin FUE naciska "Start" → wszyscy uczestnicy na 5 uczelniach jednocześnie widzą to samo pytanie w czasie rzeczywistym i odpowiadają na własnych telefonach — bez Kahoota, z własną bazą danych i własnym podium.

## Requirements

### Validated

- ✓ Welcome screen z brandingiem FUE — existing
- ✓ Login uczestnika (imię + miasto) — existing
- ✓ Login admina (kod dostępu) — existing
- ✓ Lobby z licznikiem uczestników — existing
- ✓ Ekran pytania z timerem SVG (kolor: zielony→pomarańczowy→czerwony) — existing
- ✓ Feedback po odpowiedzi (punkty / poprawna odpowiedź) — existing
- ✓ Ekran końcowy uczestnika z ukrytym wynikiem — existing
- ✓ Tabela wyników dla admina — existing
- ✓ Ceremonia podium z konfetti — existing
- ✓ PWA (manifest, service worker, offline, ikony) — existing
- ✓ Responsywny layout (mobile + desktop) — existing
- ✓ 32 pytania w 4 modułach z różnymi limitami czasu — existing
- ✓ Design system FUE (fiolet #6B21E8, złoto #F5C518, Bebas Neue + Outfit) — existing

### Active

- [ ] Real-time synchronizacja sesji przez Supabase Channels
- [ ] Sesje quizu z 6-cyfrowym kodem dołączenia
- [ ] Supabase Auth (email/password) dla adminów
- [ ] Pytania z bazy danych PostgreSQL (nie hardkodowane)
- [ ] Uczestnicy zapisywani w bazie (tabela participants)
- [ ] Odpowiedzi zapisywane w bazie (tabela answers)
- [ ] Live leaderboard dla admina z Supabase Realtime
- [ ] Panel admina — zarządzanie pytaniami (CRUD)
- [ ] Historia edycji i archiwum wyników
- [ ] Statystyki per miasto (aggregate ranking)
- [ ] Dwa tryby: I etap (równoległe sesje per uczelnia) vs. finał (25 uczestników razem)

### Out of Scope

- Redux / React Query — niepotrzebne na tę skalę, useState + Supabase klient wystarczy
- Zewnętrzne biblioteki UI (MUI, Chakra, Tailwind) — design jest custom, nie zmieniamy
- Capacitor / React Native — PWA wystarczy dla tego use case
- Push notyfikacje FCM — Web Push API jako opcja v3, nie teraz
- QR kod dołączenia — nice-to-have v3
- Screensaver dla projektora — nice-to-have v3
- Eksport PDF — nice-to-have v3
- Dźwięki Web Audio — nice-to-have v3

## Context

- **Organizacja**: Forum Uczelni Ekonomicznych (FUE) — porozumienie samorządów 5 uczelni: PSUEK Katowice, UEK Kraków, UEP Poznań, SGH Warszawa, UEW Wrocław
- **Konkurs**: Test Wiedzy Ekonomicznej (TWE) — coroczny, 7+ edycji, dotychczas na Kahoocie
- **Skala**: ~100 uczestników per uczelnia (I etap), 25 finalistów (finał ogólnopolski)
- **Dev**: Mikołaj, student UEW Wrocław, aktywnie zaangażowany w FUE
- **Prototyp**: Działający frontend w `fue-quiz/` — React 18 + Vite + PWA, wszystkie ekrany gotowe, brak backendu
- **Problem z obecnym setupem**: Kahoot = obcy branding, brak własnych danych, zero personalizacji, anonimowe wyniki, brak ról organizator/uczestnik
- **Deployment**: Vercel (frontend) + Supabase Cloud (backend) — Vercel już skonfigurowany

## Constraints

- **Stack**: React 18 + Vite + vite-plugin-pwa + Supabase — nie zmieniamy
- **Design**: Custom CSS-in-JS inline styles, bez zewnętrznych bibliotek UI — nie zmieniamy
- **Timeline**: Następna edycja TWE — prawdopodobnie jesień 2026, ale im wcześniej tym lepiej
- **Skala**: Max ~500 jednoczesnych połączeń (100 per uczelnia × 5 miast) — Supabase Free tier powinien wystarczyć
- **Środowisko dewelopera**: Windows, VS Code, Node.js — uwaga na ścieżki i polecenia bash
- **Bez testów**: Brak frameworka testowego w projekcie — dodać Vitest przy okazji struktury

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Supabase zamiast Firebase | Postgres (relacyjny), RLS, open source, darmowy tier hojniejszy | — Pending |
| Supabase Broadcast channels dla sync | Niski latency, bez zapisywania do DB, idealne dla stanów quizu | — Pending |
| PWA zamiast natywna aplikacja | Zero instalacji przez sklep, działa na każdym telefonie przez przeglądarkę | ✓ Good |
| Bez Redux / React Query | Supabase klient + useState wystarczy na tę skalę, mniejsza złożoność | — Pending |
| Monolityczny App.jsx → podzielony na screens/ | Obecny App.jsx ma ~1100 linii — refactor do plików per ekran wymagany przy backendzie | — Pending |
| 6-cyfrowy kod sesji zamiast stałego hasła | Wiele równoległych sesji (I etap 5 miast + finał), Kahoot-style UX | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-24 after initialization*
