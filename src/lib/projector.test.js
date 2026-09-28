import { describe, it, expect } from "vitest";
import { projectorIdlePhase } from "./projector.js";

describe("projectorIdlePhase (G8)", () => {
  it("koniec testu z planu (results / ended) → ekran końca", () => {
    expect(projectorIdlePhase({ phase: "results" }, "results")).toBe("ended");
    expect(projectorIdlePhase({ phase: "ended" }, "ended")).toBe("ended");
  });

  it("plan jeszcze się nie pobrał, ale sesja zakończona → ekran końca", () => {
    expect(projectorIdlePhase(null, "results")).toBe("ended");
    expect(projectorIdlePhase(null, "ended")).toBe("ended");
  });

  it("lobby / legacy → poczekalnia (bez zmian)", () => {
    expect(projectorIdlePhase({ phase: "lobby" }, "waiting")).toBe("waiting");
    expect(projectorIdlePhase({ phase: "legacy" }, "running")).toBe("waiting");
  });

  it("brak planu i sesji → poczekalnia", () => {
    expect(projectorIdlePhase(null, "waiting")).toBe("waiting");
    expect(projectorIdlePhase(undefined, undefined)).toBe("waiting");
  });
});
