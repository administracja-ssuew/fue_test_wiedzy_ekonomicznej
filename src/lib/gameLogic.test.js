import { describe, it, expect } from "vitest";
import { calcPts, cityInfo } from "./gameLogic.js";

describe("calcPts", () => {
  it("returns 750 for correct answer with half time remaining", () => {
    expect(calcPts(45, 90, true)).toBe(750);
  });
  it("returns 1000 for correct answer with full time remaining", () => {
    expect(calcPts(90, 90, true)).toBe(1000);
  });
  it("returns 500 for correct answer with no time remaining", () => {
    expect(calcPts(0, 90, true)).toBe(500);
  });
  it("returns 0 for wrong answer regardless of time", () => {
    expect(calcPts(45, 90, false)).toBe(0);
    expect(calcPts(0, 90, false)).toBe(0);
    expect(calcPts(90, 90, false)).toBe(0);
  });
});

describe("cityInfo", () => {
  it("returns correct abbr for known city", () => {
    expect(cityInfo("Kraków").abbr).toBe("UEK");
  });
  it("returns correct color for known city", () => {
    expect(cityInfo("Kraków").color).toBe("#FFA653");
  });
  it("returns fallback color for unknown city", () => {
    expect(cityInfo("Unknown").color).toBe("#888");
  });
});
