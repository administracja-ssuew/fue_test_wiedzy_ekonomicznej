import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const DEMO = !SUPABASE_URL || !SUPABASE_KEY;

export const supabase = DEMO ? null : createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const generateCode = () =>
  String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");

// ─── AUTH ─────────────────────────────────────────────────────────────────────

export async function registerUser({ email, password, fullName, city, university }) {
  if (DEMO) {
    const users = JSON.parse(localStorage.getItem("fue_users") || "[]");
    if (users.find((u) => u.email === email))
      return { error: "Ten email jest już zajęty." };
    const profile = {
      id: "demo_" + Math.random().toString(36).slice(2),
      email, fullName, city, university,
      role: "participant", verified: false, createdAt: new Date().toISOString(),
    };
    users.push(profile);
    localStorage.setItem("fue_users", JSON.stringify(users));
    return { data: profile, error: null };
  }
  const { data: authData, error: authErr } = await supabase.auth.signUp({ email, password });
  if (authErr) return { error: authErr.message };
  const { error: profErr } = await supabase.from("profiles").insert({
    id: authData.user.id,
    full_name: fullName,
    city,
    university,
    role: "participant",
    verified: false,
  });
  if (profErr) return { error: profErr.message };
  return { data: authData.user, error: null };
}

export async function loginUser({ email, password }) {
  if (DEMO) {
    const users = JSON.parse(localStorage.getItem("fue_users") || "[]");
    const u = users.find((x) => x.email === email);
    if (!u) return { error: "Nie znaleziono konta." };
    localStorage.setItem("fue_current_user", JSON.stringify(u));
    return { data: u, error: null };
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();
  if (profErr) return { error: profErr.message };
  return { data: { ...data.user, ...profile }, error: null };
}

export async function logoutUser() {
  if (DEMO) {
    localStorage.removeItem("fue_current_user");
    return;
  }
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  if (DEMO) {
    return JSON.parse(localStorage.getItem("fue_current_user") || "null");
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();
  return profile ? { ...session.user, ...profile } : null;
}

// ─── ADMIN — USER MANAGEMENT ─────────────────────────────────────────────────

export async function getAllUsers(city = null) {
  if (DEMO) {
    const users = JSON.parse(localStorage.getItem("fue_users") || "[]");
    return city ? users.filter((u) => u.city === city) : users;
  }
  let q = supabase.from("profiles").select("*").order("created_at", { ascending: false });
  if (city) q = q.eq("city", city);
  const { data } = await q;
  return data || [];
}

export async function getPendingUsers(city = null) {
  if (DEMO) {
    const users = JSON.parse(localStorage.getItem("fue_users") || "[]");
    return users.filter((u) => !u.verified && (!city || u.city === city));
  }
  let q = supabase.from("profiles").select("*").eq("verified", false);
  if (city) q = q.eq("city", city);
  const { data } = await q;
  return data || [];
}

export async function verifyUser(userId, approve = true) {
  if (DEMO) {
    const users = JSON.parse(localStorage.getItem("fue_users") || "[]");
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) return { error: "Nie znaleziono użytkownika." };
    if (approve) {
      users[idx].verified = true;
    } else {
      users.splice(idx, 1);
    }
    localStorage.setItem("fue_users", JSON.stringify(users));
    return { error: null };
  }
  if (approve) {
    const { error } = await supabase
      .from("profiles")
      .update({ verified: true })
      .eq("id", userId);
    return { error: error?.message || null };
  }
  const { error } = await supabase.from("profiles").delete().eq("id", userId);
  return { error: error?.message || null };
}

// ─── QUIZ SESSIONS ────────────────────────────────────────────────────────────

export async function createSession({ stage, city, createdBy }) {
  if (DEMO) {
    const session = {
      id: "sess_" + Math.random().toString(36).slice(2),
      join_code: generateCode(),
      stage, city: city || null, status: "waiting",
      current_question_index: 0, q_started_at: null,
      created_by: createdBy, created_at: new Date().toISOString(),
    };
    const sessions = JSON.parse(localStorage.getItem("fue_sessions") || "[]");
    sessions.push(session);
    localStorage.setItem("fue_sessions", JSON.stringify(sessions));
    localStorage.setItem("fue_active_session", JSON.stringify(session));
    return { data: session, error: null };
  }
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const { data, error } = await supabase
      .from("quiz_sessions")
      .insert({ join_code: code, stage, city: city || null, created_by: createdBy, status: "waiting" })
      .select()
      .single();
    if (!error) return { data, error: null };
    if (error.code !== "23505") return { data: null, error: error.message };
  }
  return { data: null, error: "Could not generate unique session code after 5 attempts" };
}

export async function getSessionByCode(joinCode) {
  if (DEMO) {
    const sessions = JSON.parse(localStorage.getItem("fue_sessions") || "[]");
    return sessions.find((s) => s.join_code === joinCode) || null;
  }
  const { data } = await supabase
    .from("quiz_sessions")
    .select("*")
    .eq("join_code", joinCode)
    .neq("status", "finished")
    .single();
  return data || null;
}

export async function getActiveSession(city = null) {
  if (DEMO) {
    const s = localStorage.getItem("fue_active_session");
    return s ? JSON.parse(s) : null;
  }
  let q = supabase.from("quiz_sessions").select("*").in("status", ["waiting", "active"]);
  if (city) q = q.eq("city", city);
  const { data } = await q.order("created_at", { ascending: false }).limit(1);
  return data?.[0] || null;
}

export async function updateSession(sessionId, updates) {
  if (DEMO) {
    const session = JSON.parse(localStorage.getItem("fue_active_session") || "null");
    if (session?.id === sessionId) {
      const updated = { ...session, ...updates };
      localStorage.setItem("fue_active_session", JSON.stringify(updated));
    }
    return { error: null };
  }
  const { error } = await supabase.from("quiz_sessions").update(updates).eq("id", sessionId);
  return { error: error?.message || null };
}

export async function joinSession(sessionId, userId) {
  if (DEMO) {
    return { error: null };
  }
  const { error } = await supabase
    .from("participants")
    .upsert({ session_id: sessionId, user_id: userId }, { onConflict: "session_id,user_id" });
  return { error: error?.message || null };
}

// ─── ATTEMPTS ─────────────────────────────────────────────────────────────────

export async function saveAttempt({ sessionId, userId, answers, totalScore, completed }) {
  if (DEMO) {
    const attempts = JSON.parse(localStorage.getItem("fue_attempts") || "[]");
    const idx = attempts.findIndex((a) => a.sessionId === sessionId && a.userId === userId);
    const attempt = { sessionId, userId, answers, totalScore, completed };
    if (idx >= 0) attempts[idx] = attempt; else attempts.push(attempt);
    localStorage.setItem("fue_attempts", JSON.stringify(attempts));
    return { error: null };
  }
  return { error: null }; // Phase 3 replaces with per-answer inserts
}

export async function getSessionAttempts(sessionId) {
  if (DEMO) {
    const attempts = JSON.parse(localStorage.getItem("fue_attempts") || "[]");
    const users = JSON.parse(localStorage.getItem("fue_users") || "[]");
    return attempts
      .filter((a) => a.sessionId === sessionId)
      .map((a) => ({ ...a, profile: users.find((u) => u.id === a.userId) }));
  }
  const { data } = await supabase
    .from("answers")
    .select("user_id, points, profiles(full_name, city)")
    .eq("session_id", sessionId);
  return data || [];
}
