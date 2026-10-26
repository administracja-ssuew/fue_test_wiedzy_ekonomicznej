# Quick 261026-wfx — sesja próbna gra pulą próbną

**Błąd (prod 26.10):** `start_quiz_session_v2` budował plan zawsze z puli głównej (`build_session_plan(city)`, `is_practice = false`) — próbna sesja Wrocławia dostała 50 pytań zamiast 4 próbnych. Panel admina i Live View ładowały tylko pulę główną.

1. SQL sekcja 48 (addytywna): `build_session_plan(TEXT, BOOLEAN)`; `start_quiz_session_v2` (kopia 42.4) przekazuje `is_practice` sesji; `schema_marker_48`. Blok 48 w `verify-prod`.
2. Front: AdminPanel i useLiveProjection trzymają pulę główną + próbną (główna pierwsza); pytanie bieżące i licznik odpowiedzi w panelu po id z planu; Lobby liczy pytania z puli zgodnej z sesją.
3. Test: Live View pokazuje pytanie próbne z planu (nie z puli głównej pod tym samym indeksem).
4. Weryfikacja (NA BAZIE TESTOWEJ — decyzja użytkownika 26.10): plan właściwy identyczny jak `build_session_plan(TEXT)` dla 5 miast; plan próbny = pula próbna; prawdziwy start sesji próbnej kontem admina. Wycofanie: zrzut 42.4 z prod (scratchpad sesji b281c2cb, rollback-48.sql).
