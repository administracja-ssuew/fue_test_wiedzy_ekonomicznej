import { useEffect, useSyncExternalStore } from "react";
import { getWakeLock } from "../lib/wakeLock.js";

// ─── useWakeLock (Faza 7 — P7-IOS-WAKE) ───────────────────────────────────────
// Ekran telefonu nie gaśnie od lobby do końca testu. Sam hook tylko mówi
// kontrolerowi „chcemy / nie chcemy” blokady — prośba o nią żyje w
// src/lib/wakeLock.js, bo iOS WebKit (Safari i Chrome na iOS) przyznaje Wake Lock
// wyłącznie w trakcie gestu użytkownika, a useEffect gestem nie jest.
// Kontroler uzbraja blokadę kliknięciem „Dołącz do quizu →” (CodeEntry) i każdym
// dotknięciem ekranu, dopóki blokada nie jest trzymana; ma też fallback wideo.

const IDLE = { wanted: false, held: false, failed: false, mode: null };
const noopSubscribe = () => () => {};

export default function useWakeLock(active) {
  useEffect(() => {
    getWakeLock()?.setWanted(!!active);
  }, [active]);
}

// Stan blokady dla UI (np. pasek „Dotknij ekranu” w Lobby).
export function useWakeLockState() {
  const wl = getWakeLock();
  return useSyncExternalStore(
    wl ? wl.subscribe : noopSubscribe,
    wl ? wl.getState : () => IDLE,
    () => IDLE,
  );
}
