import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const DEMO = !SUPABASE_URL || !SUPABASE_KEY;

// Fail-closed: tryb DEMO (localStorage + testowe hasło admina) NIGDY nie może włączyć
// się po cichu na produkcji przy braku/literówce zmiennych środowiskowych. Lepszy
// twardy, widoczny błąd na etapie buildu/deployu niż niezauważona luka podczas konkursu.
if (DEMO && import.meta.env.PROD) {
  throw new Error(
    "Brak konfiguracji Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). " +
    "Tryb DEMO jest zablokowany w buildzie produkcyjnym — ustaw zmienne środowiskowe i zbuduj ponownie."
  );
}

export const supabase = DEMO ? null : createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── REALTIME KEEPALIVE ───────────────────────────────────────────────────────
// PRZYCZYNA (zmierzona 23.09.2026 podsłuchem ramek WebSocket na buildzie produkcyjnym):
// supabase-js rozłącza socket, gdy lista kanałów się opróżni. Wyjście z poczekalni
// odmontowuje Lobby i usuwa jego kanały; w tej samej chwili socket padał i NIE WRACAŁ.
// Uczestnik żył wtedy wyłącznie z polla awaryjnego co 10 s: zastygał na skończonym
// pytaniu i wskakiwał w kolejne w locie, tracąc kilka sekund na odpowiedź.
//
// Ten kanał jest subskrybowany raz i nigdy nie usuwany, więc lista kanałów nigdy nie
// schodzi do zera i socket nie ma powodu się rozłączyć. Nie przesyła żadnych danych
// i nie tworzy dodatkowego połączenia — Supabase liczy sockety, nie kanały.
let keepAliveCh = null;
export function keepRealtimeAlive() {
  if (DEMO || !supabase || keepAliveCh) return;
  try { keepAliveCh = supabase.channel("fue-keepalive").subscribe(); } catch (_) { /* nieistotne */ }
}

const CITY_PREFIX = { Kraków: "KRK", Warszawa: "WAR", Poznań: "POZ", Wrocław: "WRO", Katowice: "KAT" };

// Kod uczestnika: 6 cyfr (np. KRK-482910). Numeryczny — łatwy do wpisania i
// podyktowania — a jednocześnie 1 000 000 kombinacji, czyli ~110× więcej niż dawne
// 4 cyfry (9000). To zamyka realne ryzyko: przy device-bindingu (claim_participant_code)
// zgadnięty kod BLOKUJE prawowitego uczestnika, więc mała pula = łatwe griefowanie.
function randomCodeBody(len = 6) {
  const bytes = (typeof crypto !== "undefined" && crypto.getRandomValues)
    ? crypto.getRandomValues(new Uint8Array(len)) : null;
  let out = "";
  for (let i = 0; i < len; i++) {
    const r = bytes ? bytes[i] : Math.floor(Math.random() * 256);
    out += String(r % 10);
  }
  return out;
}

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
  if (pErr) {
    console.error("[loginAdmin] profile fetch failed:", pErr.message);
    return { error: "Błąd logowania. Spróbuj ponownie lub skontaktuj się z administratorem systemu." };
  }
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
  const code = `${prefix}-${randomCodeBody(6)}`;
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
    .eq("city", city).or("is_practice.is.null,is_practice.eq.false").order("module").order("sort_order").order("id");
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

