import { useState, useEffect, useRef } from "react";
import {
  getQuestions, getPracticeQuestions, addQuestion, updateQuestion, deleteQuestion,
  getParticipantCodes, generateParticipantCode, deleteParticipantCode,
  getOrCreateSession, getSessionById, updateSession, startQuizSession, getParticipantsInSession, getSessionResults,
  getLiveQuestionStats, endAndResetSession, getCityBg, setCityBg, uploadCityBg, DEFAULT_BG,
  getViolationsForSession,
  getModules, addModule, updateModule, deleteModule,
} from "../lib/supabase.js";
import { CITIES } from "../data/questions.js";
import { useModules } from "../context/ModulesContext.jsx";

const C = {
  bg:    "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)",
  card:  (x = {}) => ({ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 14, ...x }),
  btn:   (v = "primary", x = {}) => ({
    ...(v === "primary" ? { background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", boxShadow: "0 6px 20px rgba(107,33,232,.4)" }
      : v === "success" ? { background: "linear-gradient(135deg,#0B9E6B,#08815A)", color: "#fff" }
      : v === "danger"  ? { background: "linear-gradient(135deg,#E8376B,#B01A4E)", color: "#fff" }
      : v === "pause"   ? { background: "linear-gradient(135deg,#E65100,#BF360C)", color: "#fff" }
      : v === "gold"    ? { background: "linear-gradient(135deg,#B8860B,#F5C518)", color: "#070215" }
      : { background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", color: "#C4B5FD" }),
    border: ["primary","success","danger","pause","gold"].includes(v) ? "none" : undefined,
    borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700,
    cursor: "pointer", fontFamily: '"Space Grotesk",sans-serif', ...x,
  }),
  input: (x = {}) => ({ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, padding: "11px 14px", color: "#EDE9FE", fontSize: 14, fontFamily: '"Space Grotesk",sans-serif', width: "100%", ...x }),
  lbl:   { fontSize: 11, fontWeight: 600, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 },
};

const CITY_COLORS  = { Kraków: "#FFA653", Warszawa: "#FF6B6B", Poznań: "#4ECDC4", Wrocław: "#45B7D1", Katowice: "#FF6B9D" };
const STATUS_LABEL = { waiting: "Oczekiwanie", running: "Trwa quiz", paused: "☕ Przerwa", ended: "Zakończona" };
const STATUS_COLOR = { waiting: "#9B89CC", running: "#10D9A0", paused: "#F5C518", ended: "#E8376B" };

// ─── City picker ──────────────────────────────────────────────────────────────

function CityPicker({ city, setCity }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {CITIES.map((c) => (
        <button key={c.name} onClick={() => setCity(c.name)}
          style={{ ...C.btn("ghost"), background: city === c.name ? `${CITY_COLORS[c.name]}25` : undefined, borderColor: city === c.name ? `${CITY_COLORS[c.name]}55` : undefined, color: city === c.name ? "#EDE9FE" : "#9B89CC" }}>
          {c.name}
        </button>
      ))}
    </div>
  );
}

// ─── Tab: Pytania ─────────────────────────────────────────────────────────────

const EMPTY = { module: 1, q: "", opts: ["", "", "", ""], ans: 0, exp: "" };

function PytaniaTab({ city }) {
  const MODULES = useModules();
  const [isPractice, setIsPractice] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [mod, setMod] = useState(1);
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadQs = (practice = isPractice) => practice ? getPracticeQuestions(city) : getQuestions(city);
  useEffect(() => { loadQs().then(setQuestions); }, [city, isPractice]);
  const reload = () => loadQs().then(setQuestions);

  const openAdd  = () => { setForm({ ...EMPTY, module: mod }); setEditId(null); };
  const openEdit = (q) => { setForm({ module: q.module, q: q.q, opts: [...q.opts], ans: q.ans, exp: q.exp || "" }); setEditId(q.id); };

  const save = async () => {
    if (!form.q || form.opts.some((o) => !o)) return alert("Wypełnij pytanie i wszystkie odpowiedzi.");
    setSaving(true);
    editId ? await updateQuestion(editId, form) : await addQuestion({ ...form, city, createdBy: null, isPractice });
    setSaving(false); setForm(null); setEditId(null); reload();
  };

  const remove = async (id) => { if (!confirm("Usunąć pytanie?")) return; await deleteQuestion(id); reload(); };
  const filtered = questions.filter((q) => q.module === mod);

  return (
    <div>
      {/* Główne / Próbne toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => { setIsPractice(false); setForm(null); }} style={{ ...C.btn(!isPractice ? "primary" : "ghost", { fontSize: 13, padding: "8px 18px" }) }}>🏆 Pytania główne</button>
        <button onClick={() => { setIsPractice(true); setForm(null); }}  style={{ ...C.btn(isPractice  ? "success" : "ghost", { fontSize: 13, padding: "8px 18px" }) }}>🔬 Pytania próbne</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        {MODULES.map((m) => (
          <button key={m.id} onClick={() => setMod(m.id)} style={{ ...C.btn("ghost"), background: mod === m.id ? `${m.color}25` : undefined, borderColor: mod === m.id ? `${m.color}55` : undefined, color: mod === m.id ? "#EDE9FE" : "#9B89CC" }}>
            {m.icon} {m.name} <span style={{ marginLeft: 4, fontSize: 11, opacity: .7 }}>{questions.filter((q) => q.module === m.id).length}</span>
          </button>
        ))}
        <button onClick={openAdd} style={{ ...C.btn("primary"), marginLeft: "auto" }}>+ Dodaj pytanie</button>
      </div>

      {form && (
        <div style={{ ...C.card({ padding: "20px", marginBottom: 20, borderColor: "rgba(107,33,232,.3)", background: "rgba(107,33,232,.06)" }) }}>
          <p style={{ fontWeight: 700, color: "#C4B5FD", marginBottom: 14 }}>{editId ? "Edytuj pytanie" : "Nowe pytanie"}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <span style={C.lbl}>Moduł</span>
              <select value={form.module} onChange={(e) => setForm((p) => ({ ...p, module: +e.target.value }))} style={{ ...C.input(), width: "auto" }}>
                {MODULES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <span style={C.lbl}>Treść pytania</span>
              <textarea value={form.q} onChange={(e) => setForm((p) => ({ ...p, q: e.target.value }))} style={{ ...C.input(), minHeight: 70, resize: "vertical" }} />
            </div>
            <div>
              <span style={C.lbl}>Odpowiedzi (zaznacz poprawną)</span>
              {["A","B","C","D"].map((ltr, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input type="radio" name="ans" checked={form.ans === i} onChange={() => setForm((p) => ({ ...p, ans: i }))} style={{ accentColor: "#6B21E8" }} />
                  <span style={{ color: "#9B89CC", width: 16, fontSize: 13 }}>{ltr}</span>
                  <input value={form.opts[i]} onChange={(e) => { const o = [...form.opts]; o[i] = e.target.value; setForm((p) => ({ ...p, opts: o })); }} style={C.input({ flex: 1 })} placeholder={`Opcja ${ltr}`} />
                </div>
              ))}
            </div>
            <div>
              <span style={C.lbl}>Wyjaśnienie (opcjonalne)</span>
              <input value={form.exp} onChange={(e) => setForm((p) => ({ ...p, exp: e.target.value }))} style={C.input()} placeholder="Uzasadnienie poprawnej odpowiedzi…" />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setForm(null)} style={C.btn("ghost")}>Anuluj</button>
              <button onClick={save} style={C.btn("primary")} disabled={saving}>{saving ? "Zapisuję…" : "Zapisz"}</button>
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0
        ? <p style={{ color: "#9B89CC", textAlign: "center", padding: "32px 0" }}>Brak pytań w tym module.</p>
        : filtered.map((q, idx) => (
          <div key={q.id} style={{ ...C.card({ padding: "14px 16px", marginBottom: 10 }) }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ background: "rgba(107,33,232,.25)", borderRadius: 6, padding: "2px 7px", fontSize: 11, fontWeight: 700, color: "#C4B5FD", flexShrink: 0, marginTop: 2 }}>{idx + 1}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{q.q}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {q.opts.map((opt, i) => (
                    <span key={i} style={{ fontSize: 12, padding: "2px 10px", borderRadius: 20, background: i === q.ans ? "rgba(11,158,107,.2)" : "rgba(255,255,255,.05)", border: `1px solid ${i === q.ans ? "#0B9E6B" : "rgba(255,255,255,.08)"}`, color: i === q.ans ? "#10D9A0" : "#9B89CC" }}>
                      {["A","B","C","D"][i]}: {opt}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => openEdit(q)} style={C.btn("ghost", { padding: "5px 10px" })}>✏️</button>
                <button onClick={() => remove(q.id)} style={C.btn("danger", { padding: "5px 10px" })}>🗑️</button>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}

// ─── Tab: Kody ────────────────────────────────────────────────────────────────

function KodyTab({ city, adminId }) {
  const [codes, setCodes] = useState([]);
  const [form, setForm] = useState({ name: "", surname: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { getParticipantCodes(city).then(setCodes); }, [city]);
  const reload = () => getParticipantCodes(city).then(setCodes);

  const generate = async () => {
    if (!form.name.trim() || !form.surname.trim()) return setErr("Podaj imię i nazwisko.");
    setErr(""); setBusy(true);
    await generateParticipantCode({ name: form.name.trim(), surname: form.surname.trim(), city, createdBy: adminId });
    setBusy(false); setForm({ name: "", surname: "" }); reload();
  };

  const remove = async (id) => { if (!confirm("Usunąć kod?")) return; await deleteParticipantCode(id); reload(); };
  const unused = codes.filter((c) => !c.used);
  const used   = codes.filter((c) =>  c.used);

  return (
    <div>
      <div style={{ ...C.card({ padding: "18px", marginBottom: 20, borderColor: "rgba(107,33,232,.3)", background: "rgba(107,33,232,.06)" }) }}>
        <p style={{ fontWeight: 700, color: "#C4B5FD", marginBottom: 12 }}>Generuj kod dla uczestnika</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <span style={C.lbl}>Imię</span>
            <input value={form.name} onChange={(e) => { setForm((p) => ({ ...p, name: e.target.value })); setErr(""); }} style={C.input()} placeholder="Jan" onKeyDown={(e) => e.key === "Enter" && generate()} />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <span style={C.lbl}>Nazwisko</span>
            <input value={form.surname} onChange={(e) => { setForm((p) => ({ ...p, surname: e.target.value })); setErr(""); }} style={C.input()} placeholder="Kowalski" onKeyDown={(e) => e.key === "Enter" && generate()} />
          </div>
          <button onClick={generate} disabled={busy} style={{ ...C.btn("primary"), whiteSpace: "nowrap" }}>
            {busy ? "…" : "🎟️ Generuj"}
          </button>
        </div>
        {err && <p style={{ color: "#E8376B", fontSize: 13, marginTop: 8 }}>{err}</p>}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[["Wszystkie", codes.length, "#6B21E8"], ["Wolne", unused.length, "#10D9A0"], ["Użyte", used.length, "#F5C518"]].map(([l, v, col]) => (
          <div key={l} style={{ ...C.card({ padding: "12px 16px", flex: 1, textAlign: "center" }) }}>
            <p style={{ fontFamily: '"Bebas Neue"', fontSize: 26, color: col, lineHeight: 1 }}>{v}</p>
            <p style={{ fontSize: 11, color: "#9B89CC", marginTop: 3 }}>{l}</p>
          </div>
        ))}
      </div>

      {codes.length === 0
        ? <p style={{ color: "#9B89CC", textAlign: "center", padding: "24px 0" }}>Brak kodów dla {city}.</p>
        : codes.map((c) => (
          <div key={c.id} style={{ ...C.card({ padding: "10px 14px", marginBottom: 8 }), display: "flex", alignItems: "center", gap: 12, opacity: c.used ? .55 : 1 }}>
            <div style={{ background: c.used ? "rgba(155,137,204,.15)" : "rgba(107,33,232,.2)", border: `1px solid ${c.used ? "rgba(155,137,204,.3)" : "rgba(107,33,232,.4)"}`, borderRadius: 8, padding: "3px 12px", fontFamily: '"Bebas Neue"', fontSize: 17, letterSpacing: 2, color: c.used ? "#9B89CC" : "#C4B5FD", flexShrink: 0 }}>
              {c.code}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, fontSize: 14 }}>{c.name} {c.surname}</p>
              <p style={{ fontSize: 11, color: c.used ? "#10D9A0" : "#9B89CC", marginTop: 1 }}>{c.used ? "✓ Użyty" : "Oczekuje"}</p>
            </div>
            {!c.used && <button onClick={() => remove(c.id)} style={C.btn("danger", { padding: "4px 10px", fontSize: 12 })}>✕</button>}
          </div>
        ))}
    </div>
  );
}

// ─── Tab: Sesja ───────────────────────────────────────────────────────────────

function SesjaTab({ city, adminId, onPodium }) {
  const [session, setSession]           = useState(null);
  const [participants, setParticipants] = useState([]);
  const [results, setResults]           = useState([]);
  const [liveStats, setLiveStats]       = useState(null);
  const [violations, setViolations]     = useState([]);
  const [loading, setLoading]           = useState(true);
  const [isPractice, setIsPractice]     = useState(false);
  const [cityQuestions, setCityQuestions] = useState([]);
  const [showAdminStats, setShowAdminStats] = useState(false);
  const [liveExpanded, setLiveExpanded] = useState(false);
  const pollRef        = useRef(null);
  const sessionRef     = useRef(null); // always-current session for poll closures
  const pollVersionRef = useRef(0);    // incremented on every upd() to discard in-flight stale poll responses

  useEffect(() => { load(isPractice); return () => clearInterval(pollRef.current); }, [city, isPractice]);

  const load = async (practice = isPractice) => {
    setLoading(true);
    setResults([]); setLiveStats(null);
    const { data } = await getOrCreateSession(city, adminId, practice);
    setSession(data);
    sessionRef.current = data;
    if (data) {
      setParticipants(await getParticipantsInSession(city));
      if (data.status === "ended" || data.status === "results") setResults(await getSessionResults(data.id));
    }
    // Always load real questions — practice sessions also use real question IDs for answers
    const qs = await getQuestions(city);
    setCityQuestions(qs);
    setLoading(false);
  };

  const newQuiz = async () => {
    if (!confirm("Zresetować i przygotować nową sesję quizu?")) return;
    setLoading(true);
    await endAndResetSession(city, adminId, isPractice);
    await load(isPractice);
  };

  // Poll participants every 4s during waiting; live stats + participants every 3s during running/paused.
  // During running: also refresh session from DB so current_question_idx stays current.
  useEffect(() => {
    clearInterval(pollRef.current);
    if (session?.status === "waiting") {
      pollRef.current = setInterval(async () => {
        setParticipants(await getParticipantsInSession(city));
      }, 4000);
    } else if (session?.status === "running" || session?.status === "paused") {
      pollRef.current = setInterval(async () => {
        const myVersion = pollVersionRef.current; // snapshot before async call
        const sid = sessionRef.current?.id;
        if (!sid) return;
        const fresh = await getSessionById(sid);
        // Discard if upd() was called while this fetch was in-flight — prevents stale "running"
        // response from reverting a just-written "paused" status in local state.
        if (pollVersionRef.current !== myVersion) return;
        if (fresh) { setSession(fresh); sessionRef.current = fresh; }
        const s = sessionRef.current;
        const q = cityQuestions[s?.current_question_idx ?? 0];
        const [stats, parts, viols] = await Promise.all([
          q && s?.id && s.status === "running" ? getLiveQuestionStats(s.id, q.id) : Promise.resolve(null),
          getParticipantsInSession(city),
          s?.id ? getViolationsForSession(s.id) : Promise.resolve([]),
        ]);
        if (stats) setLiveStats(stats);
        setParticipants(parts);
        setViolations(viols);
      }, 3000);
    }
    return () => clearInterval(pollRef.current);
  }, [session?.status, cityQuestions]);

  const upd = async (updates) => {
    if (!session) return;
    // Increment version + clear interval: any in-flight poll will see version mismatch and discard itself
    pollVersionRef.current++;
    clearInterval(pollRef.current);
    const { error } = await updateSession(session.id, updates);
    if (error) { alert("Błąd aktualizacji sesji: " + error); return; }
    setSession((s) => { const next = { ...s, ...updates }; sessionRef.current = next; return next; });
    if (updates.status === "ended" || updates.status === "results") {
      setResults(await getSessionResults(session.id));
      setLiveStats(null);
    }
  };

  if (loading) return <p style={{ color: "#9B89CC", textAlign: "center", padding: 32 }}>Ładowanie…</p>;

  return (
    <div>
      {/* Mode switcher */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setIsPractice(false)} style={{ ...C.btn(isPractice ? "ghost" : "primary", { fontSize: 12, padding: "8px 16px" }) }}>🏆 Właściwy quiz</button>
        <button onClick={() => setIsPractice(true)}  style={{ ...C.btn(isPractice ? "success" : "ghost", { fontSize: 12, padding: "8px 16px" }) }}>🔬 Próbny test</button>
      </div>

      <div style={{ ...C.card({ padding: "20px", marginBottom: 20, borderColor: isPractice ? "rgba(16,217,160,.3)" : `${STATUS_COLOR[session?.status || "waiting"]}30`, background: isPractice ? "rgba(16,217,160,.06)" : `${STATUS_COLOR[session?.status || "waiting"]}08` }) }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: 11, color: isPractice ? "#10D9A0" : "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
              {isPractice ? "🔬 PRÓBNY TEST" : "Sesja"} — {city}
            </p>
            <p style={{ fontFamily: '"Bebas Neue"', fontSize: 28, color: STATUS_COLOR[session?.status || "waiting"], letterSpacing: 1, marginTop: 2 }}>
              {STATUS_LABEL[session?.status || "waiting"]}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontFamily: '"Bebas Neue"', fontSize: 36, color: "#EDE9FE", lineHeight: 1 }}>{participants.length}</p>
            <p style={{ fontSize: 11, color: "#9B89CC" }}>w lobby</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {session?.status === "waiting" && (
            <button style={C.btn("success", { flex: 1 })} onClick={async () => {
              const { startedAt, error } = await startQuizSession(session.id);
              if (!startedAt) return alert(error || "Błąd startu — spróbuj ponownie.");
              setSession((s) => ({ ...s, status: "running", q_started_at: startedAt, current_question_idx: 0 }));
            }}>▶ Start quizu</button>
          )}
          {session?.status === "running" && <>
            <button style={C.btn("pause", { flex: 1 })} onClick={() => upd({ status: "paused" })}>⏸ Pauza</button>
            <button style={C.btn("danger")} onClick={() => { if (confirm("Zakończyć quiz?")) upd({ status: "ended" }); }}>⏹ Zakończ</button>
          </>}
          {session?.status === "paused" && <>
            <button style={C.btn("success", { flex: 1 })} onClick={() => upd({ status: "running" })}>▶ Wznów quiz</button>
            <button style={C.btn("gold", { flex: 1 })} onClick={() => { if (confirm("Ogłosić wyniki teraz? Uczestnicy zobaczą ranking.")) upd({ status: "results" }); }}>
              🏆 Ogłoś wyniki
            </button>
            <button style={C.btn("danger")} onClick={() => { if (confirm("Zakończyć quiz?")) upd({ status: "ended" }); }}>⏹ Zakończ</button>
          </>}
          {session?.status === "results" && <>
            <button style={C.btn("ghost", { flex: 1 })} onClick={load}>🔄 Odśwież wyniki</button>
            <button style={C.btn("primary", { flex: 1 })} onClick={newQuiz}>➕ Nowy quiz</button>
          </>}
          {session?.status === "ended" && <>
            <button style={C.btn("ghost", { flex: 1 })} onClick={load}>🔄 Odśwież wyniki</button>
            <button style={C.btn("primary", { flex: 1 })} onClick={newQuiz}>➕ Nowy quiz</button>
          </>}
        </div>
      </div>

      {/* Stats toggle — shown whenever quiz is running, hidden by default */}
      {session?.status === "running" && (
        <div style={{ marginBottom: showAdminStats ? 0 : 20 }}>
          <button onClick={() => setShowAdminStats((v) => !v)}
            style={{ ...C.btn("ghost", { width: "100%", fontSize: 12, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }) }}>
            <span>📊 Postęp odpowiedzi — bieżące pytanie <span style={{ color: "#F5C518", fontSize: 10 }}>🔒 Tylko admin</span></span>
            <span style={{ color: "#9B89CC", fontSize: 14 }}>{showAdminStats ? "▲" : "▼"}</span>
          </button>
          {showAdminStats && (
            <div style={{ ...C.card({ padding: "16px 20px", marginTop: 4, marginBottom: 20, borderColor: "rgba(16,217,160,.25)", background: "rgba(16,217,160,.06)" }) }}>
              {liveStats ? (
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontFamily: '"Bebas Neue"', fontSize: 36, color: "#EDE9FE", lineHeight: 1 }}>{liveStats.total}</p>
                    <p style={{ fontSize: 11, color: "#9B89CC" }}>Odpowiedziało</p>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 10, background: "rgba(255,255,255,.1)", borderRadius: 5, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "linear-gradient(90deg,#10D9A0,#6B21E8)", width: liveStats.total ? `${(liveStats.correct / liveStats.total) * 100}%` : "0%", transition: "width .5s" }} />
                    </div>
                    <p style={{ fontSize: 11, color: "#9B89CC", marginTop: 5 }}>
                      {liveStats.total ? Math.round((liveStats.correct / liveStats.total) * 100) : 0}% poprawnych · {liveStats.correct} dobrze · {liveStats.total - liveStats.correct} źle
                    </p>
                  </div>
                </div>
              ) : (
                <p style={{ color: "#9B89CC", fontSize: 13, textAlign: "center" }}>Ładowanie statystyk…</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Anti-cheat violations */}
      {violations.length > 0 && (
        <div style={{ ...C.card({ padding: "14px 18px", marginBottom: 20, borderColor: "rgba(232,55,107,.3)", background: "rgba(232,55,107,.06)" }) }}>
          <p style={{ fontSize: 11, color: "#E8376B", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>⚠️ Naruszenia regulaminu ({violations.length})</p>
          {violations.slice(0, 5).map((v, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderTop: i ? "1px solid rgba(255,255,255,.05)" : "none" }}>
              <span style={{ fontSize: 13 }}>{v.type === "tab_switch" ? "🔀" : "📸"}</span>
              <span style={{ fontFamily: '"Bebas Neue"', fontSize: 13, color: "#9B89CC", letterSpacing: 1 }}>{v.participant_code || v.participantCode}</span>
              <span style={{ fontSize: 12, color: "#E8376B", flex: 1 }}>{v.type === "tab_switch" ? "Zmiana zakładki" : "Próba screenshota"}</span>
              <span style={{ fontSize: 11, color: "#9B89CC" }}>×{v.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Live ghost view — auto-shown when quiz is running, expandable to fullscreen */}
      {session?.status === "running" && !isPractice && (
        <div style={liveExpanded ? {
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          width: "100%", height: "100%",
          zIndex: 2000, background: "#070215", overflow: "auto", padding: "20px",
          fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE",
        } : {
          ...C.card({ marginBottom: 20, padding: "16px 20px", borderColor: "rgba(232,55,107,.25)", background: "rgba(232,55,107,.04)" }),
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: "#E8376B", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>🔴 Live — widok pytania (jak uczestnik)</p>
            <button onClick={() => setLiveExpanded((v) => !v)}
              style={{ ...C.btn("ghost", { fontSize: 12, padding: "5px 12px" }) }}>
              {liveExpanded ? "✕ Zwiń" : "⤢ Pełny ekran"}
            </button>
          </div>
          <LiveTab city={city} autoStart />
        </div>
      )}

      {participants.length > 0 && session?.status !== "ended" && (
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Kody aktywowane ({participants.length})</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 8 }}>
            {participants.map((p) => (
              <div key={p.id} style={{ ...C.card({ padding: "10px 12px" }), display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(107,33,232,.25)", border: "1px solid rgba(107,33,232,.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#C4B5FD", flexShrink: 0 }}>
                  {p.name?.[0]}{p.surname?.[0]}
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600 }}>{p.name} {p.surname}</p>
                  <p style={{ fontSize: 10, color: "#9B89CC" }}>{p.code}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {session?.status === "ended" && results.length > 0 && (
        <div>
          <p style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Wyniki końcowe</p>
          <p style={{ fontSize: 11, color: "rgba(155,137,204,.6)", marginBottom: 12 }}>Przy równej liczbie punktów decyduje krótszy średni czas odpowiedzi.</p>
          {onPodium && (
            <button style={{ ...C.btn("gold", { width: "100%", marginBottom: 16 }) }} onClick={() => onPodium(results)}>
              🏆 Pokaż podium ceremonię
            </button>
          )}
          {results.map((r, i) => (
            <div key={r.code} style={{ ...C.card({ padding: "12px 16px", marginBottom: 8 }), display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: '"Bebas Neue"', fontSize: 22, color: i === 0 ? "#F5C518" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "#9B89CC", width: 28, textAlign: "center" }}>{i + 1}</span>
              <p style={{ flex: 1, fontWeight: 600 }}>{r.name}</p>
              <div style={{ textAlign: "right", marginRight: 8 }}>
                <p style={{ fontFamily: '"Bebas Neue"', fontSize: 22, color: "#F5C518" }}>{r.points} pkt</p>
                <p style={{ fontSize: 10, color: r.avgResponseTime != null ? "#9B89CC" : "rgba(155,137,204,.3)" }}>
                  ⏱ {r.avgResponseTime != null ? `${r.avgResponseTime}s` : "—"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Ustawienia ─────────────────────────────────────────────────────────

function UstawieniaTab({ city }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [uploading, setUploading]   = useState(false);
  const [status, setStatus]         = useState(""); // "", "uploading", "ok", "error"
  const fileRef = useRef(null);

  useEffect(() => {
    setPreviewUrl(null); setStatus("");
    getCityBg(city).then((bg) => {
      const match = bg?.match(/url\(["']?([^"')]+)["']?\)/);
      if (match) setPreviewUrl(match[1]);
    });
  }, [city]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setStatus("error:Plik musi być obrazem (PNG, JPG, WEBP).");
    if (file.size > 5 * 1024 * 1024) return setStatus("error:Plik za duży — max 5 MB.");

    setUploading(true); setStatus("uploading");
    const { url, error } = await uploadCityBg(city, file);
    if (error) { setUploading(false); setStatus("error:" + error); return; }

    // Overlay ciemny + obraz — tekst zawsze czytelny
    const bgCss = `linear-gradient(rgba(7,2,21,.72),rgba(14,4,53,.72)), url("${url}") center/cover no-repeat fixed`;
    const { error: bgErr } = await setCityBg(city, bgCss);
    if (bgErr) { setUploading(false); setStatus("error:Błąd zapisu tła do bazy: " + bgErr); return; }
    document.documentElement.style.setProperty("--fue-bg", bgCss);
    setPreviewUrl(url);
    setUploading(false); setStatus("ok");
    setTimeout(() => setStatus(""), 3000);
    e.target.value = "";
  };

  const handleReset = async () => {
    await setCityBg(city, DEFAULT_BG);
    document.documentElement.style.setProperty("--fue-bg", DEFAULT_BG);
    setPreviewUrl(null); setStatus("ok");
    setTimeout(() => setStatus(""), 2000);
  };

  const isError = status.startsWith("error:");
  const errMsg  = isError ? status.slice(6) : "";

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontWeight: 700, fontSize: 16 }}>
          Tło dla: <span style={{ color: CITY_COLORS[city] }}>{city}</span>
        </p>
        <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 4 }}>
          Wgraj plik graficzny — zostanie ustawiony jako tło quizu dla uczestników z {city}.
        </p>
      </div>

      {/* Aktualne tło */}
      {previewUrl && (
        <div style={{ ...C.card({ padding: 0, overflow: "hidden", marginBottom: 20 }), position: "relative" }}>
          <img src={previewUrl} alt="Aktualne tło" style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }} />
          <div style={{ position: "absolute", inset: 0, background: "rgba(7,2,21,.65)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px" }}>
            <span style={{ fontSize: 13, color: "#EDE9FE", fontWeight: 600 }}>✓ Aktualne tło — {city}</span>
            <button onClick={handleReset} style={{ ...C.btn("danger", { padding: "7px 14px", fontSize: 12, width: "auto" }) }}>
              ✕ Usuń (przywróć domyślne)
            </button>
          </div>
        </div>
      )}

      {/* Upload area */}
      <div onClick={() => !uploading && fileRef.current?.click()}
        style={{ ...C.card({ padding: "36px 20px", borderColor: uploading ? "rgba(107,33,232,.5)" : "rgba(255,255,255,.15)", background: uploading ? "rgba(107,33,232,.08)" : "rgba(255,255,255,.03)", textAlign: "center", cursor: uploading ? "wait" : "pointer", transition: "all .2s" }) }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>{uploading ? "⏳" : "📁"}</div>
        <p style={{ fontWeight: 600, fontSize: 14, color: "#EDE9FE" }}>
          {uploading ? "Wgrywanie…" : "Kliknij aby wybrać plik"}
        </p>
        <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 6 }}>PNG, JPG, WEBP — max 5 MB</p>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleFile} style={{ display: "none" }} />

      {/* Status */}
      {status === "ok" && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(11,158,107,.15)", border: "1px solid rgba(11,158,107,.35)", borderRadius: 10, fontSize: 13, color: "#10D9A0" }}>
          ✓ Tło zapisane — uczestnicy {city} zobaczą je po dołączeniu do quizu.
        </div>
      )}
      {isError && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(232,55,107,.12)", border: "1px solid rgba(232,55,107,.3)", borderRadius: 10, fontSize: 13, color: "#E8376B" }}>
          ⚠️ {errMsg}
        </div>
      )}

      <div style={{ ...C.card({ padding: "12px 16px", borderColor: "rgba(107,33,232,.2)", background: "rgba(107,33,232,.04)", marginTop: 16 }) }}>
        <p style={{ fontSize: 12, color: "#9B89CC" }}>
          📐 Zalecana rozdzielczość: <strong style={{ color: "#EDE9FE" }}>1920 × 1080 px</strong> (format 16:9). Obraz zostanie przyciemniony — tekst quizu pozostaje czytelny.
        </p>
      </div>
    </div>
  );
}

// ─── Tab: Live Quiz View (widok duchy) ───────────────────────────────────────

const LIVE_COLORS = ["#C2185B", "#1565C0", "#2E7D32", "#E65100"];
const LIVE_LABELS = ["A", "B", "C", "D"];

function LiveTab({ city, autoStart = false }) {
  const MODULES = useModules();
  const [questions, setQuestions]   = useState([]);
  const [session, setSession]       = useState(null);
  const [phase, setPhase]           = useState("idle");    // idle|loading|quiz|reveal|done
  const [gIdx, setGIdx]             = useState(0);          // global question index
  const [timer, setTimer]           = useState(0);
  const [revealData, setRevealData] = useState([]);
  const [autoSec, setAutoSec]       = useState(8);
  const [liveCount, setLiveCount]   = useState(0);
  const timerRef     = useRef(null);
  const revealRef    = useRef(null);
  const liveRef      = useRef(null);
  const sessionRef   = useRef(null); // always-current session (avoids stale closure in timer)
  const gIdxRef      = useRef(0);    // always-current gIdx (avoids stale closure in intervals)
  const questionsRef = useRef([]);   // always-current questions array
  const autoStarted  = useRef(false);

  useEffect(() => {
    Promise.all([
      getOrCreateSession(city, null, false),
      import("../lib/supabase.js").then(({ getQuestions: gq }) => gq(city)),
    ]).then(([{ data: sess }, dbQs]) => {
      setSession(sess);
      sessionRef.current = sess;
      setQuestions(dbQs);
      questionsRef.current = dbQs;
    });
  }, [city]);

  // Keep refs in sync so closures inside intervals always see current values
  useEffect(() => { gIdxRef.current = gIdx; }, [gIdx]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

  // Auto-start live view when embedded in SesjaTab (autoStart prop) and data is ready
  useEffect(() => {
    if (!autoStart || autoStarted.current || phase !== "idle" || !questions.length || !session) return;
    if (session.status === "running") {
      autoStarted.current = true;
      startLive();
    }
  }, [autoStart, phase, questions.length, session?.status]);

  const currentQ = questions[gIdx];
  const mod      = MODULES.find((m) => m.id === currentQ?.module);

  // Start live view — load fresh session + questions then sync timer
  const startLive = async () => {
    setPhase("loading");

    // Fetch fresh data in parallel
    const [{ data: freshSession }, freshQs] = await Promise.all([
      getOrCreateSession(city, null, false),
      import("../lib/supabase.js").then(({ getQuestions: gq }) => gq(city)),
    ]);

    setSession(freshSession);
    sessionRef.current = freshSession;
    if (freshQs.length > 0) setQuestions(freshQs);

    const qs = freshQs.length > 0 ? freshQs : questions;
    const startIdx = Math.min(freshSession?.current_question_idx || 0, qs.length - 1);
    const q        = qs[startIdx];
    const qMod     = MODULES.find((m) => m.id === q?.module);
    const timePerQ = qMod?.timePerQ || 60;

    let startTimer = timePerQ;
    if (freshSession?.q_started_at) {
      const elapsedSec = Math.floor((Date.now() - new Date(freshSession.q_started_at).getTime()) / 1000);
      startTimer = Math.max(1, timePerQ - elapsedSec);
    }

    setGIdx(startIdx);
    setTimer(startTimer);
    setRevealData([]); setAutoSec(8);
    setPhase("quiz");
  };

  // Timer effect — derived from q_started_at so it stays in sync with participants
  useEffect(() => {
    if (phase !== "quiz" || !mod || !currentQ) return;
    clearInterval(timerRef.current);
    const modTimePerQ = mod.timePerQ; // capture from render (fresh per gIdx change)
    timerRef.current = setInterval(() => {
      const sess = sessionRef.current;
      if (!sess?.q_started_at) {
        // Fallback countdown if no q_started_at yet
        setTimer((t) => {
          if (t <= 1) { clearInterval(timerRef.current); doReveal(); return 0; }
          return t - 1;
        });
        return;
      }
      const elapsed   = Math.floor((Date.now() - new Date(sess.q_started_at).getTime()) / 1000);
      const remaining = Math.max(0, modTimePerQ - elapsed);
      setTimer(remaining);
      if (remaining <= 0) { clearInterval(timerRef.current); doReveal(); }
    }, 1000);
    // Poll live answers count — use refs to avoid stale closure
    liveRef.current = setInterval(async () => {
      const q = questionsRef.current[gIdxRef.current];
      if (sessionRef.current?.id && q?.id) {
        const stats = await getLiveQuestionStats(sessionRef.current.id, q.id);
        setLiveCount(stats.total);
      }
    }, 2000);
    return () => { clearInterval(timerRef.current); clearInterval(liveRef.current); };
  }, [gIdx, phase]);

  const doReveal = async () => {
    setPhase("reveal"); setAutoSec(5); clearInterval(liveRef.current);
    // Capture current index now; delay fetch 2s so participants finish submitting to DB
    const capturedGIdx = gIdxRef.current;
    setTimeout(async () => {
      const q = questionsRef.current[capturedGIdx];
      if (sessionRef.current?.id && q?.id) {
        const stats = await getLiveQuestionStats(sessionRef.current.id, q.id);
        setRevealData(stats.answers || []);
      }
    }, 2000);
    let cd = 5;
    clearInterval(revealRef.current);
    revealRef.current = setInterval(() => {
      cd--;
      setAutoSec(cd);
      if (cd <= 0) {
        clearInterval(revealRef.current);
        skipReveal();
      }
    }, 1000);
  };

  const skipReveal = async () => {
    clearInterval(revealRef.current);
    const currentGIdx = gIdxRef.current;
    const qs = questionsRef.current;
    if (currentGIdx + 1 >= qs.length) { setPhase("done"); return; }
    // Poll DB until participants actually advance current_question_idx.
    // Without polling we'd fetch q_started_at from the old question (≥60s elapsed)
    // which makes initialTimer = max(1, 60-62) = 1 → immediate doReveal → cascade.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const { data: s } = await getOrCreateSession(city, null, false);
      if (!s || s.status !== "running") { setPhase("done"); return; }
      if (s.current_question_idx > currentGIdx) {
        setSession(s); sessionRef.current = s;
        const nextQ   = qs[s.current_question_idx];
        if (!nextQ) { setPhase("done"); return; }
        const nextMod = MODULES.find((m) => m.id === nextQ.module);
        const timePerQ = nextMod?.timePerQ || 60;
        const elapsed  = Math.floor((Date.now() - new Date(s.q_started_at).getTime()) / 1000);
        setTimer(Math.max(0, timePerQ - elapsed));
        setGIdx(s.current_question_idx);
        setPhase("quiz"); setRevealData([]); setLiveCount(0);
        return;
      }
    }
    setPhase("done");
  };

  const correct   = revealData.filter((a) => a.isCorrect);
  const incorrect = revealData.filter((a) => !a.isCorrect);
  const timePerQ  = mod?.timePerQ || 60;
  const timedAnswers = revealData.filter((a) => a.responseTime != null);
  const avgTimeSec   = timedAnswers.length ? Math.round(timedAnswers.reduce((s, a) => s + a.responseTime, 0) / timedAnswers.length) : null;
  const timerPct  = timer / (mod?.timePerQ || 60);
  const tColor    = timerPct > .5 ? "#10D9A0" : timerPct > .25 ? "#FF9A3C" : "#E8376B";

  if (phase === "loading") return (
    <div style={{ textAlign: "center", padding: "48px 0", color: "#9B89CC" }}>
      <div className="spinner" style={{ width: 32, height: 32, border: "3px solid rgba(107,33,232,.2)", borderTop: "3px solid #6B21E8", borderRadius: "50%", margin: "0 auto 16px" }} />
      <p>Synchronizuję z sesją…</p>
    </div>
  );

  if (phase === "idle") return (
    <div style={{ textAlign: "center", padding: "48px 0" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>👁️</div>
      <p style={{ color: "#9B89CC", marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
        Widok duchy — obserwujesz quiz jak uczestnik, bez możliwości odpowiadania.<br />
        Po każdym pytaniu widzisz pełną tabelę odpowiedzi z kodami i wynikami.
      </p>
      <button onClick={startLive} style={{ ...C.btn("primary", { width: "auto", padding: "12px 32px" }) }}>▶ Start podglądu live</button>
    </div>
  );

  if (phase === "done") return (
    <div style={{ textAlign: "center", padding: "48px 0" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
      <p style={{ color: "#9B89CC", marginBottom: 24 }}>Wszystkie pytania zostały wyświetlone.</p>
      <button onClick={() => { setPhase("idle"); setGIdx(0); }} style={C.btn("ghost", { width: "auto" })}>↩ Reset</button>
    </div>
  );

  return (
    <div>
      {/* Header info */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ background: "#E8376B", borderRadius: 20, padding: "3px 12px", fontSize: 11, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "pulse 1s infinite" }} />
          LIVE
        </div>
        <span style={{ fontSize: 13, color: "#9B89CC" }}>
          {mod?.icon} {mod?.name} · Pytanie {gIdx + 1}/{questions.length}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#9B89CC" }}>
          {liveCount} odpowiedzi live
        </span>
      </div>

      {/* Quiz view (ghost) */}
      {phase === "quiz" && currentQ && (
        <div style={{ ...C.card({ padding: "20px" }), marginBottom: 16 }}>
          {/* Timer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <p style={{ fontWeight: 700, fontSize: 15, flex: 1, lineHeight: 1.5 }}>{currentQ.q}</p>
            <div style={{ width: 52, height: 52, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 16 }}>
              <svg width="52" height="52" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
                <circle cx="26" cy="26" r="20" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="4"/>
                <circle cx="26" cy="26" r="20" fill="none" stroke={tColor} strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={125.6} strokeDashoffset={125.6 * (1 - timerPct)} style={{ transition: "stroke-dashoffset .95s linear" }}/>
              </svg>
              <span style={{ fontFamily: '"Bebas Neue"', fontSize: 20, color: tColor }}>{timer}</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {currentQ.opts.map((opt, i) => (
              <div key={i} style={{ background: LIVE_COLORS[i], borderRadius: 10, padding: "12px 14px", opacity: .85, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 24, height: 24, borderRadius: 6, background: "rgba(0,0,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{LIVE_LABELS[i]}</span>
                <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{opt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reveal — pełna tabela */}
      {phase === "reveal" && currentQ && (
        <>
          <div style={{ ...C.card({ padding: "16px 20px", marginBottom: 16, borderColor: "rgba(107,33,232,.3)", background: "rgba(107,33,232,.06)" }) }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <p style={{ fontWeight: 700, fontSize: 14 }}>{currentQ.q}</p>
              <div style={{ background: "#0B9E6B22", border: "1px solid #0B9E6B44", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#10D9A0" }}>
                ✓ {["A","B","C","D"][currentQ.ans]}: {currentQ.opts[currentQ.ans]}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {[["Odpowiedzi", revealData.length, "#EDE9FE"], ["✅", correct.length, "#10D9A0"], ["❌", incorrect.length, "#E8376B"], ["⌀ czas", avgTimeSec != null ? `${avgTimeSec}s` : "—", "#F5C518"]].map(([l, v, c]) => (
                <div key={l} style={{ flex: 1, textAlign: "center" }}>
                  <p style={{ fontFamily: '"Bebas Neue"', fontSize: 26, color: c, lineHeight: 1 }}>{v}</p>
                  <p style={{ fontSize: 10, color: "#9B89CC" }}>{l}</p>
                </div>
              ))}
              <button onClick={skipReveal} style={{ ...C.btn("ghost", { fontSize: 12, padding: "6px 14px", whiteSpace: "nowrap", alignSelf: "center" }) }}>
                Następne → ({autoSec}s)
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 400, overflowY: "auto" }}>
            {revealData.sort((a, b) => b.points - a.points).map((a, i) => (
              <div key={a.code} style={{ ...C.card({ padding: "8px 14px" }), display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>{a.isCorrect ? "✅" : "❌"}</span>
                <span style={{ fontFamily: '"Bebas Neue"', fontSize: 13, color: "#9B89CC", letterSpacing: 1, minWidth: 80 }}>{a.code}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{a.name}</span>
                {a.responseTime != null && (
                  <span style={{ fontSize: 11, color: "#9B89CC", minWidth: 32, textAlign: "right" }}>{a.responseTime}s</span>
                )}
                <span style={{ fontFamily: '"Bebas Neue"', fontSize: 16, color: a.isCorrect ? "#F5C518" : "#E8376B" }}>{a.points} pkt</span>
              </div>
            ))}
            {revealData.length === 0 && <p style={{ color: "#9B89CC", textAlign: "center", padding: 16 }}>Brak odpowiedzi zarejestrowanych w bazie.</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab: Moduły ─────────────────────────────────────────────────────────────

const EMPTY_MOD = { id: "", name: "", icon: "📚", color: "#6B21E8", timePerQ: 60, desc: "" };

function ModulyTab() {
  const ctxModules = useModules();
  const [list, setList]       = useState(ctxModules);
  const [form, setForm]       = useState(null);
  const [editId, setEditId]   = useState(null);
  const [saving, setSaving]   = useState(false);

  useEffect(() => { getModules().then((m) => setList(m)); }, []);

  const reload = () => getModules().then((m) => setList(m));

  const openAdd  = () => { setForm({ ...EMPTY_MOD }); setEditId(null); };
  const openEdit = (m) => { setForm({ id: m.id, name: m.name, icon: m.icon, color: m.color, timePerQ: m.timePerQ, desc: m.desc || "" }); setEditId(m.id); };

  const save = async () => {
    if (!form.name.trim() || !form.id) return alert("Podaj ID (liczbę) i nazwę modułu.");
    setSaving(true);
    if (editId) {
      await updateModule(editId, { name: form.name, icon: form.icon, color: form.color, time_per_q: form.timePerQ, description: form.desc });
    } else {
      await addModule(form);
    }
    setSaving(false); setForm(null); setEditId(null); reload();
  };

  const remove = async (id) => {
    if (!confirm("Usunąć moduł? Pytania powiązane z tym ID modułu stracą przypisanie.")) return;
    await deleteModule(id); reload();
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
        <div>
          <p style={{ fontWeight: 700, fontSize: 15 }}>Moduły quizu</p>
          <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 3, lineHeight: 1.5 }}>
            Zdefiniuj moduły tematyczne — każdy ma własny czas na pytanie i motyw kolorystyczny.
          </p>
        </div>
        <button onClick={openAdd} style={{ ...C.btn("primary"), whiteSpace: "nowrap", flexShrink: 0 }}>+ Nowy moduł</button>
      </div>

      {form && (
        <div style={{ ...C.card({ padding: "20px", marginBottom: 20, borderColor: "rgba(107,33,232,.3)", background: "rgba(107,33,232,.06)" }) }}>
          <p style={{ fontWeight: 700, color: "#C4B5FD", marginBottom: 14 }}>{editId ? "Edytuj moduł" : "Nowy moduł"}</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <span style={C.lbl}>ID (liczba)</span>
              <input type="number" value={form.id} onChange={(e) => setForm((p) => ({ ...p, id: +e.target.value }))}
                style={C.input()} placeholder="5" disabled={!!editId} min="1" />
            </div>
            <div>
              <span style={C.lbl}>Ikona (emoji)</span>
              <input value={form.icon} onChange={(e) => setForm((p) => ({ ...p, icon: e.target.value }))}
                style={C.input()} placeholder="📚" />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <span style={C.lbl}>Nazwa modułu</span>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                style={C.input()} placeholder="np. Aktualności gospodarcze" />
            </div>
            <div>
              <span style={C.lbl}>Kolor</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                  style={{ width: 42, height: 38, borderRadius: 8, border: "1px solid rgba(255,255,255,.1)", background: "none", cursor: "pointer", padding: 2 }} />
                <input value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                  style={C.input({ flex: 1 })} placeholder="#6B21E8" />
              </div>
            </div>
            <div>
              <span style={C.lbl}>Czas na pytanie (s)</span>
              <input type="number" value={form.timePerQ} onChange={(e) => setForm((p) => ({ ...p, timePerQ: +e.target.value }))}
                style={C.input()} placeholder="60" min="5" max="300" />
            </div>
            <div style={{ gridColumn: "1/-1" }}>
              <span style={C.lbl}>Opis (opcjonalny)</span>
              <input value={form.desc} onChange={(e) => setForm((p) => ({ ...p, desc: e.target.value }))}
                style={C.input()} placeholder="Krótki opis modułu widoczny przed startem" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button onClick={() => setForm(null)} style={C.btn("ghost")}>Anuluj</button>
            <button onClick={save} style={C.btn("primary")} disabled={saving}>{saving ? "Zapisuję…" : "Zapisz"}</button>
          </div>
        </div>
      )}

      {list.length === 0
        ? <p style={{ color: "#9B89CC", textAlign: "center", padding: "32px 0" }}>Brak zdefiniowanych modułów.</p>
        : list.map((m) => (
          <div key={m.id} style={{ ...C.card({ padding: "14px 18px", marginBottom: 10, borderColor: `${m.color}28`, background: `${m.color}08` }), display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: `${m.color}20`, border: `1px solid ${m.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
              {m.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <p style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</p>
                <span style={{ background: `${m.color}20`, border: `1px solid ${m.color}35`, borderRadius: 20, padding: "1px 8px", fontSize: 10, fontWeight: 700, color: m.color }}>ID {m.id}</span>
              </div>
              <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 3 }}>{m.timePerQ}s / pytanie{m.desc ? ` · ${m.desc}` : ""}</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => openEdit(m)} style={C.btn("ghost", { padding: "5px 10px" })}>✏️</button>
              <button onClick={() => remove(m.id)} style={C.btn("danger", { padding: "5px 10px" })}>🗑️</button>
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "pytania",    label: "📝 Pytania"    },
  { id: "kody",       label: "🎟️ Kody"      },
  { id: "sesja",      label: "🎮 Sesja"     },
  { id: "moduly",     label: "🧩 Moduły"    },
  { id: "ustawienia", label: "⚙️ Ustawienia" },
];

export default function AdminPanel({ admin, isDesktop, onLogout, onPodium }) {
  const isSuperadmin = admin?.role === "superadmin";
  const [city, setCity]  = useState(admin?.city || "Kraków");
  const [tab, setTab]    = useState("sesja");

  // Update city when admin profile loads (async from Supabase)
  useEffect(() => {
    if (admin?.city) setCity(admin.city);
  }, [admin?.city]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE", display: "flex", flexDirection: "column" }}>

      <div style={{ background: "rgba(0,0,0,.4)", borderBottom: "1px solid rgba(255,255,255,.07)", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 11, color: "#9B89CC", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{isSuperadmin ? "⭐ Superadmin" : "👤 Admin — " + (admin?.city || "")}</p>
          <p style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>{admin?.full_name || admin?.email || "Administrator"}</p>
        </div>
        <button onClick={onLogout} style={{ ...C.btn("ghost"), padding: "8px 14px", fontSize: 12 }}>Wyloguj →</button>
      </div>

      {isSuperadmin && (
        <div style={{ padding: "14px 24px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(0,0,0,.2)" }}>
          <CityPicker city={city} setCity={setCity} />
        </div>
      )}

      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(0,0,0,.15)", overflowX: "auto" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`fue-tab${tab === t.id ? " active" : ""}`}
            style={{ whiteSpace: "nowrap", fontSize: 13, padding: "14px 20px" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: isDesktop ? "28px 40px" : "20px 16px", maxWidth: 900, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {tab === "pytania"    && <PytaniaTab city={city} />}
        {tab === "kody"       && <KodyTab    city={city} adminId={admin?.id} />}
        {/* BUG 3 FIX: SesjaTab pozostaje zamontowany przez cały czas pobytu na AdminPanel
            (używamy display:none zamiast conditional render). Dzięki temu:
            - getOrCreateSession nie jest wywoływane na nowo przy każdym powrocie do zakładki
            - pollRef i kanały Realtime nie są resetowane
            - stan sesji (session, liveStats) nie gubi się przy przełączeniu zakładki */}
        <div style={{ display: tab === "sesja" ? "block" : "none" }}>
          <SesjaTab city={city} adminId={admin?.id} onPodium={onPodium} />
        </div>
        {tab === "moduly"     && <ModulyTab />}
        {tab === "ustawienia" && <UstawieniaTab city={city} />}
      </div>
    </div>
  );
}
