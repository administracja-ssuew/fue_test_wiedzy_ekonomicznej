// ─── Zmiana kolejności pytań w module (P7-Q-REORDER) ─────────────────────────
// Czyste funkcje bez bibliotek DnD (constraint projektu: bez zewnętrznych bibliotek UI).
// Przeciąganie w PytaniaTab to natywne HTML5 drag & drop + przyciski ↑/↓.

// Kopia listy z elementem przeniesionym z `from` na `to`; indeks poza zakresem → kopia bez zmian.
export function moveItem(list, from, to) {
  const out = [...(list || [])];
  const n = out.length;
  const ok = (i) => Number.isInteger(i) && i >= 0 && i < n;
  if (!ok(from) || !ok(to) || from === to) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

// Kopia listy obiektów { id } z `dragId` wstawionym przed / za `targetId`.
export function moveById(list, dragId, targetId, place = "before") {
  const out = [...(list || [])];
  if (dragId === targetId) return out;
  const from = out.findIndex((x) => x.id === dragId);
  if (from < 0 || out.findIndex((x) => x.id === targetId) < 0) return out;
  const [x] = out.splice(from, 1);
  let to = out.findIndex((y) => y.id === targetId);
  if (place === "after") to += 1;
  out.splice(to, 0, x);
  return out;
}

// Nowa tablica pytań: pytania modułu `module` w kolejności `orderedIds` (kopie z sort_order = indeks)
// na dotychczasowych pozycjach tego modułu. Bez globalnego sortowania — lista z bazy jest już
// w kolejności (module, sort_order, id), a sort_order może nie przyjść. Inne pytania bez zmian.
export function applyModuleOrder(questions, module, orderedIds) {
  const src = questions || [];
  const positions = [];
  src.forEach((q, i) => { if (q.module === module) positions.push(i); });
  const byId = new Map(src.filter((q) => q.module === module).map((q) => [q.id, q]));
  const ordered = (orderedIds || []).map((id) => byId.get(id)).filter(Boolean);
  // Lista id niepełna / nieznana → bez zmian (ochrona przed zgubieniem pytań).
  if (ordered.length !== positions.length) return [...src];
  const out = [...src];
  positions.forEach((pos, i) => { out[pos] = { ...ordered[i], sort_order: i }; });
  return out;
}
