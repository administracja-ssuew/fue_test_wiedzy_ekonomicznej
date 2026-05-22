// Stub for Phase 3: will wrap Supabase Broadcast channel
import { useState } from "react";

export default function useSession(code) {
  const [session, setSession] = useState(null);
  // Phase 3: subscribe to Broadcast channel for quiz state
  return { session, setSession };
}
