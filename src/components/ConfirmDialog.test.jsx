import { render, fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog.jsx";

function setup(props = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ConfirmDialog open title="Na pewno ogłosić podium?" message="Wyniki zostaną pokazane."
      onConfirm={onConfirm} onCancel={onCancel} {...props} />
  );
  return { ...utils, onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("open=false → nic nie renderuje", () => {
    const { container } = render(
      <ConfirmDialog open={false} title="T" message="M" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("open=true → tytuł, treść, „Potwierdź” i „Anuluj”", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Na pewno ogłosić podium?")).toBeInTheDocument();
    expect(screen.getByText("Wyniki zostaną pokazane.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Potwierdź" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeInTheDocument();
  });

  it("klik „Potwierdź” woła onConfirm raz, nie onCancel", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Potwierdź" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("„Anuluj” → onCancel, bez onConfirm", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("klik w tło → onCancel; klik w kartę nic nie robi", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByText("Wyniki zostaną pokazane."));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Escape → onCancel, bez onConfirm", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fokus startowo na „Anuluj” (Enter nie potwierdza przypadkiem)", () => {
    setup();
    expect(screen.getByRole("button", { name: "Anuluj" })).toHaveFocus();
  });

  it("własne etykiety przycisków", () => {
    setup({ confirmLabel: "Zablokuj", cancelLabel: "Wróć", tone: "danger" });
    expect(screen.getByRole("button", { name: "Zablokuj" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wróć" })).toBeInTheDocument();
  });
});
