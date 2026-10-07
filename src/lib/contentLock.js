// ─── Blokada edycji treści (paczka 261007-ihg, sekcja 46 SQL) ────────────────
// Superadmin włącza/wyłącza blokadę (app_settings.content_locked). Przy włączonej
// city_admin nie może dodawać/edytować/usuwać/przestawiać pytań - wymusza to RLS
// w bazie (46.4-46.7); tu tylko logika UI. Czysta logika, bez React/supabase.

export const CONTENT_LOCKED_TEXT = "🔒 Edycja pytań i modułów jest zablokowana przez superadmina.";

// Superadmin zawsze; city_admin tylko bez blokady; inne role - nigdy.
export function canEditContent({ role, locked } = {}) {
  if (role === "superadmin") return true;
  if (role === "city_admin") return !locked;
  return false;
}

// Komunikat błędu zapisu → tekst dla admina. Odmowy RLS/blokady (także cichy brak
// zmienionych wierszy z updateQuestion) zamieniamy na jasny komunikat o blokadzie.
export function friendlyWriteError(msg) {
  if (!msg) return null;
  if (/content locked|row-level security|zablokowan/i.test(String(msg))) {
    return `${CONTENT_LOCKED_TEXT} Zmiana nie została zapisana.`;
  }
  return msg;
}
