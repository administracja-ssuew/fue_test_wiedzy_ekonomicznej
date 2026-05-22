import { useState, useEffect } from "react";
import {
  getQuestions, addQuestion, updateQuestion, deleteQuestion,
  getParticipantCodes, generateParticipantCode, deleteParticipantCode,
  getOrCreateSession, updateSession, getParticipantsInSession, getSessionResults,
} from "../lib/supabase.js";
import { CITIES, MODULES } from "../data/questions.js";

const C = {
  bg:    "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)",
  card:  (x = {}) => ({ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 14, ...x }),
  btn:   (v = "primary", x = {}) => ({
    ...(v === "primary" ? { background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", boxShadow: "0 6px 20px rgba(107,33,232,.4)" }
      : v === "success" ? { background: "linear-gradient(135deg,#0B9E6B,#08815A)", color: "#fff" }
      : v === "danger"  ? { background: "linear-gradient(135deg,#E8376B,#B01A4E)", color: "#fff" }
      : v === "pause"   ? { background: "linear-gradient(135deg,#E65100,#BF360C)", color: "#fff" }
      : { background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", color: "#C4B5FD" }),
    border: ["primary","success","danger","pause"].includes(v) ? "none" : undefined,
    borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700,
    cursor: "pointer", fontFamily: '"Outfit",sans-serif', ...x,
  }),
  input: (x = {}) => ({ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, padding: "11px 14px", color: "#EDE9FE", fontSize: 14, fontFamily: '"Outfit",sans-serif', width: "100%", ...x }),
  lbl:   { fontSize: 11, fontWeight: 600, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 6 },
};

const CITY_COLORS  = { Kraków: "#FFA653", Warszawa: "#FF6B6B", Poznań: "#4ECDC4", Wrocław: "#45B7D1", Katowice: "#FF6B9D" };
const STATUS_LABEL = { waiting: "Oczekiwanie", running: "Trwa quiz", paused: "Pauza", ended: "Zakończona" };
const STATUS_COLOR = { waiting: "#9B89CC", running: "#10D9A0", paused: "#F5C518", ended: "#E8376B" };

// ─── City picker ──────────────────────────────────────────────────────────────

function CityPicker({ city, setCity }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {CITIES.map((c) => (
        <button key={c.name} onClick={() => setCity(c.name)}
          style={{ ...C.btn("ghost"), background: city === c.name ? `${CITY_COLORS[c.name]}25` : undefined, borderColor: city === c.name ? `${CITY_COLORS[c.name]}55` : undefined, color: city === c.name ? "#EDE9FE" : "#9B89CC" }}>
          {c.icon} {c.name}
        </button>
      ))}
    </div>
  );
}

// ─── Tab: Pytania ─────────────────────────────────────────────────────────────

const EMPTY = { module: 1, q: "", opts: ["", "", "", ""], ans: 0, exp: "" };

function PytaniaTab({ city }) {
  const [questions, setQuestions] = useState([]);
  const [mod, setMod] = useState(1);
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getQuestions(city).then(setQuestions); }, [city]);
  const reload = () => getQuestions(city).then(setQuestions);

  const openAdd  = () => { setForm({ ...EMPTY, module: mod }); setEditId(null); };
  const openEdit = (q) => { setForm({ module: q.module, q: q.q, opts: [...q.opts], ans: q.ans, exp: q.exp || "" }); setEditId(q.id); };

  const save = async () => {
    if (!form.q || form.opts.some((o) => !o)) return alert("Wypełnij pytanie i wszystkie odpowiedzi.");
    setSaving(true);
    editId ? await updateQuestion(editId, form) : await addQuestion({ ...form, city, createdBy: null });
    setSaving(false); setForm(null); setEditId(null); reload();
  };

  const remove = async (id) => { if (!confirm("Usunąć pytanie?")) return; await deleteQuestion(id); reload(); };
  const filtered = questions.filter((q) => q.module === mod);

  return (
    <div>
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

function SesjaTab({ city, adminId }) {
  const [session, setSession] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [city]);

  const load = async () => {
    setLoading(true);
    const { data } = await getOrCreateSession(city, adminId);
    setSession(data);
    if (data) {
      setParticipants(await getParticipantsInSession(city));
      if (data.status === "ended") setResults(await getSessionResults(data.id));
    }
    setLoading(false);
  };

  const upd = async (updates) => {
    if (!session) return;
    await updateSession(session.id, updates);
    setSession((s) => ({ ...s, ...updates }));
    if (updates.status === "ended") setResults(await getSessionResults(session.id));
  };

  if (loading) return <p style={{ color: "#9B89CC", textAlign: "center", padding: 32 }}>Ładowanie…</p>;

  return (
    <div>
      <div style={{ ...C.card({ padding: "20px", marginBottom: 20, borderColor: `${STATUS_COLOR[session?.status || "waiting"]}30`, background: `${STATUS_COLOR[session?.status || "waiting"]}08` }) }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Sesja — {city}</p>
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
            <button style={C.btn("success", { flex: 1 })} onClick={() => upd({ status: "running", q_started_at: new Date().toISOString() })}>▶ Start quizu</button>
          )}
          {session?.status === "running" && <>
            <button style={C.btn("pause", { flex: 1 })} onClick={() => upd({ status: "paused" })}>⏸ Pauza</button>
            <button style={C.btn("danger")} onClick={() => { if (confirm("Zakończyć quiz?")) upd({ status: "ended" }); }}>⏹ Zakończ</button>
          </>}
          {session?.status === "paused" && (
            <button style={C.btn("success", { flex: 1 })} onClick={() => upd({ status: "running" })}>▶ Wznów</button>
          )}
          {session?.status === "ended" && (
            <button style={C.btn("ghost", { flex: 1 })} onClick={load}>🔄 Odśwież wyniki</button>
          )}
        </div>
      </div>

      {participants.length > 0 && session?.status !== "ended" && (
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Uczestnicy w lobby ({participants.length})</p>
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
          <p style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Wyniki końcowe</p>
          {results.map((r, i) => (
            <div key={r.code} style={{ ...C.card({ padding: "12px 16px", marginBottom: 8 }), display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: '"Bebas Neue"', fontSize: 22, color: i === 0 ? "#F5C518" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "#9B89CC", width: 28, textAlign: "center" }}>{i + 1}</span>
              <p style={{ flex: 1, fontWeight: 600 }}>{r.name}</p>
              <p style={{ fontFamily: '"Bebas Neue"', fontSize: 22, color: "#F5C518" }}>{r.points} pkt</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "pytania", label: "📝 Pytania" },
  { id: "kody",    label: "🎟️ Kody"   },
  { id: "sesja",   label: "🎮 Sesja"  },
];

export default function AdminPanel({ admin, isDesktop, onLogout }) {
  const isSuperadmin = admin?.role === "superadmin";
  const [city, setCity]  = useState(admin?.city || "Kraków");
  const [tab, setTab]    = useState("sesja");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: '"Outfit",sans-serif', color: "#EDE9FE", display: "flex", flexDirection: "column" }}>

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

      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(0,0,0,.15)" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`fue-tab${tab === t.id ? " active" : ""}`}
            style={{ whiteSpace: "nowrap", fontSize: 13, padding: "14px 22px" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: isDesktop ? "28px 40px" : "20px 16px", maxWidth: 900, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {tab === "pytania" && <PytaniaTab city={city} />}
        {tab === "kody"    && <KodyTab    city={city} adminId={admin?.id} />}
        {tab === "sesja"   && <SesjaTab   city={city} adminId={admin?.id} />}
      </div>
    </div>
  );
}
