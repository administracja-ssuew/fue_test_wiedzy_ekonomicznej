import { useState, useEffect, useRef } from "react";
import {
  supabase, DEMO,
  getQuestions, getPracticeQuestions, addQuestion, updateQuestion, deleteQuestion,
  getParticipantCodes, generateParticipantCode, deleteParticipantCode,
  getOrCreateSession, getSessionById, updateSession, startQuizSession, getParticipantsInSession, getSessionResults,
  getLiveAnswerSummary, endAndResetSession, getCityBg, setCityBg, uploadCityBg, DEFAULT_BG,
  getViolationsForSession,
  getModules, addModule, updateModule, deleteModule,
  logEvent,
} from "../lib/supabase.js";
import { CITIES } from "../data/questions.js";
import { useModules } from "../context/ModulesContext.jsx";
import useLiveProjection from "../hooks/useLiveProjection.js";
import { serverNow } from "../lib/serverClock.js";

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

// Single source of truth: derive city colours from CITIES (src/data/questions.js).
const CITY_COLORS  = Object.fromEntries(CITIES.map((c) => [c.name, c.color]));
const STATUS_LABEL = { waiting: "Oczekiwanie", running: "Trwa quiz", paused: "☕ Przerwa", ended: "Zakończona" };
const STATUS_COLOR = { waiting: "#9B89CC", running: "#10D9A0", paused: "#F5C518", ended: "#E8376B" };

// Parser CSV z obsługą cudzysłowów (pytania/odpowiedzi mają przecinki).
// Wykrywa separator (; lub ,) z pierwszej linii. Zwraca tablicę wierszy (tablic pól).
const parseCsv = (raw) => {
  const text = String(raw).replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/)[0] || "";
  const sep = (firstLine.split(";").length > firstLine.split(",").length) ? ";" : ",";
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f));
};

// Pobranie pliku tekstowego (CSV) z BOM — Excel poprawnie czyta polskie znaki.
const downloadCsv = (filename, content) => {
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};

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
const ANS_LETTERS = { A: 0, B: 1, C: 2, D: 3 };

