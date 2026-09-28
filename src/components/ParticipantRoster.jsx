import { useState, useEffect } from "react";
import useWindowWidth from "../hooks/useWindowWidth.js";
import { ROSTER_STATES, classifyParticipant, sortRoster, summarizeRoster, conflictLabel } from "../lib/roster.js";

// ─── Lista uczestników „kto utknął” (P7-ADMIN-STUCK, 07-UI-SPEC §7) ─────────────
// Stan każdego uczestnika liczony z danych, które panel już ma (lista kodów w sesji,
// lista „W poczekalni” tylko w waiting), plus wiersze answers ostatniego zamkniętego
// pytania i świeże konflikty kodu. Komponent sam niczego nie pobiera ani nie subskrybuje.

const CARD = { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 14 };
const GHOST = {
  background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", color: "#C4B5FD",
  borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: '"Space Grotesk",sans-serif',
};

const PILLS = [
  { key: "online", text: "W grze", color: ROSTER_STATES.online.color },
  { key: "no_answer", text: "Brak odpowiedzi", color: ROSTER_STATES.no_answer.color },
  { key: "disconnected", text: "Rozłączeni", color: ROSTER_STATES.disconnected.color },
  { key: "conflict", text: "Inny telefon", color: ROSTER_STATES.conflict.color },
  { key: "lobby", text: "W poczekalni", color: ROSTER_STATES.lobby.color },
];

export default function ParticipantRoster({ status, participants, lobbyCodes, closedPresence, conflicts, nowMs, onRelease }) {
  const isDesktop = useWindowWidth() >= 900;
  const [onlyProblems, setOnlyProblems] = useState(status !== "waiting");
  useEffect(() => { setOnlyProblems(status !== "waiting"); }, [status]);

  const list = participants || [];
  const rows = sortRoster(list.map((p) => ({
    p,
    code: p.code,
    state: classifyParticipant({
      status,
      inLobby: lobbyCodes ? lobbyCodes.has(p.code) : null,
      lastClosed: !closedPresence ? null : closedPresence.has(p.code) ? (closedPresence.get(p.code) ? "answered" : "empty") : "missing",
      conflictAt: conflicts?.get(p.code) ?? null,
      nowMs,
    }),
  })));
  const summary = summarizeRoster(rows);
  const visible = onlyProblems ? rows.filter((r) => ROSTER_STATES[r.state]?.problem) : rows;

  const release = (p) => {
    if (!confirm(`Zwolnić kod ${p.code} (${p.name} ${p.surname}) z telefonu? Uczestnik wpisze ten sam kod na innym urządzeniu.`)) return;
    onRelease(p);
  };

  return (
    <div style={{ ...CARD, padding: "16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase" }}>
          👥 Uczestnicy — {list.length}
        </p>
        {list.length > 0 && (
          <button type="button" aria-pressed={onlyProblems} onClick={() => setOnlyProblems((v) => !v)}
            style={{ ...GHOST, fontSize: 11, fontWeight: 700, padding: "4px 10px" }}>
            {onlyProblems
              ? "Pokaż wszystkich"
              : "Tylko problemy"}
          </button>
        )}
      </div>

      {list.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {PILLS.filter((x) => summary[x.key] > 0).map((x) => (
            <span key={x.key} style={{ fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "2px 10px",
              background: `${x.color}1F`, color: x.color }}>
              {x.text} {summary[x.key]}
            </span>
          ))}
        </div>
      )}

      <p style={{ fontSize: 11, color: "rgba(155,137,204,.7)", marginBottom: 10 }}>
        {status === "waiting"
          ? "Stan poczekalni na żywo."
          : "Stan po ostatnim zamkniętym pytaniu — odświeża się co pytanie."}
      </p>

      {list.length === 0 ? (
        <p style={{ fontSize: 13, color: "rgba(155,137,204,.5)" }}>
          Nikt jeszcze nie dołączył. Uczestnicy pojawią się tu po wpisaniu kodu na telefonie.
        </p>
      ) : visible.length === 0 ? (
        <p style={{ fontSize: 13, color: "#10D9A0" }}>✓ Wszyscy uczestnicy są w grze.</p>
      ) : (
        <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {visible.map(({ p, code, state }) => {
            const s = ROSTER_STATES[state];
            const bound = !!p.device_id;
            const statusText = state === "conflict" ? conflictLabel(conflicts.get(code), nowMs) : isDesktop ? s.label : s.short;
            const statusEl = (
              <span style={{ fontSize: 11, fontWeight: 700, color: s.color, whiteSpace: isDesktop ? "nowrap" : "normal" }}>{statusText}</span>
            );
            return (
              <div key={p.id ?? code} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: isDesktop ? "nowrap" : "wrap",
                padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,.03)",
                border: `1px solid ${s.problem ? `${s.color}40` : "rgba(255,255,255,.06)"}` }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0,
                  animation: s.pulse ? "pulse 1.5s infinite" : undefined }} />
                <span style={{ fontFamily: '"Bebas Neue"', fontSize: 13, letterSpacing: 1, color: "#C4B5FD", minWidth: 76 }}>{code}</span>
                {isDesktop ? (
                  <>
                    <span style={{ fontSize: 13, fontWeight: 400, color: "#EDE9FE", flex: 1, minWidth: 0,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name} {p.surname}</span>
                    {statusEl}
                  </>
                ) : (
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 400, color: "#EDE9FE",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name} {p.surname}</span>
                    {statusEl}
                  </div>
                )}
                <button type="button" disabled={!bound} onClick={() => release(p)}
                  title={bound
                    ? "Zwolnij kod z telefonu (zmiana urządzenia)"
                    : "Kod nie jest przypięty do telefonu"}
                  aria-label={`Zwolnij kod ${p.code}`}
                  style={{ ...GHOST, padding: "4px 10px", fontSize: 12, flexShrink: 0,
                    ...(isDesktop ? {} : { minWidth: 44, minHeight: 44 }),
                    ...(bound ? {} : { opacity: .3, cursor: "not-allowed" }) }}>
                  🔓
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
