import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/supabase.js", () => ({ recordViolation: vi.fn() }));

import useAntiCheat from "./useAntiCheat.js";
import { recordViolation } from "../lib/supabase.js";

const hide = () => act(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  document.dispatchEvent(new Event("visibilitychange"));
});
const printScreen = () => act(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "PrintScreen", cancelable: true }));
});
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const calls = () => recordViolation.mock.calls.map((c) => c[0]);
const mount = (props = {}) =>
  renderHook((p) => useAntiCheat(p), { initialProps: { active: true, participantCode: "KRK-1111", sessionId: "S1", ...props } });

describe("useAntiCheat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    recordViolation.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  it("3 wyjścia w 5 s → 1 zapis od razu, po oknie 10 s jeden zapis dosyłający aktualne liczniki", () => {
    const { result } = mount();
    hide();
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ participantCode: "KRK-1111", sessionId: "S1", type: "tab_switch", count: 1, typeCount: 1 });
    advance(2000); hide();
    advance(3000); hide();
    expect(result.current.violations).toBe(3);
    expect(calls()).toHaveLength(1); // nadal w oknie deduplikacji
    advance(4999);
    expect(calls()).toHaveLength(1);
    advance(1); // 10 s od pierwszego zapisu
    expect(calls()).toHaveLength(2);
    expect(calls()[1]).toMatchObject({ type: "tab_switch", count: 3, typeCount: 3 });
    advance(30000);
    expect(calls()).toHaveLength(2); // jeden zapis dosyłający, nie dwa
  });

  it("tab_switch i screenshot_attempt mają osobne okna; count = suma wszystkich typów", () => {
    mount();
    hide();
    printScreen();
    expect(calls()).toHaveLength(2);
    expect(calls()[0]).toMatchObject({ type: "tab_switch", count: 1, typeCount: 1 });
    expect(calls()[1]).toMatchObject({ type: "screenshot_attempt", count: 2, typeCount: 1 });
    advance(1000); printScreen();
    advance(1000); printScreen();
    expect(calls()).toHaveLength(2);
    advance(8000);
    expect(calls()).toHaveLength(3);
    expect(calls()[2]).toMatchObject({ type: "screenshot_attempt", count: 4, typeCount: 3 });
    advance(20000);
    expect(calls()).toHaveLength(3);
  });

  it("odmontowanie z oczekującym dosłaniem → zapis natychmiast, timer wyczyszczony", () => {
    const { unmount } = mount();
    hide();
    advance(1000); hide();
    expect(calls()).toHaveLength(1);
    unmount();
    expect(calls()).toHaveLength(2);
    expect(calls()[1]).toMatchObject({ type: "tab_switch", count: 2, typeCount: 2 });
    advance(20000);
    expect(calls()).toHaveLength(2);
  });

  it("ponowne zamontowanie (ta sama sesja i kod) → licznik ciągły z localStorage", () => {
    const first = mount();
    hide(); advance(1000); hide(); advance(1000); hide();
    expect(first.result.current.violations).toBe(3);
    first.unmount();
    recordViolation.mockClear();

    const second = mount();
    expect(second.result.current.violations).toBe(3);
    advance(20000); hide();
    expect(second.result.current.violations).toBe(4);
    expect(calls().at(-1)).toMatchObject({ type: "tab_switch", count: 4, typeCount: 4 });
  });

  it("inna sesja → licznik od 0", () => {
    const first = mount();
    hide(); advance(1000); hide();
    first.unmount();
    recordViolation.mockClear();

    const other = mount({ sessionId: "S2" });
    expect(other.result.current.violations).toBe(0);
    hide();
    expect(other.result.current.violations).toBe(1);
    expect(calls()[0]).toMatchObject({ sessionId: "S2", count: 1, typeCount: 1 });
  });

  it("zmiana kodu uczestnika w trakcie życia hooka przełącza licznik", () => {
    const h = mount();
    hide();
    expect(h.result.current.violations).toBe(1);
    h.rerender({ active: true, participantCode: "KRK-2222", sessionId: "S1" });
    expect(h.result.current.violations).toBe(0);
  });

  it("ostrzeżenie: showWarning + lastType, dismiss chowa", () => {
    const { result } = mount();
    printScreen();
    expect(result.current.showWarning).toBe(true);
    expect(result.current.lastType).toBe("screenshot_attempt");
    act(() => result.current.dismiss());
    expect(result.current.showWarning).toBe(false);
  });

  it("active=false → brak nasłuchów i zapisów", () => {
    const { result } = mount({ active: false });
    hide();
    expect(result.current.violations).toBe(0);
    expect(calls()).toHaveLength(0);
  });
});
