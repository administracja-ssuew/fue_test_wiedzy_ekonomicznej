// Sprząta dane zasiane przez global-setup (staging).
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

export default async function globalTeardown() {
  let st;
  try { st = JSON.parse(fs.readFileSync("e2e/.e2e-state.json", "utf8")); } catch { return; }
  const supa = createClient(st.url, st.service, { auth: { persistSession: false } });
  try { await supa.from("answers").delete().eq("session_id", st.sessionId); } catch {}
  try { await supa.from("participant_codes").delete().eq("code", st.code); } catch {}
  try { await supa.from("questions").delete().in("id", st.qIds); } catch {}
  try { await supa.from("quiz_sessions").delete().eq("id", st.sessionId); } catch {}
  try { fs.unlinkSync("e2e/.e2e-state.json"); } catch {}
  try { fs.unlinkSync(".env.e2e"); } catch {}
  console.log("\n[E2E teardown] posprzątano dane testowe.\n");
}
