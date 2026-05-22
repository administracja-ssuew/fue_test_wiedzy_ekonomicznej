// Phase 1: simple client-side countdown
// Phase 3: will use q_started_at from server (see STATE.md P1 pitfall)
import { useState, useEffect, useRef } from "react";

export default function useTimer(initialTime, onTimeout) {
  const [timer, setTimer] = useState(initialTime);
  const ref = useRef(null);

  useEffect(() => {
    setTimer(initialTime);
  }, [initialTime]);

  useEffect(() => {
    if (timer <= 0) return;
    clearInterval(ref.current);
    ref.current = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) {
          clearInterval(ref.current);
          onTimeout?.();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(ref.current);
  }, [initialTime]);

  return [timer, setTimer];
}
