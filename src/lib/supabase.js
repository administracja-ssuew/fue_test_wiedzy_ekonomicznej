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
    .from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (pErr) return { error: "Błąd bazy danych: " + pErr.message };
  if (!profile) return { error: "Brak profilu admina. Skontaktuj się z administratorem systemu." };
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
    .from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  return profile ? { ...session.user, ...profile } : null;
}

// ─── PARTICIPANT CODES ────────────────────────────────────────────────────────

export async function validateParticipantCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    const entry = codes.find((c) => c.code === code);
    if (!entry) return { error: "Nie znaleziono kodu." };
    return { data: entry, error: null };
  }
  const { data, error } = await supabase
    .from("participant_codes").select("*").eq("code", code).single();
  if (error || !data) return { error: "Nie znaleziono kodu." };
  // Kod istnieje — można dołączyć (nawet po przypadkowym zamknięciu przeglądarki)
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
    return JSON.parse(localStorage.getItem(`fue_questions_${city}`) || "[]");
  }
  const { data } = await supabase.from("questions").select("*")
    .eq("city", city).neq("is_practice", true).order("module").order("sort_order");
  return data || [];
}

export async function getPracticeQuestions(city) {
  if (DEMO) {
    return JSON.parse(localStorage.getItem(`fue_practice_${city}`) || "[]");
  }
  const { data } = await supabase.from("questions").select("*")
    .eq("city", city).eq("is_practice", true).order("module").order("sort_order");
  return data || [];
}

export async function addQuestion({ city, module, q, opts, ans, exp, createdBy, isPractice = false }) {
  if (DEMO) {
    const key = isPractice ? `fue_practice_${city}` : `fue_questions_${city}`;
    const questions = JSON.parse(localStorage.getItem(key) || "[]");
    const entry = { id: crypto.randomUUID(), city, module, q, opts, ans, exp: exp || "", is_practice: isPractice, sort_order: questions.length, created_at: new Date().toISOString() };
    questions.push(entry);
    localStorage.setItem(key, JSON.stringify(questions));
    return { data: entry, error: null };
  }
  const existing = isPractice ? await getPracticeQuestions(city) : await getQuestions(city);
  const sort_order = existing.filter((x) => x.module === module).length;
  const { data, error } = await supabase.from("questions")
    .insert({ city, module, q, opts, ans, exp: exp || null, sort_order, is_practice: isPractice, created_by: createdBy })
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
    outer: for (const city of cities) {
      for (const suffix of ["", "_practice"]) {
        const key = `fue_session_${city}${suffix}`;
        const s = JSON.parse(localStorage.getItem(key) || "null");
        if (s?.id === sessionId) { localStorage.setItem(key, JSON.stringify({ ...s, ...updates })); break outer; }
      }
    }
    return { error: null };
  }
  const { error } = await supabase.from("quiz_sessions").update(updates).eq("id", sessionId);
  return { error: error?.message || null };
}

// Advance quiz to the next question using a server-generated timestamp.
// Uses optimistic locking so only the first of N concurrent callers wins.
// Returns { startedAt: string|null } — null means another client already advanced;
// the caller should wait for the Realtime event instead of setting a local timestamp.
export async function advanceSessionQuestion(sessionId, expectedIdx, nextIdx) {
  if (DEMO) {
    // In demo mode simulate the RPC: only advance if current index still matches
    const cities = ["Kraków", "Warszawa", "Poznań", "Wrocław", "Katowice"];
    for (const city of cities) {
      for (const suffix of ["", "_practice"]) {
        const key = `fue_session_${city}${suffix}`;
        const s = JSON.parse(localStorage.getItem(key) || "null");
        if (s?.id === sessionId) {
          if (s.current_question_idx !== expectedIdx || s.status !== "running") {
            return { startedAt: null, error: null }; // lost the race
          }
          const startedAt = new Date().toISOString();
          localStorage.setItem(key, JSON.stringify({ ...s, current_question_idx: nextIdx, q_started_at: startedAt }));
          return { startedAt, error: null };
        }
      }
    }
    return { startedAt: null, error: null };
  }
  const { data, error } = await supabase.rpc("advance_session_question", {
    p_session_id:   sessionId,
    p_expected_idx: expectedIdx,
    p_next_idx:     nextIdx,
  });
  if (error) return { startedAt: null, error: error.message };
  // data is the returned TIMESTAMPTZ string, or null if this client lost the race
  return { startedAt: data || null, error: null };
}

