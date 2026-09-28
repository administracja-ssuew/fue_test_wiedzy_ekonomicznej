import { render, fireEvent, act, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/supabase.js", () => ({ validateParticipantCode: vi.fn() }));
vi.mock("../lib/wakeLock.js", () => ({ armWakeLockFromGesture: vi.fn() }));

import CodeEntry from "./CodeEntry.jsx";
import { validateParticipantCode } from "../lib/supabase.js";
import { armWakeLockFromGesture } from "../lib/wakeLock.js";

const FORMAT_ERR = "Kod ma postać KRK-1234: 3 litery miasta (np. KRK, WAR), myślnik i 4 cyfry.";
const RATE_ERR = "Za dużo prób — spróbuj za minutę";

function setup() {
  const onSuccess = vi.fn();
  const onBack = vi.fn();
  render(<CodeEntry onBack={onBack} onSuccess={onSuccess} />);
  const input = screen.getByLabelText("Kod uczestnika");
  const type = (value) => fireEvent.change(input, { target: { value } });
  const button = () => screen.getByRole("button", { name: /Dołącz do quizu|Odczekaj|Sprawdzanie/ });
  return { input, type, button, onSuccess, onBack };
}

// Opróżnia kolejkę mikrozadań po await validateParticipantCode (działa też z fake timers).
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.mocked(validateParticipantCode).mockReset();
  vi.mocked(armWakeLockFromGesture).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CodeEntry — P7-CODE-DASH (auto-myślnik)", () => {
  it("dopisuje myślnik po 3 literach, a kasowanie na „KRK-” daje „KRK”", () => {
    const { input, type } = setup();
    type("k");
    type("kr");
    type("krk");
    expect(input.value).toBe("KRK-");
    type("KRK");
    expect(input.value).toBe("KRK");
  });

  it("normalizuje wklejenie krk1111 / KRK 1111 / krk-1111 do KRK-1111", () => {
    const { input, type } = setup();
    type("krk1111");
    expect(input.value).toBe("KRK-1111");
    type("");
    type("KRK 1111");
    expect(input.value).toBe("KRK-1111");
    type("");
    type("krk-1111");
    expect(input.value).toBe("KRK-1111");
  });

  it("pole ma atrybuty z UI-SPEC §4", () => {
    const { input } = setup();
    expect(input.getAttribute("placeholder")).toBe("KRK-1234");
    expect(input.getAttribute("maxLength")).toBe("10");
    expect(input.getAttribute("autoCapitalize")).toBe("characters");
    expect(input.getAttribute("autoComplete")).toBe("off");
    expect(input.getAttribute("spellCheck")).toBe("false");
    expect(screen.getByText("Przykład: KRK-1111")).toBeTruthy();
  });
});

describe("CodeEntry — walidacja przed RPC", () => {
  it("zły format → komunikat formatu, bez RPC, blokada ekranu uzbrojona", async () => {
    const { type, button } = setup();
    type("KRK-111");
    fireEvent.click(button());
    await flush();
    expect(screen.getByRole("alert").textContent).toBe(FORMAT_ERR);
    expect(validateParticipantCode).not.toHaveBeenCalled();
    expect(armWakeLockFromGesture).toHaveBeenCalledWith({ force: true });
  });

  it("puste pole → „Wprowadź kod uczestnika.”, bez RPC", async () => {
    const { button } = setup();
    fireEvent.click(button());
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Wprowadź kod uczestnika.");
    expect(validateParticipantCode).not.toHaveBeenCalled();
    expect(armWakeLockFromGesture).toHaveBeenCalledTimes(1);
  });

  it("poprawny kod → RPC z KRK-1111 i onSuccess(data)", async () => {
    const data = { code: "KRK-1111", name: "Jan", surname: "Kowalski", city: "Kraków" };
    vi.mocked(validateParticipantCode).mockResolvedValue({ data, error: null });
    const { input, type, onSuccess } = setup();
    type("krk1111");
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(validateParticipantCode).toHaveBeenCalledWith("KRK-1111");
    expect(onSuccess).toHaveBeenCalledWith(data);
    expect(armWakeLockFromGesture).toHaveBeenCalledTimes(1);
  });

  it("błąd serwera → komunikat; edycja pola go czyści", async () => {
    vi.mocked(validateParticipantCode).mockResolvedValue({ error: "Nie znaleziono kodu. Sprawdź litery i cyfry na karcie od organizatora." });
    const { type, button } = setup();
    type("KRK-1111");
    fireEvent.click(button());
    await flush();
    expect(screen.getByRole("alert").textContent).toMatch(/Nie znaleziono kodu/);
    type("KRK-111");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("CodeEntry — P7-CODE-RATE (limit prób)", () => {
  it("rate_limited → komunikat, przycisk nieaktywny z odliczaniem, po 0 powrót", async () => {
    vi.useFakeTimers();
    vi.mocked(validateParticipantCode).mockResolvedValue({ error: RATE_ERR, rateLimited: true, retryAfterS: 3 });
    const { input, type, button } = setup();
    type("KRK-1111");
    fireEvent.click(button());
    await flush();

    expect(screen.getByRole("alert").textContent).toBe(RATE_ERR);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("Odczekaj 3 s");
    expect(button().style.opacity).toBe("0.5");
    expect(button().style.cursor).toBe("not-allowed");

    // Enter w trakcie blokady nie woła RPC
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(validateParticipantCode).toHaveBeenCalledTimes(1);

    // Edycja w trakcie blokady NIE czyści komunikatu limitu
    type("KRK-2222");
    expect(screen.getByRole("alert").textContent).toBe(RATE_ERR);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(button().textContent).toBe("Odczekaj 2 s");

    act(() => { vi.advanceTimersByTime(2000); });
    expect(button().textContent).toBe("Dołącz do quizu →");
    expect(button().disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("po wygaśnięciu blokady Enter znów wysyła", async () => {
    vi.useFakeTimers();
    vi.mocked(validateParticipantCode)
      .mockResolvedValueOnce({ error: RATE_ERR, rateLimited: true, retryAfterS: 1 })
      .mockResolvedValueOnce({ data: { code: "KRK-1111" }, error: null });
    const { input, type, onSuccess } = setup();
    type("KRK-1111");
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(screen.getByRole("alert").textContent).toBe(RATE_ERR);

    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(validateParticipantCode).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledWith({ code: "KRK-1111" });
  });
});
