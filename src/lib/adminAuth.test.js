import { describe, it, expect } from "vitest";
import { isAuthDenied, SESSION_EXPIRED_TEXT } from "./supabase.js";

describe("isAuthDenied (odmowa akcji admina z powodu logowania)", () => {
  it("rozpoznaje 'forbidden' z RPC i błędy tokenu", () => {
    expect(isAuthDenied({ message: "forbidden" })).toBe(true);
    expect(isAuthDenied({ message: "JWT expired" })).toBe(true);
    expect(isAuthDenied({ code: "PGRST301", message: "x" })).toBe(true);
    expect(isAuthDenied({ code: "42501", message: "permission denied" })).toBe(true);
  });
  it("nie myli innych błędów z odmową logowania", () => {
    expect(isAuthDenied(null)).toBe(false);
    expect(isAuthDenied({ message: "not paused" })).toBe(false);
    expect(isAuthDenied({ code: "PGRST202", message: "Could not find the function" })).toBe(false);
  });
  it("komunikat mówi adminowi, co zrobić, i że quiz trwa", () => {
    expect(SESSION_EXPIRED_TEXT).toMatch(/F5/);
    expect(SESSION_EXPIRED_TEXT).toMatch(/trwa dalej/);
  });
});
