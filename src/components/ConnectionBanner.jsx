import { useState, useEffect, useRef } from "react";
import useOnline from "../hooks/useOnline.js";

// Global connectivity banner. Shows a persistent red bar when the device loses
// its internet connection, and a brief green "reconnected" toast when it returns.
// Rendered once at the app root so it overlays every screen.
export default function ConnectionBanner() {
  const online = useOnline();
  const [justReconnected, setJustReconnected] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      setJustReconnected(true);
      const t = setTimeout(() => setJustReconnected(false), 2500);
      return () => clearTimeout(t);
    }
  }, [online]);

  if (online && !justReconnected) return null;

  const offline = !online;
  return (
    <div
      role="status"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: "8px 16px", fontFamily: '"Space Grotesk",sans-serif',
        fontSize: 13, fontWeight: 700, color: "#fff",
        background: offline ? "#B01A4E" : "#08815A",
        boxShadow: "0 2px 12px rgba(0,0,0,.4)",
        animation: "cbslide .25s ease-out",
      }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: "#fff",
        animation: offline ? "pulse 1s infinite" : "none", display: "inline-block",
      }} />
      {offline
        ? "Brak połączenia z internetem — próbuję połączyć ponownie…"
        : "Połączenie przywrócone"}
    </div>
  );
}