function PytaniaTab({ city }) {
  const MODULES = useModules();
  const [isPractice, setIsPractice] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [mod, setMod] = useState(1);
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const qCsvRef = useRef(null);
  const [qCsvPreview, setQCsvPreview]     = useState(null);
  const [qCsvErr, setQCsvErr]             = useState("");
  const [qCsvImporting, setQCsvImporting] = useState(false);
  const [qCsvProgress, setQCsvProgress]   = useState(0);

  const handleQuestionsCsv = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCsv(ev.target.result);
      const parsed = []; let skipped = 0;
      rows.forEach((r, idx) => {
        const first = (r[0] || "").toLowerCase();
        if (idx === 0 && (first.includes("modu") || (r[1] || "").toLowerCase().includes("pytanie"))) return; // nagłówek
        if (r.length < 7) { if (r.length) skipped++; return; }
        const moduleId = parseInt(r[0], 10);
        const q = r[1];
        const opts = [r[2], r[3], r[4], r[5]];
        let ans = ANS_LETTERS[(r[6] || "").toUpperCase()];
        if (ans === undefined) { const n = parseInt(r[6], 10); if (n >= 1 && n <= 4) ans = n - 1; }
        const exp = r[7] || "";
        if (!q || opts.some((o) => !o) || ans === undefined || !(moduleId >= 1)) { skipped++; return; }
        parsed.push({ module: moduleId, q, opts, ans, exp });
      });
      setQCsvPreview(parsed.length ? parsed : null);
      setQCsvErr(parsed.length
        ? (skipped ? `Pominięto ${skipped} niepoprawnych wierszy.` : "")
        : "Brak poprawnych pytań. Format: Moduł;Pytanie;A;B;C;D;Poprawna(A-D);Wyjaśnienie.");
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const importQuestionsCsv = async () => {
    if (!qCsvPreview?.length) return;
    setQCsvImporting(true); setQCsvProgress(0);
    for (let i = 0; i < qCsvPreview.length; i++) {
      await addQuestion({ ...qCsvPreview[i], city, createdBy: null, isPractice });
      setQCsvProgress(i + 1);
    }
    setQCsvImporting(false); setQCsvPreview(null); reload();
  };

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

      {/* Import pytań z CSV / Excel */}
      <div style={{ ...C.card({ padding: "16px 18px", marginBottom: 20, borderColor: "rgba(16,217,160,.2)", background: "rgba(16,217,160,.04)" }) }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
          <p style={{ fontWeight: 700, color: "#10D9A0", fontSize: 13 }}>📥 Import pytań z CSV / Excel {isPractice ? "(próbne)" : "(główne)"}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => downloadCsv("przyklad_pytania.csv",
              "Moduł;Pytanie;Odp A;Odp B;Odp C;Odp D;Poprawna (A-D);Wyjaśnienie\n" +
              "1;Ile to 2 + 2?;3;4;5;6;B;Podstawy matematyki\n" +
              "2;Stolica Polski?;Kraków;Warszawa;Łódź;Gdańsk;B;\n")}
              style={{ ...C.btn("ghost", { fontSize: 12, padding: "6px 14px" }) }}>📄 Pobierz przykład</button>
            <button onClick={() => qCsvRef.current?.click()} style={{ ...C.btn("ghost", { fontSize: 12, padding: "6px 14px" }) }}>Wybierz plik CSV</button>
          </div>
          <input ref={qCsvRef} type="file" accept=".csv,.txt" onChange={handleQuestionsCsv} style={{ display: "none" }} />
        </div>
        <p style={{ fontSize: 11, color: "rgba(155,137,204,.7)" }}>
          Kolumny: <span style={{ fontFamily: "monospace", color: "#C4B5FD" }}>Moduł;Pytanie;A;B;C;D;Poprawna(A-D);Wyjaśnienie</span>. Poprawna = litera A/B/C/D. Wyjaśnienie opcjonalne. Importuje do {isPractice ? "puli próbnej" : "puli głównej"} miasta {city}.
        </p>
        {qCsvErr && <p style={{ color: qCsvPreview ? "#F5C518" : "#E8376B", fontSize: 12, marginTop: 6 }}>{qCsvErr}</p>}
        {qCsvPreview && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: "#9B89CC", marginBottom: 8 }}>Znaleziono <strong style={{ color: "#10D9A0" }}>{qCsvPreview.length}</strong> pytań — podgląd (max 5):</p>
            {qCsvPreview.slice(0, 5).map((p, i) => (
              <div key={i} style={{ fontSize: 12, padding: "3px 8px", background: "rgba(16,217,160,.08)", border: "1px solid rgba(16,217,160,.15)", borderRadius: 6, marginBottom: 4, color: "#EDE9FE" }}>
                <span style={{ color: "#9B89CC" }}>M{p.module} · </span>{p.q} <span style={{ color: "#10D9A0" }}>→ {["A","B","C","D"][p.ans]}: {p.opts[p.ans]}</span>
              </div>
            ))}
            {qCsvPreview.length > 5 && <p style={{ fontSize: 11, color: "#9B89CC" }}>… i {qCsvPreview.length - 5} więcej</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              {qCsvImporting ? (
                <p style={{ fontSize: 13, color: "#10D9A0" }}>Importuję {qCsvProgress}/{qCsvPreview.length}…</p>
              ) : (
                <>
                  <button onClick={importQuestionsCsv} style={{ ...C.btn("success", { fontSize: 12, padding: "8px 18px" }) }}>✅ Importuj wszystkie</button>
                  <button onClick={() => setQCsvPreview(null)} style={{ ...C.btn("ghost", { fontSize: 12, padding: "8px 14px" }) }}>Anuluj</button>
                </>
              )}
            </div>
          </div>
        )}
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
  const [csvPreview, setCsvPreview] = useState(null); // [{name, surname}] or null
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvProgress, setCsvProgress] = useState(0);
  const [csvErr, setCsvErr] = useState("");
  const csvFileRef = useRef(null);

  useEffect(() => { getParticipantCodes(city).then(setCodes); }, [city]);
  const reload = () => getParticipantCodes(city).then(setCodes);

  const generate = async () => {
    if (!form.name.trim() || !form.surname.trim()) return setErr("Podaj imię i nazwisko.");
    setErr(""); setBusy(true);
    await generateParticipantCode({ name: form.name.trim(), surname: form.surname.trim(), city, createdBy: adminId });
    setBusy(false); setForm({ name: "", surname: "" }); reload();
  };

  const handleCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target.result).replace(/^﻿/, ""); // strip BOM (Excel)
      const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const parsed = [];
      for (const row of rows) {
        // Support comma and semicolon separators; skip header-like rows
        const parts = row.split(/[,;]/).map((p) => p.trim().replace(/^["']|["']$/g, ""));
        if (parts.length < 2) continue;
        const [name, surname] = parts;
        if (!name || !surname || name.toLowerCase() === "imię" || name.toLowerCase() === "imie") continue;
        parsed.push({ name, surname });
      }
      setCsvPreview(parsed.length ? parsed : null);
      setCsvErr(parsed.length ? "" : "Nie znaleziono wierszy w formacie Imię,Nazwisko.");
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const importCsv = async () => {
    if (!csvPreview?.length) return;
    setCsvImporting(true); setCsvProgress(0);
    for (let i = 0; i < csvPreview.length; i++) {
      const { name, surname } = csvPreview[i];
      await generateParticipantCode({ name, surname, city, createdBy: adminId });
      setCsvProgress(i + 1);
    }
    setCsvImporting(false); setCsvPreview(null); reload();
  };

  const remove = async (id) => { if (!confirm("Usunąć kod?")) return; await deleteParticipantCode(id); reload(); };
  const unused = codes.filter((c) => !c.used);
  const used   = codes.filter((c) =>  c.used);

  return (
    <div>
      <div style={{ ...C.card({ padding: "18px", marginBottom: 16, borderColor: "rgba(107,33,232,.3)", background: "rgba(107,33,232,.06)" }) }}>
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

      {/* CSV import */}
      <div style={{ ...C.card({ padding: "16px 18px", marginBottom: 20, borderColor: "rgba(16,217,160,.2)", background: "rgba(16,217,160,.04)" }) }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <p style={{ fontWeight: 700, color: "#10D9A0", fontSize: 13 }}>📥 Import z CSV / Excel</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => downloadCsv("przyklad_uczestnicy.csv", "Imię;Nazwisko\nJan;Kowalski\nAnna;Nowak\nPiotr;Wiśniewski\n")} style={{ ...C.btn("ghost", { fontSize: 12, padding: "6px 14px" }) }}>
              📄 Pobierz przykład
            </button>
            <button onClick={() => csvFileRef.current?.click()} style={{ ...C.btn("ghost", { fontSize: 12, padding: "6px 14px" }) }}>
              Wybierz plik CSV
            </button>
          </div>
          <input ref={csvFileRef} type="file" accept=".csv,.txt" onChange={handleCsvFile} style={{ display: "none" }} />
        </div>
        <p style={{ fontSize: 11, color: "rgba(155,137,204,.7)" }}>
          Format pliku: nagłówek <span style={{ fontFamily: "monospace", color: "#C4B5FD" }}>Imię;Nazwisko</span>, potem każdy wiersz = jeden uczestnik (separator: przecinek lub średnik). Najłatwiej: pobierz przykład, uzupełnij w Excelu, zapisz jako CSV i wgraj.
        </p>
        {csvErr && <p style={{ color: "#E8376B", fontSize: 12, marginTop: 6 }}>{csvErr}</p>}

        {csvPreview && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, color: "#9B89CC", marginBottom: 8 }}>
              Znaleziono <strong style={{ color: "#10D9A0" }}>{csvPreview.length}</strong> uczestników — podgląd (max 5):
            </p>
            {csvPreview.slice(0, 5).map((p, i) => (
              <div key={i} style={{ fontSize: 12, padding: "3px 8px", background: "rgba(16,217,160,.08)", border: "1px solid rgba(16,217,160,.15)", borderRadius: 6, marginBottom: 4, color: "#EDE9FE" }}>
                {p.name} {p.surname}
              </div>
            ))}
            {csvPreview.length > 5 && <p style={{ fontSize: 11, color: "#9B89CC" }}>… i {csvPreview.length - 5} więcej</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              {csvImporting ? (
                <p style={{ fontSize: 13, color: "#10D9A0" }}>Importuję {csvProgress}/{csvPreview.length}…</p>
              ) : (
                <>
                  <button onClick={importCsv} style={{ ...C.btn("success", { fontSize: 12, padding: "8px 18px" }) }}>
                    ✅ Importuj wszystkich
                  </button>
                  <button onClick={() => setCsvPreview(null)} style={{ ...C.btn("ghost", { fontSize: 12, padding: "8px 14px" }) }}>
                    Anuluj
                  </button>
                </>
              )}
            </div>
          </div>
        )}
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
  const MODULES = useModules();
  const [session, setSession]           = useState(null);
  const [participants, setParticipants] = useState([]);
  const [results, setResults]           = useState([]);
  const [liveStats, setLiveStats]       = useState(null);
  const [violations, setViolations]     = useState([]);
  const [loading, setLoading]           = useState(true);
  const [isPractice, setIsPractice]     = useState(false);
  const [cityQuestions, setCityQuestions] = useState([]);
  const [liveExpanded, setLiveExpanded] = useState(false);
  const pollRef          = useRef(null);
  const liveStatsRef     = useRef(null); // dedicated 1s poll for the live answer counter
  const cityQuestionsRef = useRef([]);   // always-current questions for the realtime answer handler
  const sessionRef       = useRef(null); // always-current session for poll closures
  const pollVersionRef = useRef(0);    // incremented on every upd() to discard in-flight stale poll responses
  const presenceChRef  = useRef(null);
  const quizBcChRef    = useRef(null); // broadcast channel for instant status push to participants
  const [lobbyCount, setLobbyCount]         = useState(0);
  const [lobbyPresenceList, setLobbyPresenceList] = useState([]);
  const [violAlert, setViolAlert]           = useState(null);
  const [answersSettled, setAnswersSettled] = useState(false); // odpowiedzi przestały napływać
  const totalSeenRef     = useRef(0);
  const totalChangedAtRef = useRef(0);

  useEffect(() => { load(isPractice); return () => clearInterval(pollRef.current); }, [city, isPractice]);

  // Keep questions ref current for the realtime INSERT handler (avoids stale closure).
  useEffect(() => { cityQuestionsRef.current = cityQuestions; }, [cityQuestions]);

  // Reset the live counter the instant the question changes so realtime increments
  // start from 0 for the new question (don't stack onto the previous question's total).
  useEffect(() => {
    setLiveStats(null);
    setAnswersSettled(false);
    totalSeenRef.current = 0;
    totalChangedAtRef.current = Date.now();
  }, [session?.current_question_idx]);

  // Track when the live answer count last grew → "settled" = no new answer for a few
  // seconds (everyone still connected has answered). Robust fallback when the joined
  // count never reaches participants.length (someone disconnected mid-quiz).
  useEffect(() => {
    const total = liveStats?.total ?? 0;
    if (total !== totalSeenRef.current) {
      totalSeenRef.current = total;
      totalChangedAtRef.current = Date.now();
      setAnswersSettled(false);
    }
  }, [liveStats?.total]);

  useEffect(() => {
    if (session?.status !== "running") { setAnswersSettled(false); return; }
    const iv = setInterval(() => {
      if (totalSeenRef.current > 0 && Date.now() - totalChangedAtRef.current >= 4000) {
        setAnswersSettled(true);
      }
    }, 500);
    return () => clearInterval(iv);
  }, [session?.status]);

  const load = async (practice = isPractice) => {
    setLoading(true);
    setResults([]); setLiveStats(null);
    const { data } = await getOrCreateSession(city, adminId, practice);
    setSession(data);
    sessionRef.current = data;
    if (data) {
      setParticipants(await getParticipantsInSession(city, data.id));
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
        setParticipants(await getParticipantsInSession(city, sessionRef.current?.id));
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
          // Lightweight {total, correct} during the question — full per-row list is
          // only fetched at reveal (in the ghost LiveTab/LiveView), not here.
          q && s?.id && s.status === "running" ? getLiveAnswerSummary(s.id, q.id) : Promise.resolve(null),
          getParticipantsInSession(city, s?.id),
          s?.id ? getViolationsForSession(s.id) : Promise.resolve([]),
        ]);
        if (stats) setLiveStats(stats);
        setParticipants(parts);
        setViolations(viols);
      }, 3000);
    }
    return () => clearInterval(pollRef.current);
  }, [session?.status, cityQuestions]);

  // Dedicated fast (1s) poll of JUST the answer counter so the admin's live banner
  // is second-accurate during a question — matches the LiveView/embed cadence.
  // The heavier participants/violations bundle above stays at 3s to keep DB load low.
  useEffect(() => {
    clearInterval(liveStatsRef.current);
    if (session?.status !== "running") return;
    liveStatsRef.current = setInterval(async () => {
      const s = sessionRef.current;
      const q = cityQuestions[s?.current_question_idx ?? 0];
      if (s?.id && q?.id && s.status === "running") {
        const stats = await getLiveAnswerSummary(s.id, q.id);
        if (stats) setLiveStats(stats);
      }
    }, 1000);
    return () => clearInterval(liveStatsRef.current);
  }, [session?.status, cityQuestions]);

  // Realtime Presence — count participants actually on the lobby screen
  useEffect(() => {
    if (DEMO || !supabase) return;
    if (presenceChRef.current) { supabase.removeChannel(presenceChRef.current); presenceChRef.current = null; }
    if (session?.status !== "waiting") { setLobbyCount(0); setLobbyPresenceList([]); return; }
    const ch = supabase.channel(`presence-lobby-${city}`);
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState();
      const list = Object.values(state).flat();
      setLobbyCount(list.length);
      setLobbyPresenceList(list);
    }).subscribe();
    presenceChRef.current = ch;
    return () => { if (presenceChRef.current) { supabase.removeChannel(presenceChRef.current); presenceChRef.current = null; } };
  }, [city, session?.status]);

  // Broadcast channel (admin → participants) + violations real-time INSERT
  useEffect(() => {
    if (DEMO || !supabase || !session?.id) return;
    // Broadcast channel — admin sends status updates to participants instantly
    const bcCh = supabase.channel(`quiz-${session.id}`)
      .subscribe();
    quizBcChRef.current = bcCh;
    // Violations real-time + INSTANT answer counter (push <100ms, no polling lag).
    // Requires SUPABASE_FIXES.sql section 21 (answers in realtime publication);
    // RLS answers_admin_select means only the admin receives these events.
    const violCh = supabase.channel(`viol-rt-${session.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "violations",
        filter: `session_id=eq.${session.id}`,
      }, ({ new: v }) => {
        setViolations((prev) => {
          const exists = prev.some((p) => p.id === v.id);
          return exists ? prev : [v, ...prev];
        });
        setViolAlert(v);
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "answers",
        filter: `session_id=eq.${session.id}`,
      }, ({ new: a }) => {
        // Only count answers for the question currently on screen; the 1s poll
        // reconciles the exact value, so a missed event self-corrects within 1s.
        const curQid = cityQuestionsRef.current[sessionRef.current?.current_question_idx ?? 0]?.id;
        if (a.question_id !== curQid) return;
        setLiveStats((prev) => {
          const cur = prev || { total: 0, correct: 0 };
          return { total: cur.total + 1, correct: cur.correct + (a.is_correct ? 1 : 0) };
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(bcCh); quizBcChRef.current = null;
      supabase.removeChannel(violCh);
    };
  }, [session?.id]); // eslint-disable-line

  const upd = async (updates) => {
    if (!session) return;
    // Increment version + clear interval: any in-flight poll will see version mismatch and discard itself
    pollVersionRef.current++;
    clearInterval(pollRef.current);
    const { error } = await updateSession(session.id, updates);
    if (error) { alert("Błąd aktualizacji sesji: " + error); return; }
    const nextSession = { ...sessionRef.current, ...updates };
    setSession((s) => { sessionRef.current = nextSession; return nextSession; });
    // Broadcast full merged session — participants use payload directly, no extra DB fetch needed
    if (!DEMO && supabase && quizBcChRef.current && updates.status) {
      quizBcChRef.current.send({ type: "broadcast", event: "quiz_event", payload: nextSession });
    }
    if (updates.status) {
      logEvent({ type: `session_${updates.status}`, sessionId: session.id, city, actor: adminId, detail: { idx: nextSession.current_question_idx } });
    }
    if (updates.status === "ended" || updates.status === "results") {
      setResults(await getSessionResults(session.id));
      setLiveStats(null);
    }
  };

  // Export final ranking as CSV (semicolon-separated + UTF-8 BOM → opens cleanly in Excel PL).
  const exportResultsCsv = () => {
    const header = ["Miejsce", "Kod", "Imię i nazwisko", "Miasto", "Poprawne", "Pytań", "Śr. czas (s)"];
    const esc = (v) => {
      const s = String(v ?? "");
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header, ...results.map((r, i) => [i + 1, r.code, r.name, r.city || city, r.correct, r.total, r.avgResponseTime ?? ""])];
    const csv = "﻿" + lines.map((row) => row.map(esc).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wyniki_${city}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    logEvent({ type: "results_exported", sessionId: session?.id, city, actor: adminId, detail: { count: results.length } });
  };

  if (loading) return <p style={{ color: "#9B89CC", textAlign: "center", padding: 32 }}>Ładowanie…</p>;

  const st     = session?.status || "waiting";
  const stCol  = STATUS_COLOR[st];
  const totalQ = cityQuestions.length;
  const curQ   = (session?.current_question_idx ?? 0) + 1;
  const openLive = () => window.open(`${window.location.origin}${window.location.pathname}?live=1&city=${encodeURIComponent(city)}`, "_blank");

  // "Wszyscy odpowiedzieli" — odblokowuje przycisk wcześniejszego przejścia dalej.
  // Szybka ścieżka: liczba odpowiedzi osiągnęła liczbę uczestników. Fallback: licznik
  // przestał rosnąć (settled) — bo ktoś mógł się rozłączyć i total nigdy nie dobije.
  const liveTotal = liveStats?.total ?? 0;
  const allAnswered = st === "running" && liveTotal > 0 &&
    ((participants.length > 0 && liveTotal >= participants.length) || answersSettled);
  // Czas bieżącego pytania (do "force-end" — back-date q_started_at o tyle sekund).
  const curQuestionTimePerQ = (() => {
    const q = cityQuestions[session?.current_question_idx ?? 0];
    return MODULES.find((m) => m.id === q?.module)?.timePerQ || 60;
  })();
  // Wymusza koniec czasu bieżącego pytania u WSZYSTKICH (uczestnik, LiveView, panel)
  // przez cofnięcie q_started_at o pełen czas pytania → remaining=0 wszędzie → reveal
  // → normalny auto-advance. Reużywa istniejącego, zsynchronizowanego mechanizmu.
  const goToNextQuestion = () => {
    const backdated = new Date(serverNow() - curQuestionTimePerQ * 1000).toISOString();
    upd({ status: "running", q_started_at: backdated });
    logEvent({ type: "question_skipped", sessionId: session?.id, city, actor: adminId, detail: { idx: session?.current_question_idx } });
  };

  return (
    <div>
      {/* ── Violation toast ─────────────────────────────────────────── */}
      {violAlert && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", marginBottom: 14,
          background: "rgba(232,55,107,.12)", border: "1px solid rgba(232,55,107,.45)", borderRadius: 12 }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 700, fontSize: 13, color: "#E8376B" }}>Naruszenie regulaminu!</p>
            <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 2 }}>
              <strong style={{ color: "#C4B5FD" }}>{violAlert.participant_code || violAlert.participantCode}</strong>
              {" · "}{violAlert.type === "tab_switch" ? "Zmiana zakładki" : "Próba zrzutu ekranu"} (×{violAlert.count})
            </p>
          </div>
          <button onClick={() => setViolAlert(null)} style={{ background: "none", border: "none", color: "#9B89CC", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
        </div>
      )}

      {/* ── Top bar: mode + quick actions ───────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => setIsPractice(false)} style={{ ...C.btn(!isPractice ? "primary" : "ghost", { fontSize: 12, padding: "7px 14px" }) }}>🏆 Właściwy</button>
        <button onClick={() => setIsPractice(true)}  style={{ ...C.btn(isPractice  ? "success" : "ghost", { fontSize: 12, padding: "7px 14px" }) }}>🔬 Próbny</button>
        <div style={{ flex: 1 }} />
        <button onClick={openLive} style={{ ...C.btn("ghost", { fontSize: 12, padding: "7px 14px", display: "flex", alignItems: "center", gap: 6 }) }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#E8376B", animation: "pulse 1s infinite", display: "inline-block" }} />
          Otwórz Live
        </button>
        <button onClick={async () => {
          const msg = st === "waiting"
            ? "Zresetować sesję (usunąć oczekującą i zacząć od nowa)?"
            : st === "running" || st === "paused"
            ? "⚠️ Quiz jest aktualnie w toku! Na pewno zakończyć go i zacząć nowy?"
            : "Zresetować i przygotować nową sesję quizu?";
          if (!confirm(msg)) return;
          setLoading(true);
          logEvent({ type: "session_reset", sessionId: session?.id, city, actor: adminId, detail: { prevStatus: st } });
          await endAndResetSession(city, adminId, isPractice);
          await load(isPractice);
        }} style={C.btn(
          st === "running" || st === "paused" ? "danger" : "primary",
          { fontSize: 12, padding: "7px 14px" }
        )}>➕ Nowy quiz</button>
      </div>

      {/* ── Status banner ───────────────────────────────────────────── */}
      <div style={{ borderRadius: 18, marginBottom: 14, overflow: "hidden",
        border: `1px solid ${stCol}35`, background: `${stCol}0A` }}>

        {/* Header row */}
        <div style={{ padding: "18px 20px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: `${stCol}20`,
            border: `1.5px solid ${stCol}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
            {st === "waiting" ? "⏳" : st === "running" ? "▶" : st === "paused" ? "⏸" : "🏁"}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 10, color: "rgba(155,137,204,.7)", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>
              {isPractice ? "🔬 Próbny test" : "Sesja"} · {city}
            </p>
            <p style={{ fontFamily: '"Bebas Neue"', fontSize: 26, color: stCol, letterSpacing: 1, lineHeight: 1.1, marginTop: 2 }}>
              {STATUS_LABEL[st]}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            {st === "waiting" ? (
              <>
                <p style={{ fontFamily: '"Bebas Neue"', fontSize: 40, color: "#10D9A0", lineHeight: 1 }}>{lobbyCount}</p>
                <p style={{ fontSize: 11, color: "#9B89CC" }}>w poczekalni</p>
                <p style={{ fontSize: 10, color: "rgba(155,137,204,.4)", marginTop: 1 }}>{participants.length} aktywowanych</p>
              </>
            ) : st === "running" ? (
              <>
                <p style={{ fontFamily: '"Bebas Neue"', fontSize: 28, color: "#EDE9FE", lineHeight: 1 }}>{curQ}<span style={{ fontSize: 16, color: "#9B89CC" }}>/{totalQ}</span></p>
                <p style={{ fontSize: 11, color: "#9B89CC" }}>pytanie</p>
                <p style={{ fontSize: 10, color: "#10D9A0", marginTop: 1 }}>{participants.length} uczestników</p>
              </>
            ) : (
              <>
                <p style={{ fontFamily: '"Bebas Neue"', fontSize: 36, color: "#EDE9FE", lineHeight: 1 }}>{participants.length}</p>
                <p style={{ fontSize: 11, color: "#9B89CC" }}>uczestników</p>
              </>
            )}
          </div>
        </div>

        {/* Progress bar when running */}
        {st === "running" && totalQ > 0 && (
          <div style={{ height: 3, background: "rgba(255,255,255,.08)" }}>
            <div style={{ height: "100%", background: `linear-gradient(90deg,${stCol},#6B21E8)`, width: `${(curQ / totalQ) * 100}%`, transition: "width .6s ease" }} />
          </div>
        )}

        {/* Action buttons */}
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${stCol}20`, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {st === "waiting" && (
            <button style={{ ...C.btn("success", { flex: 1, fontSize: 14, padding: "12px 20px" }) }} onClick={async () => {
              if (!session?.id) { alert("Sesja nie jest jeszcze załadowana — kliknij 🔄 Odśwież i spróbuj ponownie."); return; }
              const { startedAt, error } = await startQuizSession(session.id);
              if (!startedAt) return alert(error || "Błąd startu — spróbuj ponownie.");
              const startedSession = { ...sessionRef.current, status: "running", q_started_at: startedAt, current_question_idx: 0 };
              setSession(() => { sessionRef.current = startedSession; return startedSession; });
              if (!DEMO && supabase && quizBcChRef.current) {
                quizBcChRef.current.send({ type: "broadcast", event: "quiz_event", payload: startedSession });
              }
              logEvent({ type: "session_started", sessionId: session.id, city, actor: adminId, detail: { isPractice } });
            }}>▶ Start quizu</button>
          )}
          {st === "running" && <>
            <button style={{ ...C.btn("pause", { flex: 1 }) }} onClick={() => {
              const elapsed = session?.q_started_at
                ? Math.floor((serverNow() - new Date(session.q_started_at).getTime()) / 1000)
                : 0;
              upd({ status: "paused", pause_elapsed_s: elapsed });
            }}>⏸ Pauza</button>
            <button style={C.btn("ghost")} title="Resetuje czas bieżącego pytania dla wszystkich uczestników" onClick={() => {
              if (!confirm("Powtórzyć bieżące pytanie? Czas zostanie zresetowany dla wszystkich uczestników (na tym samym pytaniu).")) return;
              const startedAt = new Date(serverNow()).toISOString();
              // Same question index, fresh q_started_at → participants restart the timer.
              upd({ status: "running", q_started_at: startedAt, pause_elapsed_s: null });
              logEvent({ type: "question_repeated", sessionId: session.id, city, actor: adminId, detail: { idx: sessionRef.current?.current_question_idx } });
            }}>🔁 Powtórz</button>
            <button
              disabled={!allAnswered}
              title={allAnswered ? "Można przejść dalej bez czekania na czas" : "Aktywne, gdy wszyscy odpowiedzą (lub gdy odpowiedzi przestaną napływać)"}
              style={{ ...C.btn(allAnswered ? "success" : "ghost"), opacity: allAnswered ? 1 : .45, cursor: allAnswered ? "pointer" : "not-allowed" }}
              onClick={() => { if (allAnswered) goToNextQuestion(); }}>
              ⏭ Następne ({liveTotal}/{participants.length})
            </button>
            <button style={C.btn("danger")} onClick={() => { if (confirm("Zakończyć quiz?")) upd({ status: "ended" }); }}>⏹ Zakończ</button>
          </>}
          {st === "paused" && <>
            <button style={{ ...C.btn("success", { flex: 1 }) }} onClick={() => {
              const pe = sessionRef.current?.pause_elapsed_s ?? 0;
              const newStartedAt = new Date(serverNow() - pe * 1000).toISOString();
              upd({ status: "running", q_started_at: newStartedAt, pause_elapsed_s: null });
            }}>▶ Wznów quiz</button>
            <button style={C.btn("gold")} onClick={() => { if (confirm("Ogłosić wyniki teraz?")) upd({ status: "results" }); }}>🏆 Ogłoś wyniki</button>
            <button style={C.btn("danger")} onClick={() => { if (confirm("Zakończyć quiz?")) upd({ status: "ended" }); }}>⏹ Zakończ</button>
          </>}
          <button onClick={() => load()} style={{ ...C.btn("ghost", { fontSize: 12, padding: "8px 14px" }) }}>🔄 Odśwież</button>
        </div>
      </div>

      {/* ── Lobby presence list ──────────────────────────────────────── */}
      {st === "waiting" && (
        <div style={{ ...C.card({ padding: "16px 18px", marginBottom: 14, borderColor: "rgba(16,217,160,.2)", background: "rgba(16,217,160,.04)" }) }}>
          <p style={{ fontSize: 11, color: "#10D9A0", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: lobbyPresenceList.length ? 10 : 0 }}>
            👥 W poczekalni — {lobbyCount} online
          </p>
          {lobbyPresenceList.length === 0 ? (
            <p style={{ color: "rgba(155,137,204,.5)", fontSize: 13, marginTop: 8 }}>Czekam na uczestników…</p>
          ) : (
            <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {lobbyPresenceList.map((p, idx) => (
                <div key={p.code || idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px",
                  background: "rgba(16,217,160,.07)", border: "1px solid rgba(16,217,160,.14)", borderRadius: 8 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10D9A0", animation: "pulse 1.5s infinite", flexShrink: 0 }} />
                  <span style={{ fontFamily: '"Bebas Neue"', fontSize: 13, letterSpacing: 1, color: "#C4B5FD", minWidth: 76 }}>{p.code}</span>
                  <span style={{ fontSize: 13, color: "#EDE9FE", flex: 1 }}>{p.name} {p.surname}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Live question stats — always visible when running ────────── */}
      {st === "running" && (
        <div style={{ ...C.card({ padding: "16px 18px", marginBottom: 14, borderColor: "rgba(16,217,160,.2)", background: "rgba(16,217,160,.04)" }) }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <p style={{ fontSize: 11, color: "#10D9A0", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
              📊 Odpowiedzi — pyt. {curQ}/{totalQ} <span style={{ color: "#F5C518", fontWeight: 400 }}>🔒 admin</span>
            </p>
            <span style={{ fontFamily: '"Bebas Neue"', fontSize: 22, color: "#EDE9FE" }}>{liveStats?.total ?? 0}</span>
          </div>
          {liveStats && liveStats.total > 0 ? (
            <>
              <div style={{ height: 8, background: "rgba(255,255,255,.1)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                <div style={{ height: "100%", background: "linear-gradient(90deg,#10D9A0,#6B21E8)",
                  width: `${Math.round((liveStats.correct / liveStats.total) * 100)}%`, transition: "width .5s" }} />
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <span style={{ fontSize: 12, color: "#10D9A0" }}>✅ {liveStats.correct} poprawnie</span>
                <span style={{ fontSize: 12, color: "#E8376B" }}>❌ {liveStats.total - liveStats.correct} błędnie</span>
                <span style={{ fontSize: 12, color: "#9B89CC", marginLeft: "auto" }}>{Math.round((liveStats.correct / liveStats.total) * 100)}%</span>
              </div>
            </>
          ) : (
            <p style={{ color: "rgba(155,137,204,.5)", fontSize: 13 }}>Czekam na odpowiedzi…</p>
          )}
        </div>
      )}

      {/* ── Live view embed (running only) ──────────────────────────── */}
      {st === "running" && !isPractice && (
        <div style={liveExpanded
          ? { position: "fixed", inset: 0, zIndex: 2000, background: "#070215", overflow: "auto" }
          : { ...C.card({ marginBottom: 14, padding: 0, overflow: "hidden", borderColor: "rgba(232,55,107,.2)" }) }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px",
            borderBottom: "1px solid rgba(255,255,255,.07)" }}>
            <p style={{ fontSize: 11, color: "#E8376B", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#E8376B", animation: "pulse 1s infinite" }} />
              Live — podgląd pytania
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={openLive} style={{ ...C.btn("ghost", { fontSize: 11, padding: "4px 10px" }) }}>🖥️ Nowa karta</button>
              <button onClick={() => setLiveExpanded((v) => !v)} style={{ ...C.btn("ghost", { fontSize: 11, padding: "4px 10px" }) }}>
                {liveExpanded ? "✕ Zamknij" : "⤢ Rozwiń"}
              </button>
            </div>
          </div>
          <div style={liveExpanded ? { padding: "20px" } : { padding: "12px 16px" }}>
            <LiveTab city={city} />
          </div>
        </div>
      )}

      {/* ── Anti-cheat violations ────────────────────────────────────── */}
      {violations.length > 0 && (
        <div style={{ ...C.card({ padding: "14px 18px", marginBottom: 14, borderColor: "rgba(232,55,107,.25)", background: "rgba(232,55,107,.04)" }) }}>
          <p style={{ fontSize: 11, color: "#E8376B", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
            ⚠️ Naruszenia regulaminu ({violations.length})
          </p>
          {violations.slice(0, 6).map((v, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderTop: i ? "1px solid rgba(255,255,255,.04)" : "none" }}>
              <span>{v.type === "tab_switch" ? "🔀" : "📸"}</span>
              <span style={{ fontFamily: '"Bebas Neue"', fontSize: 13, color: "#9B89CC", letterSpacing: 1, minWidth: 76 }}>{v.participant_code || v.participantCode}</span>
              <span style={{ fontSize: 12, color: "#E8376B", flex: 1 }}>{v.type === "tab_switch" ? "Zmiana zakładki" : "Screenshot"}</span>
              <span style={{ fontSize: 11, color: "#9B89CC" }}>×{v.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Participants grid ────────────────────────────────────────── */}
      {participants.length > 0 && st !== "ended" && st !== "results" && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
            Uczestnicy ({participants.length})
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 7 }}>
            {participants.map((p) => (
              <div key={p.id} style={{ ...C.card({ padding: "9px 12px" }), display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(107,33,232,.25)", border: "1px solid rgba(107,33,232,.4)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#C4B5FD", flexShrink: 0 }}>
                  {p.name?.[0]}{p.surname?.[0]}
                </div>
                <div style={{ overflow: "hidden" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name} {p.surname}</p>
                  <p style={{ fontSize: 10, color: "#9B89CC" }}>{p.code}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────── */}
      {(st === "ended" || st === "results") && (
        <div>
          {results.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <p style={{ color: "#9B89CC", fontSize: 14 }}>Brak wyników — odśwież lub poczekaj chwilę.</p>
              <button onClick={() => load()} style={{ ...C.btn("ghost", { marginTop: 12, fontSize: 13 }) }}>🔄 Odśwież wyniki</button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <p style={{ fontSize: 11, color: "#F5C518", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Wyniki końcowe</p>
                  <p style={{ fontSize: 11, color: "rgba(155,137,204,.5)", marginTop: 2 }}>Przy równej liczbie pkt decyduje krótszy średni czas.</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={C.btn("ghost", { fontSize: 13, padding: "8px 16px" })} onClick={exportResultsCsv}>
                    📥 Eksport CSV
                  </button>
                  {onPodium && (
                    <button style={C.btn("gold", { fontSize: 13, padding: "8px 16px" })} onClick={() => onPodium(results)}>
                      🏆 Podium
                    </button>
                  )}
                </div>
              </div>
              {results.map((r, i) => (
                <div key={r.code} style={{ ...C.card({ padding: "11px 16px", marginBottom: 7 }), display: "flex", alignItems: "center", gap: 12,
                  borderColor: i === 0 ? "rgba(245,197,24,.3)" : i === 1 ? "rgba(192,192,192,.2)" : i === 2 ? "rgba(205,127,50,.2)" : undefined,
                  background: i === 0 ? "rgba(245,197,24,.05)" : i < 3 ? "rgba(255,255,255,.03)" : undefined }}>
                  <span style={{ fontFamily: '"Bebas Neue"', fontSize: 22, color: i === 0 ? "#F5C518" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "#9B89CC", width: 28, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
                  <p style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{r.name}</p>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontFamily: '"Bebas Neue"', fontSize: 20, color: "#10D9A0", lineHeight: 1 }}>{r.correct}<span style={{ fontSize: 13, color: "#9B89CC" }}>/{r.total}</span></p>
                    <p style={{ fontSize: 10, color: "#9B89CC" }}>poprawnych · ⏱ {r.avgResponseTime != null ? `${r.avgResponseTime}s` : "—"}</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Ustawienia ─────────────────────────────────────────────────────────

function BgUploader({ city, isMobile, preview, onPreviewChange }) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus]       = useState("");
  const fileRef = useRef(null);
  const label   = isMobile ? "Mobile (telefon)" : "Desktop (projektor)";
  const icon    = isMobile ? "📱" : "🖥️";

  // Generuje i pobiera gotowy szablon tła w poprawnych wymiarach (z polem
  // bezpiecznym), żeby grafik miał od czego zacząć w Canvie/Photoshopie.
  const downloadTemplate = () => {
    const w = isMobile ? 1080 : 1920, h = isMobile ? 1920 : 1080;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#070215"); g.addColorStop(.5, "#0E0435"); g.addColorStop(1, "#070215");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const m = Math.round(w * 0.06);
    ctx.strokeStyle = "rgba(245,197,24,.55)"; ctx.lineWidth = 4; ctx.setLineDash([22, 16]);
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.setLineDash([]); ctx.textAlign = "center";
    ctx.fillStyle = "#F5C518"; ctx.font = `bold ${Math.round(w * 0.045)}px sans-serif`;
    ctx.fillText(`${w} × ${h}`, w / 2, h / 2 - Math.round(w * 0.01));
    ctx.fillStyle = "#9B89CC"; ctx.font = `${Math.round(w * 0.022)}px sans-serif`;
    ctx.fillText(isMobile ? "Tło MOBILE (telefon)" : "Tło DESKTOP (projektor)", w / 2, h / 2 + Math.round(w * 0.04));
    ctx.fillText("Tekst quizu jest przyciemniany — środek trzymaj czytelny", w / 2, h / 2 + Math.round(w * 0.075));
    cv.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = isMobile ? "szablon_tlo_mobile_1080x1920.png" : "szablon_tlo_desktop_1920x1080.png";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }, "image/png");
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setStatus("error:Plik musi być obrazem (PNG, JPG, WEBP)."); return; }
    if (file.size > 5 * 1024 * 1024)    { setStatus("error:Plik za duży — max 5 MB."); return; }
    setUploading(true); setStatus("uploading");
    const { url, error } = await uploadCityBg(city, file, isMobile);
    if (error) { setUploading(false); setStatus("error:" + error); return; }
    // Desktop: fixed attachment for parallax. Mobile: scroll (fixed breaks on iOS Safari).
    const bgCss = isMobile
      ? `linear-gradient(rgba(7,2,21,.72),rgba(14,4,53,.72)), url("${url}") center/cover no-repeat`
      : `linear-gradient(rgba(7,2,21,.72),rgba(14,4,53,.72)), url("${url}") center/cover no-repeat fixed`;
    const { error: bgErr } = await setCityBg(city, bgCss, isMobile);
    if (bgErr) { setUploading(false); setStatus("error:Błąd zapisu: " + bgErr); return; }
    if (!isMobile) document.documentElement.style.setProperty("--fue-bg", bgCss);
    onPreviewChange(url);
    setUploading(false); setStatus("ok");
    setTimeout(() => setStatus(""), 3000);
    e.target.value = "";
  };

  const handleClear = async () => {
    if (isMobile) {
      await setCityBg(city, null, true);
    } else {
      await setCityBg(city, DEFAULT_BG, false);
      document.documentElement.style.setProperty("--fue-bg", DEFAULT_BG);
    }
    onPreviewChange(null);
    setStatus("ok"); setTimeout(() => setStatus(""), 2000);
  };

  const isError = status.startsWith("error:");
  const errMsg  = isError ? status.slice(6) : "";

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <p style={{ fontWeight: 700, fontSize: 13, color: "#EDE9FE" }}>{label}</p>
        {isMobile && !preview && (
          <span style={{ fontSize: 10, color: "#9B89CC", fontStyle: "italic" }}>
            (fallback → desktop)
          </span>
        )}
        <button onClick={downloadTemplate} title="Pobierz pusty szablon w poprawnych wymiarach"
          style={{ ...C.btn("ghost", { fontSize: 11, padding: "4px 10px", width: "auto", marginLeft: "auto" }) }}>
          ⬇ Szablon
        </button>
      </div>

      {/* Preview */}
      {preview ? (
        <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", marginBottom: 10, border: "1px solid rgba(255,255,255,.1)" }}>
          <img src={preview} alt={label} style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
          <div style={{ position: "absolute", inset: 0, background: "rgba(7,2,21,.6)", display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: "8px" }}>
            <button onClick={handleClear} style={{ ...C.btn("danger", { padding: "4px 10px", fontSize: 11, width: "auto" }) }}>
              {isMobile ? "✕ Usuń" : "✕ Domyślne"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ height: 110, marginBottom: 10, borderRadius: 10, border: "1px dashed rgba(255,255,255,.12)", background: "rgba(255,255,255,.02)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, color: "#9B89CC" }}>{isMobile ? "Brak — używa tła desktop" : "Brak tła"}</span>
        </div>
      )}

      {/* Drop zone */}
      <div onClick={() => !uploading && fileRef.current?.click()}
        style={{ ...C.card({ padding: "18px 12px", borderColor: uploading ? "rgba(107,33,232,.5)" : "rgba(255,255,255,.12)", background: uploading ? "rgba(107,33,232,.08)" : "rgba(255,255,255,.02)", textAlign: "center", cursor: uploading ? "wait" : "pointer", transition: "all .2s" }) }}>
        <div style={{ fontSize: 24, marginBottom: 6 }}>{uploading ? "⏳" : "📁"}</div>
        <p style={{ fontWeight: 600, fontSize: 12, color: "#EDE9FE" }}>{uploading ? "Wgrywanie…" : "Kliknij aby wybrać"}</p>
        <p style={{ fontSize: 11, color: "#9B89CC", marginTop: 4 }}>PNG · JPG · WEBP · max 5 MB</p>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleFile} style={{ display: "none" }} />

      {/* Status */}
      {status === "ok" && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(11,158,107,.15)", border: "1px solid rgba(11,158,107,.3)", borderRadius: 8, fontSize: 12, color: "#10D9A0" }}>
          ✓ Zapisano
        </div>
      )}
      {isError && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(232,55,107,.12)", border: "1px solid rgba(232,55,107,.3)", borderRadius: 8, fontSize: 12, color: "#E8376B" }}>
          ⚠️ {errMsg}
        </div>
      )}
    </div>
  );
}

function UstawieniaTab({ city }) {
  const [previewDesktop, setPreviewDesktop] = useState(null);
  const [previewMobile,  setPreviewMobile]  = useState(null);

  useEffect(() => {
    setPreviewDesktop(null); setPreviewMobile(null);
    getCityBg(city).then(({ bg, bgMobile }) => {
      const matchD = bg?.match(/url\(["']?([^"')]+)["']?\)/);
      const matchM = bgMobile?.match(/url\(["']?([^"')]+)["']?\)/);
      if (matchD) setPreviewDesktop(matchD[1]);
      if (matchM) setPreviewMobile(matchM[1]);
    });
  }, [city]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontWeight: 700, fontSize: 16 }}>
          Tło dla: <span style={{ color: CITY_COLORS[city] }}>{city}</span>
        </p>
        <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 4 }}>
          Wgraj dwie wersje tła: osobne dla projektora (desktop) i osobne dla telefonów (mobile). Gdy brak wersji mobile — uczestnicy widzą tło desktop.
        </p>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <BgUploader city={city} isMobile={false} preview={previewDesktop} onPreviewChange={setPreviewDesktop} />
        <div style={{ width: 1, background: "rgba(255,255,255,.08)", alignSelf: "stretch" }} />
        <BgUploader city={city} isMobile={true}  preview={previewMobile}  onPreviewChange={setPreviewMobile} />
      </div>

      <div style={{ ...C.card({ padding: "10px 14px", borderColor: "rgba(107,33,232,.2)", background: "rgba(107,33,232,.04)", marginTop: 16 }) }}>
        <p style={{ fontSize: 12, color: "#9B89CC" }}>
          🖥️ Desktop: <strong style={{ color: "#EDE9FE" }}>1920×1080 px</strong> (16:9) &nbsp;·&nbsp;
          📱 Mobile: <strong style={{ color: "#EDE9FE" }}>1080×1920 px</strong> (9:16). Obrazy są przyciemniane — tekst quizu pozostaje czytelny.
        </p>
      </div>
    </div>
  );
}

// ─── Tab: Live Quiz View (widok duchy) ───────────────────────────────────────

const LIVE_COLORS = ["#C2185B", "#1565C0", "#2E7D32", "#E65100"];
const LIVE_LABELS = ["A", "B", "C", "D"];

function LiveTab({ city }) {
  // Pure projection of DB state — same hook as the standalone LiveView, so the
  // admin embed stays perfectly in sync with participants (incl. pause/resume,
  // live module times and the 5s reveal countdown). No local quiz state machine.
  const { phase, gIdx, timer, autoSec, cdNum, firstOfModule, currentQ, questions, mod, timePerQ, reveal, liveCount, participantsTotal } =
    useLiveProjection(city, { detailed: true });

  // Odliczanie: dla pierwszego pytania modułu zapowiedź modułu (30 s), w innym
  // wypadku zwykłe 3→2→1→START. Zsynchronizowane z uczestnikami / Live View.
  if (cdNum !== null && firstOfModule) return (
    <div style={{ textAlign: "center", padding: "40px 0" }}>
      <p style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 2, textTransform: "uppercase" }}>Następny moduł{cdNum > 0 ? ` · start za ${cdNum}s` : ""}</p>
      <p style={{ fontSize: 30, marginTop: 8 }}>{mod?.icon}</p>
      <p style={{ fontFamily: '"Bebas Neue"', fontSize: 40, color: mod?.color || "#F5C518", lineHeight: 1.1 }}>{mod?.name}</p>
    </div>
  );
  if (cdNum !== null) return (
    <div style={{ textAlign: "center", padding: "48px 0" }}>
      <p style={{ fontSize: 12, color: "#9B89CC", textTransform: "uppercase", letterSpacing: 1 }}>Następne pytanie za</p>
      <p style={{ fontFamily: '"Bebas Neue"', fontSize: 72, lineHeight: 1, color: cdNum === 0 ? "#10D9A0" : "#F5C518" }}>
        {cdNum === 0 ? "START!" : cdNum}
      </p>
    </div>
  );

  const revealData   = reveal;
  const correct      = revealData.filter((a) => a.isCorrect);
  const incorrect    = revealData.filter((a) => !a.isCorrect);
  const timedAnswers = revealData.filter((a) => a.responseTime != null);
  const avgTimeSec   = timedAnswers.length ? Math.round(timedAnswers.reduce((s, a) => s + a.responseTime, 0) / timedAnswers.length) : null;
  const timerPct  = Math.max(0, Math.min(1, timer / (timePerQ || 60)));
  const tColor    = timerPct > .5 ? "#10D9A0" : timerPct > .25 ? "#FF9A3C" : "#E8376B";

  if (phase === "waiting") return (
    <div style={{ textAlign: "center", padding: "48px 0", color: "#9B89CC" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>👁️</div>
      <p style={{ fontSize: 14 }}>Widok duchy — oczekiwanie na pytanie…</p>
    </div>
  );

  if (phase === "paused") return (
    <div style={{ textAlign: "center", padding: "48px 0", color: "#9B89CC" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>⏸️</div>
      <p style={{ fontSize: 14 }}>Quiz wstrzymany — za chwilę wznowienie.</p>
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
          {liveCount}/{participantsTotal} odpowiedzi
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
              <div style={{ textAlign: "right", alignSelf: "center", minWidth: 96 }}>
                <p style={{ fontSize: 10, color: "#9B89CC" }}>Następne za</p>
                <p style={{ fontFamily: '"Bebas Neue"', fontSize: 22, color: "#F5C518", lineHeight: 1 }}>{autoSec}s</p>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 400, overflowY: "auto" }}>
            {revealData.slice().sort((a, b) => (b.isCorrect - a.isCorrect) || ((a.responseTime ?? 1e9) - (b.responseTime ?? 1e9))).map((a) => (
              <div key={a.code} style={{ ...C.card({ padding: "8px 14px" }), display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>{a.isCorrect ? "✅" : "❌"}</span>
                <span style={{ fontFamily: '"Bebas Neue"', fontSize: 13, color: "#9B89CC", letterSpacing: 1, minWidth: 80 }}>{a.code}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{a.name}</span>
                {a.responseTime != null && (
                  <span style={{ fontSize: 11, color: "#9B89CC", minWidth: 32, textAlign: "right" }}>{a.responseTime}s</span>
                )}
                <span style={{ fontSize: 12, fontWeight: 700, color: a.isCorrect ? "#10D9A0" : "#E8376B", minWidth: 64, textAlign: "right" }}>{a.isCorrect ? "poprawna" : "błędna"}</span>
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

const EMPTY_MOD = { id: "", name: "", icon: "", color: "#6B21E8", timePerQ: 60, desc: "" };

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
              <span style={C.lbl}>Ikona / emoji (opcjonalne)</span>
              <input value={form.icon} onChange={(e) => setForm((p) => ({ ...p, icon: e.target.value }))}
                style={C.input()} placeholder="np. 🧮 — można zostawić puste" />
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
