import { describe, it, expect } from "vitest";
import { canEditContent, friendlyWriteError, CONTENT_LOCKED_TEXT } from "./contentLock.js";

describe("canEditContent", () => {
  it("superadmin edytuje zawsze — także przy blokadzie", () => {
    expect(canEditContent({ role: "superadmin", locked: true })).toBe(true);
    expect(canEditContent({ role: "superadmin", locked: false })).toBe(true);
  });

  it("city_admin tylko bez blokady", () => {
    expect(canEditContent({ role: "city_admin", locked: true })).toBe(false);
    expect(canEditContent({ role: "city_admin", locked: false })).toBe(true);
  });

  it("brak roli / inna rola → false", () => {
    expect(canEditContent({ role: undefined })).toBe(false);
    expect(canEditContent({ role: "participant", locked: false })).toBe(false);
    expect(canEditContent({})).toBe(false);
  });
});

describe("friendlyWriteError", () => {
  it("brak błędu → null", () => {
    expect(friendlyWriteError(null)).toBe(null);
    expect(friendlyWriteError(undefined)).toBe(null);
    expect(friendlyWriteError("")).toBe(null);
  });

  it("błędy blokady/RLS → komunikat o blokadzie", () => {
    const want = `${CONTENT_LOCKED_TEXT} Zmiana nie została zapisana.`;
    expect(friendlyWriteError("content locked")).toBe(want);
    expect(friendlyWriteError('new row violates row-level security policy for table "questions"')).toBe(want);
    expect(friendlyWriteError("Zapis odrzucony — edycja zablokowana albo pytanie nie istnieje.")).toBe(want);
  });

  it("inny komunikat → bez zmian", () => {
    expect(friendlyWriteError("network error")).toBe("network error");
  });

  it("CONTENT_LOCKED_TEXT zawiera kłódkę i wskazuje superadmina", () => {
    expect(CONTENT_LOCKED_TEXT).toContain("🔒");
    expect(CONTENT_LOCKED_TEXT).toContain("superadmina");
  });
});
