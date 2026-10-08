---
quick_id: 261008-lx4
status: complete
commit: ac4f52a
date: 2026-10-08
---

# 261008-lx4: Live View doładowuje pytania - podsumowanie

## Co zmieniono

- `src/hooks/useLiveProjection.js`
  - `refreshQuestions()` - `getQuestions(city)` bez równoległych wywołań, nie częściej niż co 2 s.
  - Wołane przy otwarciu, przy pobraniu planu nowej sesji i w tickerze, gdy id pytania z planu
    nie ma na liście.
  - Usunięty fallback `v.idx`: przy braku pytania `gIdx = -1` → `currentQ` puste, ekran nie
    pokazuje cudzego pytania (najwyżej ~2-3 s bez treści, nagłówek i licznik działają).
  - Nowe pola `qNum` / `qTotal` z planu sesji; `mod` z pytania albo z `item.m` planu.
  - Reveal nie jest pobierany dla `idx < 0`.
- `src/screens/LiveView.jsx`, `src/screens/AdminPanel.jsx` (LiveTab): nagłówek
  „Pytanie X/Y” z `qNum`/`qTotal` zamiast z lokalnej listy pytań miasta.
- `src/hooks/useLiveProjection.test.js` (nowy): 2 testy - pytanie spoza listy (stara wersja
  hooka oblewa: pokazywała `qX`), brak zbędnego odpytywania, gdy pytanie jest na liście.

## Weryfikacja

- `npx vitest run` - 361/361 (było 359 + 2 nowe).
- `npm run build` - przechodzi.
- Test regresyjny uruchomiony na starej wersji hooka - oblewa zgodnie z oczekiwaniem.

## Nie zrobione

- Brak wdrożenia na produkcję (Vercel) - do zrobienia razem z kolejną paczką albo osobno.
- Przypadek pytania usuniętego z bazy po starcie sesji: projektor nie pokaże treści i będzie
  ponawiał pobranie listy co 2 s do końca tego pytania (świadomie - lepsze niż złe pytanie).
