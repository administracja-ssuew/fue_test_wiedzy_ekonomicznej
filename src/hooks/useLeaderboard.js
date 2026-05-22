// Stub for Phase 4: will listen to Postgres Changes on answers table
import { useState } from "react";

export default function useLeaderboard(sessionId) {
  const [leaderboard, setLeaderboard] = useState([]);
  // Phase 4: subscribe to supabase Postgres Changes here
  return { leaderboard };
}
