---
created: 2026-09-29
title: Sonda rozgrywki na wszystkich 5 miastach równocześnie
area: scripts/probe-gameplay.js
priority: high
source: użytkownik (2026-09-29, przy zgodzie na serię sond 07-12) — „pamiętaj o implementacji sond na wszystkich miastach równocześnie!”
---

## Problem

Core Value to 5 uczelni naraz, a sonda (`PROBE_CITY`) testuje jedno miasto na przebieg. Równoległe uruchomienie 5 kopii NIE jest bezpieczne:
- każda sonda globalnie zmienia `modules.time_per_q` i przywraca go po przebiegu → wyścig zapis/przywrócenie, ryzyko zostawienia złych czasów na produkcji;
- każda zakłada konto admina / kody / pytania `[SONDA]` — sprzątanie musi działać per miasto bez kasowania resztek innej instancji;
- wymaga oczekującej sesji w każdym mieście.

## Kierunek

Tryb `PROBE_CITIES=all` (albo osobny koordynator `scripts/probe-multicity.js`): jedna faza przygotowania (zapis czasów modułów RAZ, ustawienie krótkich czasów), 5 równoległych instancji rozgrywki (po jednej na miasto, własne telefony-boty), wspólne przywrócenie czasów i sprzątanie na końcu (także przy przerwaniu — try/finally + SIGINT). Raport per miasto + porównanie rozjazdu startu pytania między miastami. Uwzględnić limit połączeń Realtime (Free vs Pro — patrz [[skala-i-refresh-luka-admina]]).

## Kiedy

Po bramce 07-12 (seria sond 1-miastowych) — jako quick task albo plan luk fazy 7; przed próbą generalną.
