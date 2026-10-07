import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

// ─── Okno potwierdzenia w stylu aplikacji (zamiast window.confirm) ───────────
// Podwójne zabezpieczenie dla nieodwracalnych akcji (podium, blokada edycji).
// zIndex 3000 - wyżej niż pełnoekranowy Live w panelu (zIndex 2000).
// Fokus startowo na „Anuluj”, więc Enter/spacja nie potwierdzają przypadkiem.
// Escape i klik w tło = Anuluj.

const TONES = {
  gold:   { background: "linear-gradient(135deg,#B8860B,#F5C518)", color: "#070215", boxShadow: "0 6px 20px rgba(245,197,24,.35)" },
  danger: { background: "linear-gradient(135deg,#E8376B,#B01A4E)", color: "#fff",    boxShadow: "0 6px 20px rgba(232,55,107,.35)" },
};

const BTN = {
  border: "none", borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 700,
  cursor: "pointer", fontFamily: '"Space Grotesk",sans-serif', flex: 1,
};

export default function ConfirmDialog({
  open, title, message, confirmLabel = "Potwierdź", cancelLabel = "Anuluj",
  tone = "gold", onConfirm, onCancel,
}) {
  const titleId = useId();
  const cancelRef = useRef(null);
  // Rodzic (np. SesjaTab) re-renderuje się co sekundę z nową funkcją onCancel - trzymamy
  // ją w refie, żeby efekt nie przestawiał fokusu przy każdym renderze.
  const cancelCb = useRef(onCancel);
  cancelCb.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") cancelCb.current?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  // Portal do <body>: przodek z transform (np. animacja „su” w panelu) zrobiłby z
  // position: fixed pozycjonowanie względem siebie, a nie okna.
  return createPortal(
    <div data-testid="confirm-backdrop" onClick={() => onCancel?.()}
      style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(7,2,21,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fi .15s ease both" }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 420, background: "#0E0435", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16, padding: "24px 22px 20px", boxShadow: "0 24px 60px rgba(0,0,0,.55)", color: "#EDE9FE", fontFamily: '"Space Grotesk",sans-serif', animation: "su .2s ease both" }}>
        <h3 id={titleId} style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3, margin: 0 }}>{title}</h3>
        {message && <p style={{ fontSize: 14, color: "#C4B5FD", lineHeight: 1.55, marginTop: 10 }}>{message}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button ref={cancelRef} type="button" onClick={() => onCancel?.()}
            style={{ ...BTN, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", color: "#C4B5FD" }}>
            {cancelLabel}
          </button>
          <button type="button" onClick={() => onConfirm?.()}
            style={{ ...BTN, ...(TONES[tone] || TONES.gold) }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