// Karta odpowiedzi KAŻDEGO uczestnika sesji — zasila eksport XLSX (arkusz per osoba).
// Zwraca iloczyn uczestnicy × pytania (pytania bez odpowiedzi mają puste chosen_*),
// więc dla 500 osób × 58 pytań to ~29 000 wierszy. PostgREST tnie odpowiedź na strony,
// dlatego pobieramy zakresami aż do wyczerpania — inaczej eksport po cichu gubiłby
// ogon listy i nikt by tego nie zauważył aż do reklamacji uczestnika.
export async function getSessionDetailedResults(sessionId) {
  if (DEMO) {
    const answers = JSON.parse(localStorage.getItem("fue_answers") || "[]").filter((a) => a.sessionId === sessionId);
    return {
      error: null,
      rows: answers.map((a, i) => ({
        participantCode: a.participantCode, participantName: a.participantName, city: a.city || "",
        qNo: i + 1, module: a.module, moduleName: `Moduł ${a.module}`, question: a.questionId,
        chosenLabel: a.chosen != null ? "ABCD"[a.chosen] : "", chosenText: "",
        correctLabel: "", correctText: "", isCorrect: !!a.isCorrect, responseTimeMs: a.responseTimeS != null ? a.responseTimeS * 1000 : null,
      })),
    };
  }
  const PAGE = 5000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc("get_session_detailed_results", { p_session_id: sessionId })
      .range(from, from + PAGE - 1);
    if (error) return { error: error.message, rows: [] };
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return {
    error: null,
    rows: out.map((r) => ({
      participantCode: r.participant_code, participantName: r.participant_name, city: r.city,
      qNo: r.q_no, module: r.module, moduleName: r.module_name, question: r.question,
      chosenLabel: r.chosen_label || "", chosenText: r.chosen_text || "",
      correctLabel: r.correct_label || "", correctText: r.correct_text || "",
      isCorrect: !!r.is_correct, responseTimeMs: r.response_time_ms,
    })),
  };
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

// Zwraca { modules, fromDb } — rozróżnienie KRYTYCZNE dla uczciwości testu.
// ZMIERZONE 24.09.2026 sondą pełnej ścieżki: telefon, któremu ten jeden fetch się
// nie udał, przez CAŁY test używał zaszytych w kodzie czasów awaryjnych
// (90/30/60/75/45 s) zamiast tych z bazy (20 s). Na tym samym pytaniu jeden
// uczestnik odliczał od 70, drugi od 15 — i nic tego nigdy nie korygowało, bo
// stary getModules() gubił `error`, więc awaria sieci wyglądała identycznie jak
// pusta tabela. Wywołujący nie miał czym odróżnić „baza nie odpowiedziała" od
// „modułów naprawdę nie ma", więc nie mógł ponowić próby.
export async function fetchModules() {
  if (DEMO) {
    const cached = localStorage.getItem("fue_modules");
    return { modules: cached ? JSON.parse(cached) : FALLBACK_MODULES, fromDb: true };
  }
  const { data, error } = await supabase.from("modules").select("*").order("sort_order");
  if (error) {
    console.error("[fetchModules] nie udało się pobrać modułów:", error.message);
    return { modules: FALLBACK_MODULES, fromDb: false };
  }
  // `data` MUSI być sprawdzone na null. Bez tego `data.length` rzuca TypeError wewnątrz
  // pętli ponowień w ModulesProvider, ponowienie nigdy nie następuje i uczestnik cicho
  // zostaje na czasach awaryjnych — czyli dokładnie ten błąd, który ta funkcja naprawia.
  // Zgubiłem ten warunek w pierwszej wersji naprawy (24.09); sonda to wychwyciła.
  if (!data) {
    console.error("[fetchModules] brak danych i brak błędu — traktuję jak awarię");
    return { modules: FALLBACK_MODULES, fromDb: false };
  }
  if (!data.length) return { modules: FALLBACK_MODULES, fromDb: true }; // tabela naprawdę pusta
  return {
    modules: data.map((m) => ({ id: m.id, name: m.name, icon: m.icon, color: m.color, timePerQ: m.time_per_q, desc: m.description || "" })),
    fromDb: true,
  };
}

export async function getModules() {
  const { modules } = await fetchModules();
  return modules;
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
  // Akceptuj OBA warianty kluczy. AdminPanel wysyła snake_case (time_per_q, description),
  // a mapowane były wyłącznie camelCase (timePerQ, desc) — przez co czas na pytanie
  // i opis znikały po cichu przy każdym zapisie z panelu.
  const timePerQ = updates.timePerQ !== undefined ? updates.timePerQ : updates.time_per_q;
  const desc     = updates.desc     !== undefined ? updates.desc     : updates.description;
  const dbUpdates = {};
  if (updates.name  !== undefined) dbUpdates.name        = updates.name;
  if (updates.icon  !== undefined) dbUpdates.icon        = updates.icon;
  if (updates.color !== undefined) dbUpdates.color       = updates.color;
  if (timePerQ      !== undefined) dbUpdates.time_per_q  = timePerQ;
  if (desc          !== undefined) dbUpdates.description = desc;

  if (DEMO) {
    const mods = JSON.parse(localStorage.getItem("fue_modules") || JSON.stringify(FALLBACK_MODULES));
    const idx = mods.findIndex((m) => m.id === id);
    const camel = { ...updates };
    if (timePerQ !== undefined) camel.timePerQ = timePerQ;
    if (desc     !== undefined) camel.desc     = desc;
    if (idx >= 0) { mods[idx] = { ...mods[idx], ...camel }; localStorage.setItem("fue_modules", JSON.stringify(mods)); }
    return { error: null };
  }

  const { data, error } = await supabase.from("modules").update(dbUpdates).eq("id", id).select("id");
  if (error) return { error: error.message };
  if (data && data.length) return { error: null };

  // Zero zaktualizowanych wierszy = moduł istnieje TYLKO w fallbacku, bo tabela modules
  // jest pusta (getModules() zwraca wtedy MODULES z data/questions.js). Wcześniej ten
  // przypadek kończył się cichym no-op i wyglądał jak niedziałająca edycja — teraz
  // materializujemy moduł w bazie, dokładając brakujące pola z fallbacku.
  const fb = FALLBACK_MODULES.find((m) => m.id === id);
  const row = {
    id,
    name:        dbUpdates.name        ?? fb?.name     ?? `Moduł ${id}`,
    icon:        dbUpdates.icon        ?? fb?.icon     ?? "📚",
    color:       dbUpdates.color       ?? fb?.color    ?? "#6B21E8",
    time_per_q:  dbUpdates.time_per_q  ?? fb?.timePerQ ?? 60,
    description: dbUpdates.description ?? fb?.desc     ?? null,
    sort_order:  fb ? FALLBACK_MODULES.indexOf(fb) + 1 : id,
  };
  const { error: insErr } = await supabase.from("modules").insert(row);
  return { error: insErr?.message || null };
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
  // LIMIT jest istotny: panel odpytuje to co 3 s, a violations rośnie przez cały test
  // (visibilitychange odpala się przy każdym zablokowaniu ekranu telefonu). Bez limitu
  // admin w drugiej połowie ściąga tysiące wierszy co trzy sekundy. 200 najnowszych
  // w zupełności wystarcza jako sygnał dla komisji.
  const { data } = await supabase.from("violations")
    .select("*").eq("session_id", sessionId)
    .order("created_at", { ascending: false }).limit(200);
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

// ─── Faza 6: rozgrywka z planu (RPC v2) ───────────────────────────────────────
// Serwer jest jedynym źródłem prawdy: plan sesji zamrażany przy starcie, pozycja
// liczona z kotwicy i zegara serwera. Wrappery nigdy nie rzucają — konwencja repo
// { data, error }. DEMO buduje ten sam plan lokalnie (plan.js), więc tryb bez kluczy
// Supabase przechodzi dokładnie tę samą ścieżkę uczestnika co produkcja.

import {
  buildPlanItems, planPosition, isRevealed, resumeAnchor, skipAnchor, repeatAnchor,
  answerResponseMs, toMs, REVEAL_GATE_MS,
} from "./plan.js";

const isMissingFn = (e) => e && (e.code === "PGRST202" || /Could not find the function/i.test(e.message || ""));
const DEMO_CITIES = ["Kraków", "Warszawa", "Poznań", "Wrocław", "Katowice"];
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

// DEMO: znajdź sesję po id we wszystkich kluczach `fue_session_${city}${suffix}`.
function demoFindSession(sessionId) {
  for (const city of DEMO_CITIES) {
    for (const suffix of ["", "_practice"]) {
      const key = `fue_session_${city}${suffix}`;
      const s = JSON.parse(localStorage.getItem(key) || "null");
      if (s?.id === sessionId) return { key, s };
    }
  }
  return null;
}

function demoPlan(sessionId) {
  try { return JSON.parse(localStorage.getItem(`fue_plan_${sessionId}`) || "null"); } catch { return null; }
}

function demoQuestionsSorted(city) {
  const qs = JSON.parse(localStorage.getItem(`fue_questions_${city}`) || "[]");
  return [...qs].sort((a, b) =>
    (a.module - b.module) || ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || String(a.id).localeCompare(String(b.id)));
}

// DEMO: q_started_at / current_question_idx jako lustro pozycji (dla starych ekranów).
function demoSyncRow(s, items, nowMs) {
  const pos = planPosition(items, toMs(s.plan_anchor_at), toMs(s.plan_paused_at), nowMs);
  if (!pos) return s;
  return { ...s, current_question_idx: pos.idx, q_started_at: iso(pos.opensAt) };
}

export async function startQuizSessionV2(sessionId) {
  if (DEMO) {
    const found = demoFindSession(sessionId);
    if (!found) return { ok: false, reason: "not found", session: null, error: null };
    const { key, s } = found;
    if (s.status !== "waiting") return { ok: false, reason: "not waiting", session: s, error: null };
    const qs = demoQuestionsSorted(s.city);
    if (!qs.length) return { ok: false, reason: "no questions", session: s, error: null };
    const items = buildPlanItems(qs, await getModules());
    localStorage.setItem(`fue_plan_${sessionId}`, JSON.stringify(items));
    const anchor = Date.now();
    const next = {
      ...s, status: "running", current_question_idx: 0,
      plan_anchor_at: iso(anchor), plan_paused_at: null, revealed_idx: null, revealed_ans: null,
      q_started_at: iso(anchor + items[0].o),
    };
    localStorage.setItem(key, JSON.stringify(next));
    return { ok: true, reason: null, session: next, error: null };
  }
  await supabase.auth.getSession();
  const { data, error } = await supabase.rpc("start_quiz_session_v2", { p_session_id: sessionId });
  if (error) {
    if (isMissingFn(error)) return { ok: false, reason: null, session: null, error: "Na bazie brak sekcji 39 (start_quiz_session_v2) — wgraj SQL." };
    return { ok: false, reason: null, session: null, error: error.message };
  }
  return { ok: !!data?.ok, reason: data?.reason ?? null, session: data?.session ?? null, error: null };
}

export async function getSessionPlan(sessionId) {
  if (!sessionId) return null;
  if (DEMO) return demoPlan(sessionId);
  const { data, error } = await supabase.from("session_plans").select("items").eq("session_id", sessionId).maybeSingle();
  if (error || !data) return null;
  return data.items || null;
}

// DEMO: ten sam kształt JSON co get_participant_state (39.6b), łącznie z regułą
// porzucenia przypiętej zakończonej sesji, gdy miasto ma nowszą niezakończoną.
// Kod walidowany tak jak validateParticipantCode w DEMO (lista `fue_codes`).
function demoParticipantState(rawCode, sessionId, includePlan) {
  const nowMs = Date.now();
  const code = String(rawCode || "").trim().toUpperCase();
  const codes = JSON.parse(localStorage.getItem("fue_codes") || "[]");
  const entry = codes.find((c) => c.code === code);
  if (!entry) return { server_now: nowMs, error: "invalid code" };
  const city = entry.city;
  const cands = ["", "_practice"]
    .map((suf) => JSON.parse(localStorage.getItem(`fue_session_${city}${suf}`) || "null"))
    .filter(Boolean);

  let s = null;
  if (sessionId) {
    s = cands.find((x) => x.id === sessionId) || null;
    if (s && (s.status === "results" || s.status === "ended")) {
      const newer = cands.some((n) => n.status !== "ended" && n.id !== s.id
        && (toMs(n.created_at) ?? 0) > (toMs(s.created_at) ?? 0));
      if (newer) s = null;
    }
  }
  if (!s) {
    const rank = { running: 0, paused: 1, waiting: 2 };
    s = cands.filter((x) => x.status !== "ended")
      .sort((a, b) => ((rank[a.status] ?? 3) - (rank[b.status] ?? 3)) || ((toMs(b.created_at) ?? 0) - (toMs(a.created_at) ?? 0)))[0] || null;
  }
  if (!s) {
    return { server_now: nowMs, error: null, session: null, position: null, plan: null, my_answers: [], reveal: null, correct_total: 0 };
  }

  const anchorMs = toMs(s.plan_anchor_at);
  const pausedMs = toMs(s.plan_paused_at);
  const items = anchorMs != null ? demoPlan(s.id) : null;
  const final = s.status === "results" || s.status === "ended";
  const qs = JSON.parse(localStorage.getItem(`fue_questions_${city}`) || "[]");
  const qById = (id) => qs.find((q) => q.id === id);

  let position = null;
  let plan = null;
  let reveal = null;
  if (items?.length) {
    const pos = planPosition(items, anchorMs, pausedMs, nowMs);
    if (pos) {
      position = { idx: pos.idx, phase: pos.phase, opens_at: pos.opensAt, closes_at: pos.closesAt, reveal_until: pos.revealUntil };
    }
    if (includePlan) {
      // Plan BEZ `ans` — poprawność tylko przez reveal.
      plan = items.map((it) => {
        const q = qById(it.id);
        return { ...it, q: q?.q ?? "(pytanie usunięte)", opts: q?.opts ?? [] };
      });
    }
    let rev = null;
    if (final) rev = items.length - 1;
    else if (pos) rev = isRevealed(pos.item, anchorMs, pausedMs, nowMs) ? pos.idx : (pos.idx > 0 ? pos.idx - 1 : null);
    if (rev != null) reveal = { idx: rev, ans: qById(items[rev].id)?.ans ?? null };
  }

  const mine = JSON.parse(localStorage.getItem("fue_answers") || "[]")
    .filter((a) => a.sessionId === s.id && a.participantCode === code);
  let correctTotal = 0;
  const myAnswers = mine.map((a) => {
    const it = items?.find((x) => x.id === a.questionId);
    const open = final || (it && anchorMs != null && isRevealed(it, anchorMs, pausedMs, nowMs));
    if (open && a.isCorrect === true) correctTotal++;
    return { question_id: a.questionId, chosen: a.chosen, is_correct: open ? !!a.isCorrect : null };
  });

  return {
    server_now: nowMs,
    error: null,
    session: {
      id: s.id, city: s.city, status: s.status, is_practice: !!s.is_practice,
      bg: s.bg ?? null, bg_mobile: s.bg_mobile ?? null, name: s.name ?? null,
      plan_anchor_at: anchorMs, plan_paused_at: pausedMs,
    },
    position, plan, my_answers: myAnswers, reveal, correct_total: correctTotal,
  };
}

// Jeden snapshot stanu uczestnika. t0/t1 wokół wywołania → próbka zegara (server_now).
export async function getParticipantState(code, { sessionId = null, includePlan = true } = {}) {
  const t0 = Date.now();
  if (DEMO) {
    const data = demoParticipantState(code, sessionId, includePlan);
    return { data, error: null, t0, t1: Date.now() };
  }
  const { data, error } = await supabase.rpc("get_participant_state", {
    p_code: code, p_session_id: sessionId, p_include_plan: includePlan,
  });
  const t1 = Date.now();
  if (error) {
    return { data: null, error: isMissingFn(error) ? "Na bazie brak sekcji 39 (get_participant_state) — wgraj SQL." : error.message, t0, t1 };
  }
  return { data, error: null, t0, t1 };
}

// Zapis odpowiedzi. Odpowiedź serwera NIE niesie poprawności (SC5) — kolor poprawnej
// odpowiedzi przychodzi wyłącznie z reveal / revealed_*.
export async function submitAnswerV2({ sessionId, participantCode, participantName, questionId, chosen }) {
  if (DEMO) {
    const found = demoFindSession(sessionId);
    const items = demoPlan(sessionId);
    if (!found || !items?.length || found.s.plan_anchor_at == null) {
      return { accepted: false, duplicate: false, chosen: null, error: "session has no plan", retryable: false };
    }
    const { s } = found;
    if (s.plan_paused_at != null || s.status === "paused") {
      return { accepted: false, duplicate: false, chosen: null, error: "session paused", retryable: true };
    }
    if (s.status !== "running") return { accepted: false, duplicate: false, chosen: null, error: "session not running", retryable: false };
    const item = items.find((x) => x.id === questionId);
    if (!item) return { accepted: false, duplicate: false, chosen: null, error: "question not in plan", retryable: false };
    const nowMs = Date.now();
    const anchorMs = toMs(s.plan_anchor_at);
    if (nowMs < anchorMs + item.o) return { accepted: false, duplicate: false, chosen: null, error: "question not started", retryable: false };
    if (chosen != null && nowMs > anchorMs + item.c + REVEAL_GATE_MS) {
      return { accepted: false, duplicate: false, chosen: null, error: "time is up", retryable: false };
    }
    const code = String(participantCode || "").trim().toUpperCase();
    const prev = JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .find((a) => a.sessionId === sessionId && a.participantCode === code && a.questionId === questionId);
    if (prev) return { accepted: true, duplicate: true, chosen: prev.chosen ?? null, error: null, retryable: false };
    const q = JSON.parse(localStorage.getItem(`fue_questions_${s.city}`) || "[]").find((x) => x.id === questionId);
    const rtMs = answerResponseMs(item, anchorMs, nowMs, chosen);
    await saveAnswer({
      sessionId, participantCode: code, participantName, city: s.city, questionId, module: item.m,
      chosen, isCorrect: chosen != null && q?.ans === chosen, points: 0, responseTimeS: Math.floor(rtMs / 1000),
    });
    return { accepted: true, duplicate: false, chosen, error: null, retryable: false };
  }
  const { data, error } = await supabase.rpc("submit_answer_v2", {
    p_session_id: sessionId, p_code: participantCode, p_name: participantName,
    p_question_id: questionId, p_chosen: chosen,
  });
  if (error) {
    const msg = error.message || "";
    // Sieć / timeout (brak kodu PostgREST) albo pauza → warto ponowić w oknie odpowiedzi.
    const retryable = (!error.code && /fetch|network|timeout|Failed/i.test(msg)) || /session paused/i.test(msg);
    return { accepted: false, duplicate: false, chosen: null, error: msg, retryable };
  }
  return { accepted: !!data?.accepted, duplicate: !!data?.duplicate, chosen: data?.chosen ?? null, error: null, retryable: false };
}

// Licznik odpowiedzi + bramkowana poprawność (correct/ans dopiero po closes + 1,5 s).
export async function getAnswerSummaryV2(sessionId, questionId) {
  if (DEMO) {
    const raw = JSON.parse(localStorage.getItem("fue_answers") || "[]")
      .filter((a) => a.sessionId === sessionId && a.questionId === questionId);
    const found = demoFindSession(sessionId);
    const items = demoPlan(sessionId);
    const item = items?.find((x) => x.id === questionId);
    const s = found?.s;
    const open = !!s && (s.status === "results" || s.status === "ended"
      || (!!item && s.plan_anchor_at != null && isRevealed(item, toMs(s.plan_anchor_at), toMs(s.plan_paused_at), Date.now())));
    const q = open ? JSON.parse(localStorage.getItem(`fue_questions_${s.city}`) || "[]").find((x) => x.id === questionId) : null;
    return { total: raw.length, correct: open ? raw.filter((a) => a.isCorrect).length : null, ans: open ? (q?.ans ?? null) : null };
  }
  const { data, error } = await supabase.rpc("get_answer_summary_v2", { p_session_id: sessionId, p_question_id: questionId });
  if (error) {
    if (isMissingFn(error)) return getLiveAnswerSummary(sessionId, questionId);
    return { total: 0, correct: null, ans: null };
  }
  return { total: data?.total || 0, correct: data?.correct ?? null, ans: data?.ans ?? null };
}

// DEMO: wspólny szkielet akcji admina — przesunięcie kotwicy na wierszu w localStorage.
function demoAdminAction(sessionId, fn) {
  const found = demoFindSession(sessionId);
  if (!found) return { ok: false, reason: "not found", session: null, error: null };
  const { key, s } = found;
  const items = demoPlan(sessionId);
  if (!items?.length || s.plan_anchor_at == null) return { ok: false, reason: "no plan", session: s, error: null };
  const res = fn(s, items, Date.now());
  if (!res.next) return { ok: false, reason: res.reason, session: s, error: null };
  localStorage.setItem(key, JSON.stringify(res.next));
  return { ok: true, reason: null, session: res.next, error: null };
}

async function adminRpc(name, args) {
  await supabase.auth.getSession();
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (isMissingFn(error)) return { ok: false, reason: null, session: null, error: `Na bazie brak sekcji 39 (${name}) — wgraj SQL.` };
    return { ok: false, reason: null, session: null, error: error.message };
  }
  return { ok: !!data?.ok, reason: data?.reason ?? null, session: data?.session ?? null, error: null };
}

export async function adminPauseSession(sessionId) {
  if (DEMO) {
    return demoAdminAction(sessionId, (s, items, nowMs) => {
      if (s.status !== "running" || s.plan_paused_at != null) return { reason: "not running" };
      return { next: { ...s, status: "paused", plan_paused_at: iso(nowMs) } };
    });
  }
  return adminRpc("admin_pause_session", { p_session_id: sessionId });
}

export async function adminResumeSession(sessionId) {
  if (DEMO) {
    return demoAdminAction(sessionId, (s, items, nowMs) => {
      if (s.plan_paused_at == null) return { reason: "not paused" };
      const anchor = resumeAnchor(toMs(s.plan_anchor_at), toMs(s.plan_paused_at), nowMs);
      const next = { ...s, status: "running", plan_anchor_at: iso(anchor), plan_paused_at: null };
      return { next: demoSyncRow(next, items, nowMs) };
    });
  }
  return adminRpc("admin_resume_session", { p_session_id: sessionId });
}

export async function adminSkipQuestion(sessionId, idx) {
  if (DEMO) {
    return demoAdminAction(sessionId, (s, items, nowMs) => {
      if (s.status !== "running" || s.plan_paused_at != null) return { reason: "noop" };
      const anchor = skipAnchor(items, toMs(s.plan_anchor_at), nowMs, idx);
      if (anchor == null) return { reason: "noop" };
      return { next: demoSyncRow({ ...s, plan_anchor_at: iso(anchor) }, items, nowMs) };
    });
  }
  return adminRpc("admin_skip_question", { p_session_id: sessionId, p_idx: idx });
}

export async function adminRepeatQuestion(sessionId, idx) {
  if (DEMO) {
    return demoAdminAction(sessionId, (s, items, nowMs) => {
      if (s.status !== "running" || s.plan_paused_at != null) return { reason: "noop" };
      const anchor = repeatAnchor(items, toMs(s.plan_anchor_at), nowMs, idx);
      if (anchor == null) return { reason: "noop" };
      return { next: demoSyncRow({ ...s, plan_anchor_at: iso(anchor) }, items, nowMs) };
    });
  }
  return adminRpc("admin_repeat_question", { p_session_id: sessionId, p_idx: idx });
}

export async function getSweeperStatus() {
  if (DEMO) return { cron_installed: true, job_active: true, last_run_age_s: 0, last_status: "succeeded" };
  const { data, error } = await supabase.rpc("sweeper_status");
  if (error) return null;
  return data ?? null;
}

export async function adminSweepSession(sessionId) {
  if (DEMO) {
    const found = demoFindSession(sessionId);
    const items = demoPlan(sessionId);
    if (found && items?.length && found.s.plan_anchor_at != null && found.s.status === "running") {
      const { key, s } = found;
      const pos = planPosition(items, toMs(s.plan_anchor_at), toMs(s.plan_paused_at), Date.now());
      if (pos?.phase === "finished") localStorage.setItem(key, JSON.stringify({ ...s, status: "results" }));
    }
    return { error: null };
  }
  await supabase.auth.getSession();
  const { error } = await supabase.rpc("admin_sweep_session", { p_session_id: sessionId });
  return { error: error?.message || null };
}