// Starts a waiting session using a server-side timestamp (avoids admin clock skew).
// Returns { startedAt: string|null, error: string|null }.
export async function startQuizSession(sessionId) {
  if (DEMO) {
    const cities = ["Kraków", "Warszawa", "Poznań", "Wrocław", "Katowice"];
    for (const city of cities) {
      for (const suffix of ["", "_practice"]) {
        const key = `fue_session_${city}${suffix}`;
        const s = JSON.parse(localStorage.getItem(key) || "null");
        if (s?.id === sessionId) {
          const startedAt = new Date().toISOString();
          localStorage.setItem(key, JSON.stringify({ ...s, status: "running", q_started_at: startedAt, current_question_idx: 0 }));
          return { startedAt, error: null };
        }
      }
    }
    return { startedAt: null, error: "Sesja nie znaleziona." };
  }
  const { data, error } = await supabase.rpc("start_quiz_session", { p_session_id: sessionId });
  if (error) return { startedAt: null, error: error.message };
  return { startedAt: data || null, error: null };
}

export async function getSessionForCity(city) {
  if (DEMO) {
    const s = localStorage.getItem(`fue_session_${city}`);
    if (!s) return null;
    return JSON.parse(s);
  }
  // Return the most recent non-ended session (practice or regular — admin controls which is active)
  const { data } = await supabase.from("quiz_sessions")
    .select("*").eq("city", city).neq("status", "ended")
    .order("created_at", { ascending: false }).limit(1);
  return data?.[0] || null;
}

export async function getParticipantsInSession(city) {
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    return codes.filter((c) => c.city === city && c.used);
  }
  const { data } = await supabase.from("participant_codes").select("*").eq("city", city).eq("used", true);
  return data || [];
}

// ─── ANSWERS ──────────────────────────────────────────────────────────────────

export async function saveAnswer({ sessionId, participantCode, participantName, city, questionId, module, chosen, isCorrect, points, responseTimeS }) {
  if (DEMO) {
    const answers = JSON.parse(localStorage.getItem("fue_answers") || "[]");
    answers.push({ sessionId, participantCode, participantName, city, questionId, module, chosen, isCorrect, points, responseTimeS: responseTimeS ?? null, answeredAt: new Date().toISOString() });
    localStorage.setItem("fue_answers", JSON.stringify(answers));
    return { error: null };
  }
  const { error } = await supabase.from("answers").upsert({
    session_id: sessionId, participant_code: participantCode, participant_name: participantName,
    city, question_id: questionId, module, chosen, is_correct: isCorrect, points,
    response_time_s: responseTimeS ?? null,
  }, { onConflict: "session_id,participant_code,question_id" });
  return { error: error?.message || null };
}

export async function getSessionResults(sessionId) {
  if (DEMO) {
    const answers = JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .filter((a) => a.sessionId === sessionId);
    const grouped = {};
    for (const a of answers) {
      if (!grouped[a.participantCode]) grouped[a.participantCode] = { code: a.participantCode, name: a.participantName, city: a.city || "", points: 0, answers: 0, totalTime: 0, timedAnswers: 0 };
      grouped[a.participantCode].points += a.points;
      grouped[a.participantCode].answers += 1;
      if (a.responseTimeS != null) { grouped[a.participantCode].totalTime += a.responseTimeS; grouped[a.participantCode].timedAnswers += 1; }
    }
    return Object.values(grouped).sort((a, b) => b.points - a.points).map((g) => ({
      code: g.code, name: g.name, city: g.city, points: g.points,
      avgResponseTime: g.timedAnswers ? Math.round(g.totalTime / g.timedAnswers) : null,
    }));
  }
  // Use RPC to aggregate on DB side — avoids PostgREST 1000-row default limit
  // which would truncate results for 500 participants × 32 questions = 16 000 rows
  const { data } = await supabase.rpc("get_session_results", { p_session_id: sessionId });
  if (!data) return [];
  return data.map((r) => ({ code: r.participant_code, name: r.participant_name, city: r.city, points: Number(r.total_points), avgResponseTime: r.avg_response_time_s ?? null }));
}

