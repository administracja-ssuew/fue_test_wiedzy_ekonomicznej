import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// Anti-cheat nie jest przedmiotem testu — cały hook podmieniony.
vi.mock("../hooks/useAntiCheat.js", () => ({
  default: () => ({ violations: 0, showWarning: false, lastType: "", dismiss: () => {} }),
}));

import Quiz from "./Quiz.jsx";

// P7-IOS-HAPTIC — nakładka <label> z ukrytym przełącznikiem (iOS 18+) w kafelku odpowiedzi.
function baseProps(extra = {}) {
  return {
    item: { id: "q1", q: "Pytanie?", opts: ["A1", "B1", "C1", "D1"], tpq: 20 },
    mod: { id: 1, name: "Mikro", icon: "📘", color: "#6B21E8" },
    phase: "quiz",
    secondsLeft: 10,
    opensAt: Date.now(),
    picked: null,
    answerStatus: null,
    correctAns: null,
    qNumGlobal: 1,
    totalQuestions: 3,
    qNumInModule: 1,
    moduleCount: 3,
    correctTotal: 0,
    isDesktop: false,
    isPractice: false,
    participantCode: "KRK-1111",
    sessionId: "s1",
    onPick: vi.fn(),
    ...extra,
  };
}

function enableSwitch() {
  Object.defineProperty(HTMLInputElement.prototype, "switch", { configurable: true, writable: true, value: false });
}

const tiles = (container) => Array.from(container.querySelectorAll("button.ans-btn"));

afterEach(() => {
  delete HTMLInputElement.prototype.switch;
  delete navigator.vibrate;
});

describe("Quiz — haptyka iOS (P7-IOS-HAPTIC)", () => {
  it("przełącznik dostępny, faza quiz, brak wyboru → każdy kafelek ma label[aria-hidden] z input[switch]", () => {
    enableSwitch();
    const { container } = render(<Quiz {...baseProps()} />);
    const t = tiles(container);
    expect(t).toHaveLength(4);
    for (const btn of t) {
      const label = btn.querySelector('label[aria-hidden="true"]');
      expect(label).not.toBeNull();
      const input = label.querySelector('input[type="checkbox"]');
      expect(input).not.toBeNull();
      expect(input.hasAttribute("switch")).toBe(true);
      expect(input.style.visibility).toBe("hidden");
      expect(input.style.display).not.toBe("none");
    }
  });

  it("dotknięcie nakładki kafelka 0 → onPick wywołane dokładnie raz z 0", () => {
    enableSwitch();
    const onPick = vi.fn();
    const { container } = render(<Quiz {...baseProps({ onPick })} />);
    const label = tiles(container)[0].querySelector("label");
    fireEvent.click(label);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(0);
  });

  it("po wyborze albo w fazie reveal → brak nakładek", () => {
    enableSwitch();
    const picked = render(<Quiz {...baseProps({ picked: 1 })} />);
    expect(picked.container.querySelectorAll("button.ans-btn label")).toHaveLength(0);
    picked.unmount();
    const reveal = render(<Quiz {...baseProps({ phase: "reveal", secondsLeft: 5 })} />);
    expect(reveal.container.querySelectorAll("button.ans-btn label")).toHaveLength(0);
  });

  it("brak przełącznika (Android) → brak nakładek; kliknięcie kafelka 2 → onPick(2) raz + vibrate(15)", () => {
    const vibrate = vi.fn();
    navigator.vibrate = vibrate;
    const onPick = vi.fn();
    const { container } = render(<Quiz {...baseProps({ onPick })} />);
    expect(container.querySelectorAll("button.ans-btn label")).toHaveLength(0);
    fireEvent.click(tiles(container)[2]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(2);
    expect(vibrate).toHaveBeenCalledWith(15);
  });
});
