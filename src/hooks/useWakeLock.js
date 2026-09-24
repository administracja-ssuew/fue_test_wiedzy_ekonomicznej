import { useEffect } from "react";

// ─── useWakeLock (Faza 6 — płynność) ──────────────────────────────────────────
// Screen Wake Lock: ekran telefonu nie gaśnie w lobby i w trakcie quizu.
// Przeglądarka zwalnia blokadę przy ukryciu karty — ponawiamy ją przy powrocie
// (visibilitychange → visible). Brak wsparcia albo odmowa = cicho pomijamy
// (np. iOS PWA uruchomiona z ekranu głównego obsługuje Wake Lock dopiero od 18.4).
export default function useWakeLock(active) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return undefined;
    let lock = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || document.hidden) return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (disposed) { l?.release?.().catch(() => {}); return; }
        lock = l;
      } catch (_) { /* odmowa / brak wsparcia — ignorujemy */ }
    };

    // Blokada zwalnia się przy ukryciu karty — po powrocie bierzemy ją ponownie.
    const onVis = () => { if (!document.hidden) acquire(); };

    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release?.().catch(() => {});
      lock = null;
    };
  }, [active]);
}
