import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const DEMO = !SUPABASE_URL || !SUPABASE_KEY;
export const supabase = DEMO ? null : createClient(SUPABASE_URL, SUPABASE_KEY);

const CITY_PREFIX = { Kraków: "KRK", Warszawa: "WAR", Poznań: "POZ", Wrocław: "WRO", Katowice: "KAT" };

// ─── ADMIN AUTH ───────────────────────────────────────────────────────────────

export async function loginAdmin({ email, password }) {
  if (DEMO) {
    if (email === "admin@fue.pl" && password === "FUE2025") {
      const u = { id: "demo_admin", email, full_name: "Demo Admin", role: "superadmin", city: null };
      localStorage.setItem("fue_admin", JSON.stringify(u));
      return { data: u, error: null };
    }
    return { error: "Nieprawidłowy email lub hasło." };
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  const { data: profile, error: pErr } = await supabase
    .from("profiles").select("*").eq("id", data.user.id).single();
  if (pErr) return { error: "Brak profilu admina." };
  return { data: { ...data.user, ...profile }, error: null };
}

export async function logoutAdmin() {
  if (DEMO) { localStorage.removeItem("fue_admin"); return; }
  await supabase.auth.signOut();
}

export async function getCurrentAdmin() {
  if (DEMO) {
    const u = localStorage.getItem("fue_admin");
    return u ? JSON.parse(u) : null;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("*").eq("id", session.user.id).single();
  return profile ? { ...session.user, ...profile } : null;
}

// ─── PARTICIPANT CODES ────────────────────────────────────────────────────────

export async function validateParticipantCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    const entry = codes.find((c) => c.code === code);
    if (!entry) return { error: "Nie znaleziono kodu." };
    if (entry.used) return { error: "Ten kod został już wykorzystany." };
    return { data: entry, error: null };
  }
  const { data, error } = await supabase
    .from("participant_codes").select("*").eq("code", code).single();
  if (error || !data) return { error: "Nie znaleziono kodu." };
  if (data.used) return { error: "Ten kod został już wykorzystany." };
  return { data, error: null };
}

export async function markCodeUsed(code, sessionId) {
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    const idx = codes.findIndex((c) => c.code === code);
    if (idx >= 0) { codes[idx].used = true; codes[idx].session_id = sessionId; }
    localStorage.setItem("fue_codes", JSON.stringify(codes));
    return { error: null };
  }
  const { error } = await supabase.from("participant_codes")
    .update({ used: true, session_id: sessionId }).eq("code", code);
  return { error: error?.message || null };
}

export async function generateParticipantCode({ name, surname, city, createdBy }) {
  const prefix = CITY_PREFIX[city] || "XXX";
  const code = `${prefix}-${String(Math.floor(1000 + Math.random() * 9000))}`;
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    if (codes.find((c) => c.code === code))
      return generateParticipantCode({ name, surname, city, createdBy }); // retry
    const entry = { id: crypto.randomUUID(), code, name, surname, city, used: false, session_id: null, created_at: new Date().toISOString() };
    codes.push(entry);
    localStorage.setItem("fue_codes", JSON.stringify(codes));
    return { data: entry, error: null };
  }
  const { data, error } = await supabase.from("participant_codes")
    .insert({ code, name, surname, city, created_by: createdBy })
    .select().single();
  if (error?.code === "23505") return generateParticipantCode({ name, surname, city, createdBy }); // retry on duplicate
  return { data, error: error?.message || null };
}

export async function getParticipantCodes(city) {
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    return city ? codes.filter((c) => c.city === city) : codes;
  }
  let q = supabase.from("participant_codes").select("*").order("created_at", { ascending: false });
  if (city) q = q.eq("city", city);
  const { data } = await q;
  return data || [];
}

export async function deleteParticipantCode(id) {
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    localStorage.setItem("fue_codes", JSON.stringify(codes.filter((c) => c.id !== id)));
    return { error: null };
  }
  const { error } = await supabase.from("participant_codes").delete().eq("id", id);
  return { error: error?.message || null };
}

// ─── QUESTIONS ────────────────────────────────────────────────────────────────

export async function getQuestions(city) {
  if (DEMO) {
    const qs = JSON.parse(localStorage.getItem(`fue_questions_${city}`) || "[]");
    return qs;
  }
  const { data } = await supabase.from("questions").select("*")
    .eq("city", city).order("module").order("sort_order");
  return data || [];
}

export async function addQuestion({ city, module, q, opts, ans, exp, createdBy }) {
  if (DEMO) {
    const questions = JSON.parse(localStorage.getItem(`fue_questions_${city}`) || "[]");
    const entry = { id: crypto.randomUUID(), city, module, q, opts, ans, exp: exp || "", sort_order: questions.length, created_at: new Date().toISOString() };
    questions.push(entry);
    localStorage.setItem(`fue_questions_${city}`, JSON.stringify(questions));
    return { data: entry, error: null };
  }
  const existing = await getQuestions(city);
  const sort_order = existing.filter((x) => x.module === module).length;
  const { data, error } = await supabase.from("questions")
    .insert({ city, module, q, opts, ans, exp: exp || null, sort_order, created_by: createdBy })
    .select().single();
  return { data, error: error?.message || null };
}

