# Faza 06 — odroczone pozycje

## Z 06-15

- **Podgląd admina (`LiveTab` w `src/screens/AdminPanel.jsx`, ~l. 1539) w przerwie planowej** — hook `useLiveProjection` zwraca już `breakNext` (`{ id, name, icon, color } | null`), ale `LiveTab` pokazuje dla każdej pauzy „Quiz wstrzymany — za chwilę wznowienie.”. `AdminPanel.jsx` należał w tej fali do równoległego planu 06-14, więc nie był edytowany. Do zrobienia (kilka linii): pobrać `breakNext` z hooka i przy `phase === "paused" && breakNext` pokazać „☕ Przerwa — po przerwie: {icon} Moduł {id} — {name}”.