// Live stats for current question (admin panel)
export async function getLiveQuestionStats(sessionId, questionId) {
  if (DEMO) {
    const raw = JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .filter((a) => a.sessionId === sessionId && a.questionId === questionId);
    const correct = raw.filter((a) => a.isCorrect).length;
    return {
      total: raw.length, correct, avgTime: 0,
      answers: raw.map((a) => ({ code: a.participantCode, name: a.participantName, isCorrect: a.isCorrect, points: a.points })),
    };
  }
  const { data } = await supabase.from("answers")
    .select("participant_code, participant_name, is_correct, points, answered_at, response_time_s")
    .eq("session_id", sessionId)
    .eq("question_id", questionId);
  if (!data) return { total: 0, correct: 0, avgTime: 0, answers: [] };
  const correct = data.filter((a) => a.is_correct).length;
  const timed   = data.filter((a) => a.response_time_s != null);
  const avgTime = timed.length ? Math.round(timed.reduce((s, a) => s + a.response_time_s, 0) / timed.length) : 0;
  return {
    total: data.length,
    correct,
    avgTime,
    answers: data.map((a) => ({ code: a.participant_code, name: a.participant_name, isCorrect: a.is_correct, points: a.points, responseTime: a.response_time_s ?? null })),
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
  // Supabase Storage keys must be ASCII — strip Polish diacritics from city name
  const safeCity = city.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const path = `${safeCity}/bg.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("backgrounds")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { url: null, error: uploadError.message };
  const { data: { publicUrl } } = supabase.storage.from("backgrounds").getPublicUrl(path);
  return { url: publicUrl, error: null };
}

export { DEFAULT_BG };

// ─── MODULES (dynamic from DB) ────────────────────────────────────────────────

import { MODULES as FALLBACK_MODULES } from "../data/questions.js";

export async function getModules() {
  if (DEMO) {
    const cached = localStorage.getItem("fue_modules");
    return cached ? JSON.parse(cached) : FALLBACK_MODULES;
  }
  const { data } = await supabase.from("modules").select("*").order("sort_order");
  if (!data || !data.length) return FALLBACK_MODULES;
  return data.map((m) => ({ id: m.id, name: m.name, icon: m.icon, color: m.color, timePerQ: m.time_per_q, desc: m.description || "" }));
}

export async function addModule({ id, name, icon, color, timePerQ, desc }) {
  const rec = { id, name, icon, color, time_per_q: timePerQ, description: desc, sort_order: id };
  if (DEMO) {
    const mods = JSON.parse(localStorage.getItem("fue_modules") || JSON.stringify(FALLBACK_MODULES));
    if (mods.find((m) => m.id === id)) return { error: "Moduł o tym ID już istnieje." };
    mods.push({ id, name, icon, color, timePerQ, desc });
    mods.sort((a, b) => a.id - b.id);
    localStorage.setItem("fue_modules", JSON.stringify(mods));
    return { error: null };
  }
  const { error } = await supabase.from("modules").insert(rec);
  return { error: error?.message || null };
}

export async function updateModule(id, updates) {
  const dbUpdates = {};
  if (updates.name       !== undefined) dbUpdates.name        = updates.name;
  if (updates.icon       !== undefined) dbUpdates.icon        = updates.icon;
  if (updates.color      !== undefined) dbUpdates.color       = updates.color;
  if (updates.timePerQ   !== undefined) dbUpdates.time_per_q  = updates.timePerQ;
  if (updates.desc       !== undefined) dbUpdates.description = updates.desc;
  if (DEMO) {
    const mods = JSON.parse(localStorage.getItem("fue_modules") || JSON.stringify(FALLBACK_MODULES));
    const idx = mods.findIndex((m) => m.id === id);
    if (idx >= 0) { mods[idx] = { ...mods[idx], ...updates }; localStorage.setItem("fue_modules", JSON.stringify(mods)); }
    return { error: null };
  }
  const { error } = await supabase.from("modules").update(dbUpdates).eq("id", id);
  return { error: error?.message || null };
}

export async function deleteModule(id) {
  if (DEMO) {
    const mods = JSON.parse(localStorage.getItem("fue_modules") || JSON.stringify(FALLBACK_MODULES));
    localStorage.setItem("fue_modules", JSON.stringify(mods.filter((m) => m.id !== id)));
    return { error: null };
  }
  const { error } = await supabase.from("modules").delete().eq("id", id);
  return { error: error?.message || null };
}

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
    .select("*").eq("session_id", sessionId).order("created_at", { ascending: false });
  return data || [];
}