export async function updateQuestion(id, updates) {
  if (DEMO) {
    const cities = ["Kraków", "Warszawa", "Poznań", "Wrocław", "Katowice"];
    for (const city of cities) {
      const qs = JSON.parse(localStorage.getItem(`fue_questions_${city}`) || "[]");
      const idx = qs.findIndex((q) => q.id === id);
      if (idx >= 0) { qs[idx] = { ...qs[idx], ...updates }; localStorage.setItem(`fue_questions_${city}`, JSON.stringify(qs)); break; }
    }
    return { error: null };
  }
  const { error } = await supabase.from("questions").update(updates).eq("id", id);
  return { error: error?.message || null };
}

export async function deleteQuestion(id) {
  if (DEMO) {
    const cities = ["Kraków", "Warszawa", "Poznań", "Wrocław", "Katowice"];
    for (const city of cities) {
      const qs = JSON.parse(localStorage.getItem(`fue_questions_${city}`) || "[]");
      const filtered = qs.filter((q) => q.id !== id);
      if (filtered.length !== qs.length) { localStorage.setItem(`fue_questions_${city}`, JSON.stringify(filtered)); break; }
    }
    return { error: null };
  }
  const { error } = await supabase.from("questions").delete().eq("id", id);
  return { error: error?.message || null };
}

// ─── SESSIONS ─────────────────────────────────────────────────────────────────

export async function getOrCreateSession(city, adminId, isPractice = false) {
  if (DEMO) {
    const key = `fue_session_${city}${isPractice ? "_practice" : ""}`;
    const existing = localStorage.getItem(key);
    if (existing) {
      const s = JSON.parse(existing);
      if (s.status !== "ended") return { data: s, error: null };
    }
    const session = { id: `sess_${city}_${Date.now()}`, city, status: "waiting", is_practice: isPractice, current_question_idx: 0, q_started_at: null, created_at: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(session));
    return { data: session, error: null };
  }
  const { data: existing } = await supabase.from("quiz_sessions")
    .select("*").eq("city", city).eq("is_practice", isPractice).neq("status", "ended")
    .order("created_at", { ascending: false }).limit(1);
  if (existing?.[0]) return { data: existing[0], error: null };
  const { data, error } = await supabase.from("quiz_sessions")
    .insert({ city, status: "waiting", is_practice: isPractice, created_by: adminId }).select().single();
  return { data, error: error?.message || null };
}

export async function endAndResetSession(city, adminId, isPractice = false) {
  if (DEMO) {
    const key = `fue_session_${city}${isPractice ? "_practice" : ""}`;
    localStorage.removeItem(key);
    return getOrCreateSession(city, adminId, isPractice);
  }
  await supabase.from("quiz_sessions").update({ status: "ended" })
    .eq("city", city).eq("is_practice", isPractice).neq("status", "ended");
  return getOrCreateSession(city, adminId, isPractice);
}

export async function updateSession(sessionId, updates) {
  if (DEMO) {
    const cities = ["Kraków", "Warszawa", "Poznań", "Wrocław", "Katowice"];
    for (const city of cities) {
      const key = `fue_session_${city}`;
      const s = JSON.parse(localStorage.getItem(key) || "null");
      if (s?.id === sessionId) { localStorage.setItem(key, JSON.stringify({ ...s, ...updates })); break; }
    }
    return { error: null };
  }
  const { error } = await supabase.from("quiz_sessions").update(updates).eq("id", sessionId);
  return { error: error?.message || null };
}

export async function getSessionForCity(city) {
  if (DEMO) {
    const s = localStorage.getItem(`fue_session_${city}`);
    if (!s) return null;
    const parsed = JSON.parse(s);
    // Participants only join real (non-practice) sessions
    return parsed.is_practice ? null : parsed;
  }
  const { data } = await supabase.from("quiz_sessions")
    .select("*").eq("city", city).eq("is_practice", false).neq("status", "ended")
    .order("created_at", { ascending: false }).limit(1);
  return data?.[0] || null;
}

export async function getParticipantsInSession(city) {
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    return codes.filter((c) => c.city === city && c.used);
  }
  const { data } = await supabase.from("participant_codes")
    .select("*").eq("city", city).eq("used", true);
  return data || [];
}

// ─── ANSWERS ──────────────────────────────────────────────────────────────────

export async function saveAnswer({ sessionId, participantCode, participantName, city, questionId, module, chosen, isCorrect, points }) {
  if (DEMO) {
    const answers = JSON.parse(localStorage.getItem("fue_answers") || "[]");
    answers.push({ sessionId, participantCode, participantName, city, questionId, module, chosen, isCorrect, points, answeredAt: new Date().toISOString() });
    localStorage.setItem("fue_answers", JSON.stringify(answers));
    return { error: null };
  }
  const { error } = await supabase.from("answers").upsert({
    session_id: sessionId, participant_code: participantCode, participant_name: participantName,
    city, question_id: questionId, module, chosen, is_correct: isCorrect, points,
  }, { onConflict: "session_id,participant_code,question_id" });
  return { error: error?.message || null };
}

