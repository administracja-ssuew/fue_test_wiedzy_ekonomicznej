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
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, participantCode, sessionId]);

  return { violations, showWarning, lastType, dismiss: () => setShowWarning(false) };
}
