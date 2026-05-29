import { useEffect, useRef, useState } from "react";
import { recordViolation } from "../lib/supabase.js";

export default function useAntiCheat({ active, participantCode, sessionId }) {
  const [violations, setViolations]     = useState(0);
  const [showWarning, setShowWarning]   = useState(false);
  const [lastType, setLastType]         = useState("");
  const countRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const trigger = (type) => {
      countRef.current += 1;
      setViolations(countRef.current);
      setLastType(type);
      setShowWarning(true);
      recordViolation({ participantCode, sessionId, type, count: countRef.current });
    };

    // Tab switch / minimise
    const onVisibility = () => {
      if (document.hidden) trigger("tab_switch");
    };

    // PrintScreen key
    const onKey = (e) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        trigger("screenshot_attempt");
      }
      // Cmd+Shift+3/4/5 on macOS (screenshots)
      if (e.metaKey && e.shiftKey && ["3","4","5"].includes(e.key)) {
        e.preventDefault();
        trigger("screenshot_attempt");
      }
      // Deterrent only (no violation logged): block print / save / copy shortcuts.
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ["p", "s", "c", "u"].includes(k)) {
        e.preventDefault();
      }
    };

    // Deterrents — silently block right-click menu, copy and text selection.
    // These are friction, not violations (would be far too noisy to record).
    const block = (e) => e.preventDefault();

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", block);
    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
    };
  }, [active, participantCode, sessionId]);

  return { violations, showWarning, lastType, dismiss: () => setShowWarning(false) };
}