export async function getSessionResults(sessionId) {
  if (DEMO) {
    const answers = JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .filter((a) => a.sessionId === sessionId);
    const grouped = {};
    for (const a of answers) {
      if (!grouped[a.participantCode]) grouped[a.participantCode] = { code: a.participantCode, name: `${a.participantName}`, points: 0, answers: 0 };
      grouped[a.participantCode].points += a.points;
      grouped[a.participantCode].answers += 1;
    }
    return Object.values(grouped).sort((a, b) => b.points - a.points);
  }
  const { data } = await supabase.from("answers")
    .select("participant_code, participant_name, points")
    .eq("session_id", sessionId);
  if (!data) return [];
  const grouped = {};
  for (const row of data) {
    if (!grouped[row.participant_code])
      grouped[row.participant_code] = { code: row.participant_code, name: row.participant_name, points: 0 };
    grouped[row.participant_code].points += row.points;
  }
  return Object.values(grouped).sort((a, b) => b.points - a.points);
}

// Live stats for current question (admin panel)
export async function getLiveQuestionStats(sessionId, questionId) {
  if (DEMO) {
    const answers = JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .filter((a) => a.sessionId === sessionId && a.questionId === questionId);
    const correct = answers.filter((a) => a.isCorrect).length;
    const avgTime = answers.length
      ? answers.reduce((s, a) => s + (a.responseTime || 0), 0) / answers.length
      : 0;
    return { total: answers.length, correct, avgTime: Math.round(avgTime), answers };
  }
  const { data } = await supabase.from("answers")
    .select("participant_code, participant_name, is_correct, points, answered_at")
    .eq("session_id", sessionId)
    .eq("question_id", questionId);
  if (!data) return { total: 0, correct: 0, avgTime: 0, answers: [] };
  const correct = data.filter((a) => a.is_correct).length;
  return {
    total: data.length,
    correct,
    avgTime: 0, // would need response_time column for accurate avg
    answers: data.map((a) => ({ code: a.participant_code, name: a.participant_name, isCorrect: a.is_correct, points: a.points })),
  };
}

// ─── PER-CITY BACKGROUND ──────────────────────────────────────────────────────

const DEFAULT_BG = "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)";

export async function getCityBg(city) {
  if (DEMO) return localStorage.getItem(`fue_bg_${city}`) || null;
  const { data } = await supabase.from("quiz_sessions")
    .select("bg").eq("city", city).neq("status", "ended")
    .order("created_at", { ascending: false }).limit(1).single();
  return data?.bg || null;
}

export async function setCityBg(city, bg) {
  if (DEMO) {
    localStorage.setItem(`fue_bg_${city}`, bg);
    for (const key of [`fue_session_${city}`, `fue_session_${city}_practice`]) {
      const s = localStorage.getItem(key);
      if (s) localStorage.setItem(key, JSON.stringify({ ...JSON.parse(s), bg }));
    }
    return { error: null };
  }
  const { error } = await supabase.from("quiz_sessions")
    .update({ bg }).eq("city", city).neq("status", "ended");
  return { error: error?.message || null };
}

// Upload image to Supabase Storage bucket "backgrounds"
export async function uploadCityBg(city, file) {
  if (DEMO) {
    // In demo mode: read as data URL (base64) and store locally
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ url: e.target.result, error: null });
      reader.onerror = () => resolve({ url: null, error: "Błąd odczytu pliku." });
      reader.readAsDataURL(file);
    });
  }
  const ext = file.name.split(".").pop().toLowerCase();
  const path = `${city}/bg.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("backgrounds")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { url: null, error: uploadError.message };
  const { data: { publicUrl } } = supabase.storage.from("backgrounds").getPublicUrl(path);
  return { url: publicUrl, error: null };
}

export { DEFAULT_BG };

// ─── ANTI-CHEAT VIOLATIONS ────────────────────────────────────────────────────

export async function recordViolation({ participantCode, sessionId, type, count }) {
  if (DEMO) {
    const v = JSON.parse(localStorage.getItem("fue_violations") || "[]");
    v.push({ participantCode, sessionId, type, count, at: new Date().toISOString() });
    localStorage.setItem("fue_violations", JSON.stringify(v));
    return;
  }
  try {
    await supabase.from("violations").insert({
      participant_code: participantCode,
      session_id: sessionId || null,
      type,
      count,
    });
  } catch (_) { /* graceful fail if table doesn't exist yet */ }
}

export async function getViolationsForSession(sessionId) {
  if (DEMO) {
    return JSON.parse(localStorage.getItem("fue_violations") || "[]")
      .filter((v) => v.sessionId === sessionId);
  }
  const { data } = await supabase.from("violations")
    .select("*").eq("session_id", sessionId).order("at", { ascending: false });
  return data || [];
}
