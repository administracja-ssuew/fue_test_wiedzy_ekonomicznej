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

// Stały identyfikator urządzenia (localStorage) — do wiązania kodu z urządzeniem (#7).
export function getDeviceId() {
  try {
    let id = localStorage.getItem("fue_device_id");
    if (!id) { id = (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`); localStorage.setItem("fue_device_id", id); }
    return id;
  } catch { return null; }
}

export async function validateParticipantCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    const entry = codes.find((c) => c.code === code);
    if (!entry) return { error: "Nie znaleziono kodu." };
    return { data: entry, error: null };
  }
  // claim_participant_code (sekcja 34): waliduje + wiąże kod z urządzeniem. To samo
  // urządzenie wchodzi ponownie; inne dostaje 'taken'. Soft-fallback gdy nie wgrane.
  const device = getDeviceId();
  const { data, error } = await supabase.rpc("claim_participant_code", { p_code: code, p_device: device });
  if (!error && data) {
    if (data.ok) return { data: data.data, error: null };
    if (data.reason === "taken") return { error: "Ten kod jest już używany na innym urządzeniu. Poproś organizatora o jego zwolnienie." };
    return { error: "Nie znaleziono kodu." };
  }
  const missing = error && (error.code === "PGRST202" || /Could not find the function/i.test(error.message || ""));
  if (!missing) return { error: "Nie znaleziono kodu." };
  // Fallback: validate_participant_code (§27) lub bezpośredni select (bez wiązania).
  const { data: vData, error: vErr } = await supabase.rpc("validate_participant_code", { p_code: code });
  if (!vErr) { const row = Array.isArray(vData) ? vData[0] : vData; return row ? { data: row, error: null } : { error: "Nie znaleziono kodu." }; }
  const { data: sel } = await supabase.from("participant_codes").select("*").eq("code", code).single();
  return sel ? { data: sel, error: null } : { error: "Nie znaleziono kodu." };
}

// Admin: zwolnij kod (wyczyść powiązanie z urządzeniem) — zmiana telefonu itp.
export async function releaseCode(id) {
  if (DEMO) return { error: null };
  const { error } = await supabase.rpc("admin_release_code", { p_id: id });
  return { error: error?.message || null };
}

export async function markCodeUsed(code, sessionId) {
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    const idx = codes.findIndex((c) => c.code === code);
    if (idx >= 0) { codes[idx].used = true; codes[idx].session_id = sessionId; }
    localStorage.setItem("fue_codes", JSON.stringify(codes));
    return { error: null };
  }
  // Try SECURITY DEFINER RPC first (bypasses RLS for anon users).
  // If RPC doesn't exist yet, fall back to direct UPDATE.
  const { error: rpcErr } = await supabase.rpc("mark_code_used", { p_code: code, p_session_id: sessionId });
  if (!rpcErr) return { error: null };
  // Fallback: direct UPDATE. No "used=false" guard — a participant rejoining a NEW
  // session (after a reset) must update their session_id, else they aren't counted.
  const { error: updErr } = await supabase.from("participant_codes")
    .update({ used: true, session_id: sessionId }).eq("code", code);
  return { error: updErr?.message || null };
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

// Masowe usuwanie (admin). RPC §30 (role-checked); soft-fallback do bezpośredniego delete.
export async function deleteAllParticipantCodes(city) {
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    localStorage.setItem("fue_codes", JSON.stringify(codes.filter((c) => c.city !== city)));
    return { error: null };
  }
  const { error } = await supabase.rpc("admin_delete_city_codes", { p_city: city });
  if (!error) return { error: null };
  const missing = error.code === "PGRST202" || /Could not find the function/i.test(error.message || "");
  if (!missing) return { error: error.message };
  const { error: e2 } = await supabase.from("participant_codes").delete().eq("city", city);
  return { error: e2?.message || null };
}

export async function deleteAllQuestions(city, isPractice) {
  if (DEMO) {
    localStorage.removeItem(isPractice ? `fue_practice_${city}` : `fue_questions_${city}`);
    return { error: null };
  }
  const { error } = await supabase.rpc("admin_delete_city_questions", { p_city: city, p_practice: isPractice });
  if (!error) return { error: null };
  const missing = error.code === "PGRST202" || /Could not find the function/i.test(error.message || "");
  if (!missing) return { error: error.message };
  const { error: e2 } = await supabase.from("questions").delete().eq("city", city).eq("is_practice", isPractice);
  return { error: e2?.message || null };
}

// ─── QUESTIONS ────────────────────────────────────────────────────────────────

export async function getQuestions(city) {
  if (DEMO) {
    return JSON.parse(localStorage.getItem(`fue_questions_${city}`) || "[]");
  }
  // get_quiz_questions (sekcja 29): anon NIE dostaje 'ans' (M-2 — antycheat).
  // Admin (rola) dostaje ans. Soft-fallback do bezpośredniego selecta, gdy
  // sekcja 29 nie jest jeszcze wgrana (wtedy ans jest obecne — jak dawniej).
  const { data, error } = await supabase.rpc("get_quiz_questions", { p_city: city });
  if (!error) return data || [];
  const missing = error.code === "PGRST202" || /Could not find the function/i.test(error.message || "");
  if (!missing) return [];
  const { data: raw } = await supabase.from("questions").select("*")
    .eq("city", city).neq("is_practice", true).order("module").order("sort_order").order("id");
  return raw || [];
}

export async function getPracticeQuestions(city) {
  if (DEMO) {
    return JSON.parse(localStorage.getItem(`fue_practice_${city}`) || "[]");
  }
  // RPC (sekcja 29) — anon stracił bezpośredni SELECT na questions. Praktyka ma ans
  // (tryb osobisty). Soft-fallback do selecta, gdy sekcja 29 nie wgrana.
  const { data, error } = await supabase.rpc("get_practice_questions", { p_city: city });
  if (!error) return data || [];
  const missing = error.code === "PGRST202" || /Could not find the function/i.test(error.message || "");
  if (!missing) return [];
  const { data: raw } = await supabase.from("questions").select("*")
    .eq("city", city).eq("is_practice", true).order("module").order("sort_order").order("id");
  return raw || [];
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
  // RPC (sekcja 32) usuwa też odpowiedzi (FK) — pytanie z odpowiedziami nie dawało się
  // usunąć bezpośrednio. Soft-fallback do bezpośredniego delete, gdy RPC nie wgrany.
  const { error: rpcErr } = await supabase.rpc("admin_delete_question", { p_id: id });
  if (!rpcErr) return { error: null };
  const missing = rpcErr.code === "PGRST202" || /Could not find the function/i.test(rpcErr.message || "");
  if (!missing) return { error: rpcErr.message };
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
  const { data: lastSess } = await supabase.from("quiz_sessions")
    .select("bg, bg_mobile").eq("city", city).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase.from("quiz_sessions")
    .insert({ city, status: "waiting", is_practice: isPractice, created_by: adminId, bg: lastSess?.bg || null, bg_mobile: lastSess?.bg_mobile || null }).select().single();
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

// Historia: zakończone sesje (status ended/results), w tym próbne — do podglądu rankingu.
export async function getEndedSessions(city) {
  if (DEMO) return [];
  let q = supabase.from("quiz_sessions")
    .select("id, city, created_at, status, name, is_practice")
    .in("status", ["ended", "results"])
    .order("created_at", { ascending: false }).limit(80);
  if (city) q = q.eq("city", city);
  const { data } = await q;
  return data || [];
}

// Historia (#9): zmiana nazwy / usuwanie sesji (RPC, rola admina; sekcja 33).
export async function renameSession(id, name) {
  if (DEMO) return { error: null };
  const { error } = await supabase.rpc("admin_rename_session", { p_id: id, p_name: name });
  return { error: error?.message || null };
}
export async function deleteSession(id) {
  if (DEMO) return { error: null };
  const { error } = await supabase.rpc("admin_delete_session", { p_id: id });
  return { error: error?.message || null };
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
  // Ensure the access token is fresh before calling the RPC — getSession() automatically
  // uses the stored refresh token when the access token has expired.
  await supabase.auth.getSession();
  // Use SECURITY DEFINER RPC — direct UPDATE is silently blocked by sessions_admin_write RLS
  // when get_my_role() returns NULL (expired JWT, missing profile, etc.).
  const { error } = await supabase.rpc("update_quiz_session_admin", {
    p_session_id: sessionId,
    p_data: updates,
  });
  return { error: error?.message || null };
}

// Advance quiz to the next question using a server-generated timestamp.
// Uses optimistic locking so only the first of N concurrent callers wins.
// Returns { startedAt: string|null } — null means another client already advanced;
// the caller should wait for the Realtime event instead of setting a local timestamp.
export async function advanceSessionQuestion(sessionId, expectedIdx, nextIdx, leadSeconds = 4) {
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
          const startedAt = new Date(Date.now() + Math.max(0, leadSeconds) * 1000).toISOString();
          localStorage.setItem(key, JSON.stringify({ ...s, current_question_idx: nextIdx, q_started_at: startedAt }));
          return { startedAt, error: null };
        }
      }
    }
    return { startedAt: null, error: null };
  }
  let { data, error } = await supabase.rpc("advance_session_question", {
    p_session_id:   sessionId,
    p_expected_idx: expectedIdx,
    p_next_idx:     nextIdx,
    p_lead_seconds: leadSeconds,
  });
  // Miękki fallback: jeśli na bazie nie ma jeszcze 4-arg wersji (sekcja 26 nie
  // wgrana), nie zawieszaj quizu — wywołaj starą 3-arg (stały lead 4 s, bez
  // ekranu zapowiedzi modułu).
  if (error && (error.code === "PGRST202" || /Could not find the function/i.test(error.message || ""))) {
    ({ data, error } = await supabase.rpc("advance_session_question", {
      p_session_id: sessionId, p_expected_idx: expectedIdx, p_next_idx: nextIdx,
    }));
  }
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
    const real = JSON.parse(localStorage.getItem(`fue_session_${city}`) || "null");
    const prac = JSON.parse(localStorage.getItem(`fue_session_${city}_practice`) || "null");
    const active = [real, prac]
      .filter((s) => s && s.status !== "ended")
      .sort((a, b) => ({ running: 0, paused: 1, waiting: 2 }[a.status] ?? 3) - ({ running: 0, paused: 1, waiting: 2 }[b.status] ?? 3));
    return active[0] || null;
  }
  // Smart priority: running session first, then paused, then most recent waiting.
  // No is_practice filter — admin decides which session is active.
  const { data } = await supabase.from("quiz_sessions")
    .select("*").eq("city", city).neq("status", "ended")
    .order("created_at", { ascending: false });
  if (!data || !data.length) return null;
  return data.find((s) => s.status === "running")
      || data.find((s) => s.status === "paused")
      || data[0];
}

export async function getSessionById(sessionId) {
  if (DEMO) {
    const cities = ["Kraków", "Warszawa", "Poznań", "Wrocław", "Katowice"];
    for (const city of cities) {
      for (const suffix of ["", "_practice"]) {
        const s = JSON.parse(localStorage.getItem(`fue_session_${city}${suffix}`) || "null");
        if (s?.id === sessionId) return s;
      }
    }
    return null;
  }
  const { data } = await supabase.from("quiz_sessions").select("*").eq("id", sessionId).maybeSingle();
  return data || null;
}

export async function getParticipantsInSession(city, sessionId) {
  if (DEMO) {
    const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
    return codes.filter((c) => c.city === city && c.used && (!sessionId || c.session_id === sessionId));
  }
  let q = supabase.from("participant_codes").select("*").eq("city", city).eq("used", true);
  if (sessionId) q = q.eq("session_id", sessionId);
  const { data } = await q;
  return data || [];
}

// Tylko LICZBA uczestników w sesji — dla anonimowego Live View (licznik X/N).
// SECURITY DEFINER RPC nie ujawnia kodów/nazwisk. Soft-fallback do listy, gdy
// sekcja 27 SQL nie jest jeszcze wgrana (anon ma wtedy jeszcze SELECT).
export async function getParticipantCount(city, sessionId) {
  if (DEMO) return (await getParticipantsInSession(city, sessionId)).length;
  const { data, error } = await supabase
    .rpc("count_participants_in_session", { p_city: city, p_session_id: sessionId || null });
  if (!error && typeof data === "number") return data;
  const missingFn = error?.code === "PGRST202" || /Could not find the function/i.test(error?.message || "");
  if (missingFn) return (await getParticipantsInSession(city, sessionId)).length;
  return 0;
}

// ─── ANSWERS ──────────────────────────────────────────────────────────────────

export async function saveAnswer({ sessionId, participantCode, participantName, city, questionId, module, chosen, isCorrect, points, responseTimeS }) {
  if (DEMO) {
    const answers = JSON.parse(localStorage.getItem("fue_answers") || "[]");
    answers.push({ sessionId, participantCode, participantName, city, questionId, module, chosen, isCorrect, points, responseTimeS: responseTimeS ?? null, answeredAt: new Date().toISOString() });
    localStorage.setItem("fue_answers", JSON.stringify(answers));
    return { error: null };
  }
  // Plain INSERT — PostgREST upsert checks UPDATE policy even with DO NOTHING,
  // which anon doesn't have. Use INSERT and swallow 23505 (duplicate = already answered).
  const { error } = await supabase.from("answers").insert({
    session_id: sessionId, participant_code: participantCode, participant_name: participantName,
    city, question_id: questionId, module, chosen, is_correct: isCorrect, points,
    response_time_s: responseTimeS ?? null,
  });
  if (error?.code === "23505") return { error: null }; // already answered — ignore duplicate
  return { error: error?.message || null };
}

// Zapis odpowiedzi z SERWEROWĄ walidacją poprawności (sekcja 29): submit_answer
// liczy is_correct z questions.ans i zwraca correct_ans (do reveala). Anon NIE ma
// już bezpośredniego INSERT na answers. Soft-fallback do saveAnswer (klientowe
// isCorrect) gdy sekcja 29 nie wgrana. Zwraca { isCorrect, correctAns, error }.
export async function submitAnswer({ sessionId, participantCode, participantName, city, questionId, module, chosen, clientCorrect, responseTimeS }) {
  if (DEMO) {
    await saveAnswer({ sessionId, participantCode, participantName, city, questionId, module, chosen, isCorrect: !!clientCorrect, points: 0, responseTimeS });
    return { isCorrect: !!clientCorrect, correctAns: null, error: null };
  }
  const { data, error } = await supabase.rpc("submit_answer", {
    p_session_id: sessionId, p_code: participantCode, p_name: participantName,
    p_question_id: questionId, p_chosen: chosen,
  });
  if (!error) return { isCorrect: !!data?.is_correct, correctAns: data?.correct_ans ?? null, error: null };
  const missing = error.code === "PGRST202" || /Could not find the function/i.test(error.message || "");
  if (!missing) return { isCorrect: !!clientCorrect, correctAns: null, error: error.message };
  // Fallback (sekcja 29 nie wgrana): stary bezpośredni zapis, klientowe isCorrect.
  const { error: e2 } = await saveAnswer({ sessionId, participantCode, participantName, city, questionId, module, chosen, isCorrect: !!clientCorrect, points: 0, responseTimeS });
  return { isCorrect: !!clientCorrect, correctAns: null, error: e2 || null };
}

// Returns one participant's own answers for a session — used to rebuild local
// score/breakdown after a page refresh. SECURITY DEFINER RPC scopes rows to the
// given code only (participants are anon and can't SELECT the answers table).
export async function getParticipantAnswers(sessionId, participantCode) {
  if (DEMO) {
    return JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .filter((a) => a.sessionId === sessionId && a.participantCode === participantCode)
      .map((a) => ({ qId: a.questionId, module: a.module, picked: a.chosen, correct: a.isCorrect, pts: a.points }));
  }
  const { data, error } = await supabase.rpc("get_participant_answers", {
    p_session_id: sessionId, p_code: participantCode,
  });
  if (error || !data) return [];
  return data.map((a) => ({
    qId: a.question_id, module: a.module, picked: a.chosen, correct: a.is_correct, pts: a.points,
  }));
}

export async function getSessionResults(sessionId) {
  if (DEMO) {
    const answers = JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .filter((a) => a.sessionId === sessionId);
    const grouped = {};
    for (const a of answers) {
      if (!grouped[a.participantCode]) grouped[a.participantCode] = { code: a.participantCode, name: a.participantName, city: a.city || "", correct: 0, total: 0, totalTime: 0, timedAnswers: 0 };
      grouped[a.participantCode].total += 1;
      if (a.isCorrect) grouped[a.participantCode].correct += 1;
      if (a.responseTimeS != null) { grouped[a.participantCode].totalTime += a.responseTimeS; grouped[a.participantCode].timedAnswers += 1; }
    }
    return Object.values(grouped)
      .sort((a, b) => (b.correct - a.correct) || ((a.timedAnswers ? a.totalTime / a.timedAnswers : 1e9) - (b.timedAnswers ? b.totalTime / b.timedAnswers : 1e9)))
      .map((g) => ({
        code: g.code, name: g.name, city: g.city, correct: g.correct, total: g.total,
        avgResponseTime: g.timedAnswers ? Math.round(g.totalTime / g.timedAnswers) : null,
      }));
  }
  // Use RPC to aggregate on DB side — avoids PostgREST 1000-row default limit
  // which would truncate results for 500 participants × 32 questions = 16 000 rows.
  // Ranking wg liczby poprawnych odpowiedzi (bez punktów); remis → krótszy średni czas.
  const { data } = await supabase.rpc("get_session_results", { p_session_id: sessionId });
  if (!data) return [];
  // Number(...) || 0 — chroni przed NaN, gdyby na bazie była jeszcze STARA wersja
  // funkcji (sekcja 25 nie wgrana → brak correct_count/total_count).
  // avgResponseTime zawsze w MS (sekcja 31). Fallback: jeśli baza zwraca jeszcze sekundy.
  return data.map((r) => ({ code: r.participant_code, name: r.participant_name, city: r.city, correct: Number(r.correct_count) || 0, total: Number(r.total_count) || 0, avgResponseTime: r.avg_response_time_ms ?? (r.avg_response_time_s != null ? r.avg_response_time_s * 1000 : null) }));
}

// Live stats for current question (admin panel).
// Uses a SECURITY DEFINER RPC to bypass answers_admin_select RLS
// — ensures the count works regardless of JWT/RLS edge cases.
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
  const { data, error } = await supabase.rpc("get_admin_question_stats", {
    p_session_id: sessionId, p_question_id: questionId,
  });
  if (error) console.error("[getLiveQuestionStats]", error.message);
  if (!data) return { total: 0, correct: 0, avgTime: 0, answers: [] };
  return {
    total:   data.total   || 0,
    correct: data.correct || 0,
    avgTime: data.avg_time || 0,
    answers: (data.answers || []).map((a) => ({
      code: a.code, name: a.name, isCorrect: a.isCorrect, points: a.points, responseTime: a.responseTime ?? null,
    })),
  };
}

// Lightweight {total, correct} summary for the admin live banner during a question.
// Avoids the full json_agg of get_admin_question_stats (which loads every answer row).
export async function getLiveAnswerSummary(sessionId, questionId) {
  if (DEMO) {
    const raw = JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .filter((a) => a.sessionId === sessionId && a.questionId === questionId);
    return { total: raw.length, correct: raw.filter((a) => a.isCorrect).length, ans: null };
  }
  // ans: poprawna odpowiedź BRAMKOWANA serwerowo (tylko po końcu czasu pytania) —
  // do podświetlenia w reveal na publicznym LiveView, bez wycieku przed czasem.
  const { data } = await supabase.rpc("get_admin_answer_summary", {
    p_session_id: sessionId, p_question_id: questionId,
  });
  return { total: data?.total || 0, correct: data?.correct || 0, ans: data?.ans ?? null };
}

// Lightweight count-only query for LiveView (anon-safe via SECURITY DEFINER RPC).
export async function getLiveAnswerCount(sessionId, questionId) {
  if (DEMO) {
    return JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .filter((a) => a.sessionId === sessionId && a.questionId === questionId).length;
  }
  const { data } = await supabase.rpc("get_live_answer_count", {
    p_session_id: sessionId, p_question_id: questionId,
  });
  return data || 0;
}

// ─── PER-CITY BACKGROUND ──────────────────────────────────────────────────────

const DEFAULT_BG = "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)";

// Returns { bg, bgMobile } — both may be null.
export async function getCityBg(city) {
  if (DEMO) return {
    bg:       localStorage.getItem(`fue_bg_${city}`) || null,
    bgMobile: localStorage.getItem(`fue_bg_mobile_${city}`) || null,
  };
  const { data } = await supabase.from("quiz_sessions")
    .select("bg, bg_mobile").eq("city", city)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { bg: data?.bg || null, bgMobile: data?.bg_mobile || null };
}

// isMobile=true updates bg_mobile column; false updates bg.
// Pass null as bg to clear (mobile falls back to desktop).
export async function setCityBg(city, bg, isMobile = false) {
  const col = isMobile ? "bg_mobile" : "bg";
  if (DEMO) {
    const lsKey = isMobile ? `fue_bg_mobile_${city}` : `fue_bg_${city}`;
    if (bg) localStorage.setItem(lsKey, bg); else localStorage.removeItem(lsKey);
    for (const key of [`fue_session_${city}`, `fue_session_${city}_practice`]) {
      const s = localStorage.getItem(key);
      if (s) localStorage.setItem(key, JSON.stringify({ ...JSON.parse(s), [col]: bg ?? null }));
    }
    return { error: null };
  }
  const { error } = await supabase.from("quiz_sessions")
    .update({ [col]: bg ?? null }).eq("city", city).neq("status", "ended");
  return { error: error?.message || null };
}

// Upload image to Supabase Storage bucket "backgrounds".
// isMobile=true stores to "mobile" variant path and updates bg_mobile column.
export async function uploadCityBg(city, file, isMobile = false) {
  if (DEMO) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ url: e.target.result, error: null });
      reader.onerror = () => resolve({ url: null, error: "Błąd odczytu pliku." });
      reader.readAsDataURL(file);
    });
  }
  // Refresh access token before upload — storage RLS requires authenticated role.
  await supabase.auth.getSession();
  const ext = file.name.split(".").pop().toLowerCase();
  const safeCity = city.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const path = isMobile ? `${safeCity}/mobile.${ext}` : `${safeCity}/bg.${ext}`;
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

// ─── TELEMETRY / EVENT LOG ──────────────────────────────────────────────────────
// Lightweight, best-effort logging for a one-shot live event. Every call swallows
// its own errors so logging can never break the quiz, and is a no-op until the
// event_log table exists (see SUPABASE_FIXES.sql section 16).

// Generic structured event (quiz lifecycle, admin actions, etc.).
export async function logEvent({ type, sessionId = null, city = null, actor = null, detail = null }) {
  if (DEMO) {
    const log = JSON.parse(localStorage.getItem("fue_event_log") || "[]");
    log.push({ type, sessionId, city, actor, detail, at: new Date().toISOString() });
    localStorage.setItem("fue_event_log", JSON.stringify(log.slice(-500)));
    return;
  }
  try {
    await supabase.rpc("log_event", {
      p_type: type, p_session_id: sessionId, p_city: city,
      p_actor: actor, p_detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (_) { /* logging must never throw */ }
}

// Client-side runtime/render error (from ErrorBoundary or catch blocks).
export async function recordClientError({ where, message, stack }) {
  return logEvent({ type: "client_error", detail: { where, message, stack } });
}

export async function getEventLog(sessionId) {
  if (DEMO) {
    return JSON.parse(localStorage.getItem("fue_event_log") || "[]")
      .filter((e) => !sessionId || e.sessionId === sessionId);
  }
  const { data } = await supabase.from("event_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  return data || [];
}
