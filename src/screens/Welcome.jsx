import { useState } from "react";
import { DEMO } from "../lib/supabase.js";
import { CITIES, MODULES } from "../data/questions.js";

// ─── Placeholder content — podmień przed eventem ─────────────────────────────

const EVENT_LINK = "#TODO"; // TODO: URL strony wydarzenia TWE

const SOCIAL_LINKS = [
  { label: "TWE Facebook",  abbr: "FB", href: "#TODO", color: "#1877F2" },
  { label: "FUE Instagram", abbr: "IG", href: "#TODO", color: "#E1306C" },
  { label: "FUE Facebook",  abbr: "FB", href: "#TODO", color: "#1877F2" },
  { label: "Strona FUE",    abbr: "🌐", href: "https://fue.psrp.org.pl/", color: "#6B21E8" },
];

const UNIVERSITIES = [
  { abbr: "UEK",   city: "Kraków",    logo: "/uek.jpg",   color: "#FFA653" },
  { abbr: "SGH",   city: "Warszawa",  logo: "/sgh.png",   color: "#FF6B6B" },
  { abbr: "UEP",   city: "Poznań",    logo: "/uep.png",   color: "#4ECDC4" },
  { abbr: "UEWr",  city: "Wrocław",   logo: "/uewr.png",  color: "#45B7D1" },
  { abbr: "UEKat", city: "Katowice",  logo: "/uekat.png", color: "#FF6B9D" },
];

const ORGANIZERS = [
  {
    group: "Prezydium Forum Uczelni Ekonomicznych",
    members: [
      { name: "Dawid Rutkowski", role: "Przewodniczący FUE",               univ: "UEW"   },
      { name: "Helena Popek", role: "Wiceprezes ds. Projektów",  univ: "SGH"   },
      { name: "Jan Peciak", role: "Członek Prezydium ds. Kontaktów Zewnętrznych",   univ: "UEKat"   },
    ],
  },
  {
    group: "Komitet Organizacyjny TWE",
    members: [
      { name: "Imię Nazwisko", role: "Koordynator Główny TWE",       univ: "UEWr"  },
      { name: "Imię Nazwisko", role: "Koordynator ds. Technologii",  univ: "UEKat" },
      { name: "Imię Nazwisko", role: "Koordynator ds. Promocji",     univ: "UEK"   },
      { name: "Imię Nazwisko", role: "Koordynator ds. Logistyki",    univ: "SGH"   },
    ],
  },
];

const UNIV_COLORS = {
  UEK: "#FFA653", SGH: "#FF6B6B", UEP: "#4ECDC4", UEWr: "#45B7D1", UEKat: "#FF6B9D",
};

const COORDINATORS_DATA = {
  Kraków:   { name: "Imię Nazwisko", role: "Koordynator KG UEK",   email: "koordynator@uek.krakow.pl",    phone: "+48 XXX XXX XXX", emoji: "🏰", color: "#FFA653" },
  Warszawa: { name: "Imię Nazwisko", role: "Koordynator KG SGH",   email: "koordynator@sgh.waw.pl",       phone: "+48 XXX XXX XXX", emoji: "🏛️", color: "#FF6B6B" },
  Poznań:   { name: "Imię Nazwisko", role: "Koordynator KG UEP",   email: "koordynator@ue.poznan.pl",     phone: "+48 XXX XXX XXX", emoji: "🐐", color: "#4ECDC4" },
  Wrocław:  { name: "Imię Nazwisko", role: "Koordynator KG UEWr",  email: "koordynator@ue.wroc.pl",       phone: "+48 XXX XXX XXX", emoji: "🦌", color: "#45B7D1" },
  Katowice: { name: "Imię Nazwisko", role: "Koordynator KG UEKat", email: "koordynator@ue.katowice.pl",   phone: "+48 XXX XXX XXX", emoji: "⚙️", color: "#FF6B9D" },
};

const SCHEDULE = [
  { time: "09:30", label: "Rejestracja uczestników",               icon: "📋" },
  { time: "10:00", label: "Powitanie i omówienie zasad",            icon: "🎤" },
  { time: "10:15", label: "Start Etapu Regionalnego",               icon: "🏁" },
  { time: "11:30", label: "Zakończenie testu · przerwa",            icon: "⏸️" },
  { time: "12:00", label: "Ogłoszenie wyników i wręczenie nagród",  icon: "🏆" },
];

const RULES = [
  "Udział w teście jest dobrowolny i bezpłatny.",
  "Podczas testu obowiązuje zakaz używania telefonów i notatek.",
  "Test składa się z 4 modułów tematycznych i 32 pytań zamkniętych (A/B/C/D).",
  "Punktacja: 500 pkt za poprawną odpowiedź + bonus za szybkość do 500 pkt.",
  "Raz zatwierdzonej odpowiedzi nie można zmienić — odpowiadaj uważnie.",
  "Top 5 uczestników z każdego miasta awansuje do Etapu Ogólnopolskiego.",
  "Organizatorzy zastrzegają sobie prawo do dyskwalifikacji uczestnika.",
];

const CITY_ADDRESSES = {
  Kraków:   "ul. Rakowicka 27, 31-510 Kraków — TODO: sala",
  Warszawa: "al. Niepodległości 162, 02-554 Warszawa — TODO: sala",
  Poznań:   "al. Niepodległości 10, 61-875 Poznań — TODO: sala",
  Wrocław:  "ul. Komandorska 118/120, 53-345 Wrocław — TODO: sala",
  Katowice: "ul. 1 Maja 50, 40-287 Katowice — TODO: sala",
};

// ─── Style helpers ───────────────────────────────────────────────────────────

const W = {
  card: (extra = {}) => ({
    background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 16, ...extra,
  }),
  btn: (v = "primary", extra = {}) => ({
    ...(v === "primary" ? { background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", boxShadow: "0 8px 28px rgba(107,33,232,.4)" }
      : v === "gold"    ? { background: "linear-gradient(135deg,#F5C518,#E5A800)", color: "#07021A", boxShadow: "0 8px 28px rgba(245,197,24,.4)" }
      : { background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", color: "#C4B5FD" }),
    border: v !== "ghost" ? "none" : undefined,
    borderRadius: 12, padding: "15px 20px", fontSize: 15, fontWeight: 700,
    cursor: "pointer", width: "100%", transition: "transform .15s,opacity .15s",
    fontFamily: '"Outfit",sans-serif', ...extra,
  }),
};

// ─── University ticker ────────────────────────────────────────────────────────

function UniversityTicker() {
  const items = [...UNIVERSITIES, ...UNIVERSITIES, ...UNIVERSITIES];
  return (
    <div style={{ background: "rgba(0,0,0,.3)", borderTop: "1px solid rgba(255,255,255,.07)", overflow: "hidden", padding: "14px 0", flexShrink: 0 }}>
      <div style={{ display: "flex", width: "max-content", animation: "ticker 22s linear infinite", alignItems: "center" }}>
        {items.map((u, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 12, width: 160, height: 64, flexShrink: 0, marginRight: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px" }}>
            <img src={u.logo} alt={u.abbr} style={{ height: 40, width: "auto", objectFit: "contain", maxWidth: 128 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Social bar ───────────────────────────────────────────────────────────────

function SocialBar() {
  return (
    <div style={{ background: "rgba(0,0,0,.4)", borderBottom: "1px solid rgba(255,255,255,.06)", padding: "7px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ background: "#fff", borderRadius: 8, padding: "3px 8px", display: "flex", alignItems: "center" }}>
          <img src="/fue.png" alt="FUE" style={{ height: 26, width: "auto" }} />
        </div>
        <a href={EVENT_LINK} target="_blank" rel="noreferrer"
          style={{ background: "rgba(107,33,232,.3)", border: "1px solid rgba(107,33,232,.5)", borderRadius: 20, padding: "3px 12px", fontSize: 11, color: "#C4B5FD", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" }}>
          📅 Strona wydarzenia →
        </a>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {SOCIAL_LINKS.map((s) => (
          <a key={s.label} href={s.href} target="_blank" rel="noreferrer" title={s.label}
            style={{ width: 30, height: 30, borderRadius: 8, background: `${s.color}20`, border: `1px solid ${s.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: s.color, textDecoration: "none" }}>
            {s.abbr}
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── City selector (shared between Koordynatorzy / Informator) ───────────────

function CitySelector({ city, setCity }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
      {CITIES.map((c) => (
        <button key={c.name} onClick={() => setCity(c.name)}
          style={{
            background: city === c.name ? `${c.color}25` : "rgba(255,255,255,.05)",
            border: `1px solid ${city === c.name ? c.color + "55" : "rgba(255,255,255,.1)"}`,
            borderRadius: 20, padding: "7px 16px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 13, fontWeight: 600, color: city === c.name ? "#EDE9FE" : "#9B89CC",
            transition: "all .15s", fontFamily: '"Outfit",sans-serif',
          }}>
          <span>{c.icon}</span>{c.name}
        </button>
      ))}
    </div>
  );
}

// ─── Contact rows (shared) ────────────────────────────────────────────────────

function ContactRows({ coord }) {
  return (
    <>
      {[
        { icon: "✉️", label: "E-mail", value: coord.email, href: `mailto:${coord.email}` },
        { icon: "📞", label: "Telefon", value: coord.phone, href: `tel:${coord.phone.replace(/\s/g, "")}` },
      ].map(({ icon, label, value, href }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: "1px solid rgba(255,255,255,.07)" }}>
          <span style={{ fontSize: 18, width: 28, textAlign: "center" }}>{icon}</span>
          <div>
            <p style={{ fontSize: 11, color: "#9B89CC", textTransform: "uppercase", letterSpacing: .8 }}>{label}</p>
            <a href={href} style={{ fontSize: 14, color: "#C4B5FD", textDecoration: "none", fontWeight: 600 }}>{value}</a>
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Tab: Główna ─────────────────────────────────────────────────────────────

function HomeTab({ isDesktop, onEnterCode, onAdminLogin }) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div className="fue-page" style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -100, left: -100, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(107,33,232,.2) 0%,transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 60, right: -80, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(245,197,24,.08) 0%,transparent 70%)", pointerEvents: "none" }} />

        <div className={isDesktop ? "fue-welcome-grid" : ""} style={!isDesktop ? { display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)", padding: "36px 0 40px" } : { padding: "40px 0 48px" }}>

          {/* Branding */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", zIndex: 1 }}>
            <div className="su" style={{ display: "inline-flex", alignSelf: "flex-start", background: "rgba(107,33,232,.25)", border: "1px solid rgba(107,33,232,.45)", borderRadius: 20, padding: "5px 14px", fontSize: 12, fontWeight: 600, color: "#C4B5FD", letterSpacing: .8, marginBottom: 20 }}>
              🐐 FORUM UCZELNI EKONOMICZNYCH
            </div>
            <h1 className="su" style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: isDesktop ? 110 : 78, lineHeight: .88, letterSpacing: 2, color: "#fff", animationDelay: ".06s" }}>
              TEST<br />
              <span style={{ color: "#C4B5FD" }}>WIEDZY</span><br />
              <span style={{ color: "#6B21E8" }}>EKONO</span><span style={{ color: "#F5C518" }}>MICZNEJ</span>
            </h1>
            <p className="su" style={{ fontSize: isDesktop ? 16 : 14, color: "#9B89CC", marginTop: 18, lineHeight: 1.7, animationDelay: ".14s", maxWidth: 480 }}>
              Ogólnopolski quiz wiedzy ekonomicznej dla studentów i pracowników akademickich.<br />
              <strong style={{ color: "#EDE9FE" }}>4 moduły · 32 pytania · 5 miast · 2 etapy</strong>
            </p>
            <div className="su" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22, animationDelay: ".2s" }}>
              {MODULES.map((m) => (
                <div key={m.id} style={{ background: `${m.color}20`, border: `1px solid ${m.color}40`, borderRadius: 20, padding: "5px 13px", fontSize: 12, color: "#C4B5FD", display: "flex", alignItems: "center", gap: 5 }}>
                  {m.icon} {m.name} <span style={{ color: "#9B89CC", fontSize: 11 }}>·{m.timePerQ}s</span>
                </div>
              ))}
            </div>
            <div className="su" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, animationDelay: ".23s" }}>
              {CITIES.map((c) => (
                <div key={c.name} style={{ background: "rgba(255,255,255,.06)", borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#C4B5FD", display: "flex", alignItems: "center", gap: 5 }}>
                  <span>{c.icon}</span>{c.name}
                </div>
              ))}
            </div>
            {!isDesktop && (
              <div className="su" style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 36, animationDelay: ".28s" }}>
                <button style={W.btn("primary")} onClick={() => onEnterCode()}>🎟️ Mam kod — dołącz do quizu</button>
                <button style={W.btn("ghost", { color: "#F5C518", borderColor: "rgba(245,197,24,.3)" })} onClick={() => onAdminLogin()}>🔐 Panel Admina</button>
              </div>
            )}
          </div>

          {/* Prawa kolumna — tylko desktop */}
          {isDesktop && (
            <div className="su" style={{ display: "flex", flexDirection: "column", gap: 16, justifyContent: "center", animationDelay: ".1s", zIndex: 1 }}>
              <div style={{ ...W.card({ padding: "36px 32px" }), background: "rgba(255,255,255,.04)" }}>
                <p style={{ fontSize: 13, color: "#9B89CC", marginBottom: 20, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Dołącz do testu</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <button style={W.btn("primary", { fontSize: 16, padding: "18px 24px" })} onClick={() => onEnterCode()}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = "")}>
                    🎟️ Mam kod — dołącz do quizu
                  </button>
                  <button style={W.btn("ghost", { color: "#F5C518", borderColor: "rgba(245,197,24,.3)", fontSize: 14, padding: "14px 24px" })} onClick={() => onAdminLogin()}>
                    🔐 Panel Administratora
                  </button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[["32", "Pytań"], ["4", "Moduły"], ["5", "Miast"]].map(([v, l]) => (
                  <div key={l} style={{ ...W.card({ padding: "20px", textAlign: "center" }) }}>
                    <p style={{ fontFamily: '"Bebas Neue"', fontSize: 40, color: "#F5C518", lineHeight: 1 }}>{v}</p>
                    <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 4 }}>{l}</p>
                  </div>
                ))}
              </div>
              <div style={{ ...W.card({ padding: "20px 24px", borderColor: "rgba(107,33,232,.3)", background: "rgba(107,33,232,.05)" }) }}>
                <p style={{ fontSize: 12, color: "#9B89CC", marginBottom: 10 }}>Jak to działa?</p>
                {[
                  ["1.", "Otrzymaj indywidualny kod od koordynatora swojego miasta"],
                  ["2.", "Wpisz kod i dołącz do lobby — rywalizuj z uczestnikami z Twojego miasta"],
                  ["3.", "Top 5 z każdego miasta przechodzi do Etapu Ogólnopolskiego"],
                ].map(([n, t]) => (
                  <div key={n} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                    <span style={{ background: "rgba(107,33,232,.3)", borderRadius: 6, padding: "1px 7px", fontSize: 11, fontWeight: 700, color: "#C4B5FD", flexShrink: 0 }}>{n}</span>
                    <p style={{ fontSize: 13, color: "#EDE9FE", lineHeight: 1.5 }}>{t}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Organizatorzy ───────────────────────────────────────────────────────

function OrganizatorszyTab() {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 860, padding: "32px 24px" }}>
        <div style={{ marginBottom: 32 }}>
          <span style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>Ludzie za projektem</span>
          <h2 style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: 42, letterSpacing: 1, color: "#EDE9FE", marginTop: 4 }}>Organizatorzy</h2>
        </div>

        {ORGANIZERS.map((section) => (
          <div key={section.group} style={{ marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,.08)" }} />
              <span style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.2, whiteSpace: "nowrap" }}>{section.group}</span>
              <div style={{ height: 1, flex: 1, background: "rgba(255,255,255,.08)" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 14 }}>
              {section.members.map((m) => {
                const color = UNIV_COLORS[m.univ] || "#9B89CC";
                const initials = m.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div key={m.name + m.role} style={{ ...W.card({ padding: "20px" }) }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}22`, border: `1px solid ${color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Bebas Neue"', fontSize: 18, color, flexShrink: 0 }}>
                        {initials}
                      </div>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</p>
                        <p style={{ fontSize: 11, color: "#9B89CC", marginTop: 2 }}>{m.role}</p>
                      </div>
                    </div>
                    <div style={{ background: `${color}15`, border: `1px solid ${color}30`, borderRadius: 8, padding: "3px 10px", display: "inline-block" }}>
                      <span style={{ fontSize: 11, color, fontWeight: 600 }}>{m.univ}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: Koordynatorzy ───────────────────────────────────────────────────────

function KoordynatorzyTab({ city, setCity }) {
  const coord = COORDINATORS_DATA[city];
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 580, padding: "32px 24px" }}>
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>Kontakt z organizacją</span>
          <h2 style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: 42, letterSpacing: 1, color: "#EDE9FE", marginTop: 4 }}>Koordynatorzy KG</h2>
        </div>

        <CitySelector city={city} setCity={setCity} />

        <div className="su" style={{ ...W.card({ padding: "28px", borderColor: `${coord.color}30` }), background: `${coord.color}08` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 4 }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, background: `${coord.color}22`, border: `1px solid ${coord.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>
              {coord.emoji}
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 17 }}>{coord.name}</p>
              <p style={{ fontSize: 13, color: "#9B89CC", marginTop: 3 }}>{coord.role}</p>
            </div>
          </div>
          <ContactRows coord={coord} />
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Informator ──────────────────────────────────────────────────────────

function InformatorTab({ city, setCity }) {
  const [section, setSection] = useState("harmonogram");
  const coord = COORDINATORS_DATA[city];
  const address = CITY_ADDRESSES[city];

  const INFO_SECTIONS = [
    { id: "harmonogram", label: "📅 Harmonogram" },
    { id: "zasady",      label: "📋 Zasady"      },
    { id: "kontakt",     label: "📞 Kontakt"      },
  ];

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 640, padding: "32px 24px" }}>
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>Wszystko co musisz wiedzieć</span>
          <h2 style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: 42, letterSpacing: 1, color: "#EDE9FE", marginTop: 4 }}>Informator uczestnika</h2>
        </div>

        <CitySelector city={city} setCity={setCity} />

        {/* Sekcja tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,.09)", marginBottom: 28 }}>
          {INFO_SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`fue-tab${section === s.id ? " active" : ""}`}
              style={{ fontSize: 13, whiteSpace: "nowrap" }}>
              {s.label}
            </button>
          ))}
        </div>

        {section === "harmonogram" && (
          <div className="fi">
            <div style={{ ...W.card({ padding: "14px 18px", marginBottom: 28, background: "rgba(107,33,232,.06)", borderColor: "rgba(107,33,232,.25)" }) }}>
              <p style={{ fontSize: 11, color: "#9B89CC", marginBottom: 4 }}>📍 Miejsce</p>
              <p style={{ fontSize: 14, fontWeight: 600 }}>{address}</p>
            </div>
            {SCHEDULE.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start", paddingBottom: 20 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 20 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: i === 2 ? "#6B21E8" : "#4F46E5", border: "2px solid rgba(107,33,232,.4)", marginTop: 5 }} />
                  {i < SCHEDULE.length - 1 && <div style={{ width: 2, flex: 1, background: "rgba(107,33,232,.2)", marginTop: 4, minHeight: 24 }} />}
                </div>
                <div>
                  <p style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: 20, color: "#F5C518", letterSpacing: 1, lineHeight: 1 }}>{s.time}</p>
                  <p style={{ fontSize: 13, color: "#EDE9FE", marginTop: 3 }}>{s.icon} {s.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {section === "zasady" && (
          <div className="fi" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {RULES.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", ...W.card({ padding: "14px 16px" }) }}>
                <span style={{ background: "rgba(107,33,232,.25)", borderRadius: 6, padding: "1px 8px", fontSize: 12, fontWeight: 700, color: "#C4B5FD", flexShrink: 0 }}>{i + 1}</span>
                <p style={{ fontSize: 14, lineHeight: 1.55 }}>{r}</p>
              </div>
            ))}
          </div>
        )}

        {section === "kontakt" && (
          <div className="fi" style={{ ...W.card({ padding: "28px", borderColor: `${coord.color}30` }), background: `${coord.color}08` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: `${coord.color}22`, border: `1px solid ${coord.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
                {coord.emoji}
              </div>
              <div>
                <p style={{ fontWeight: 700, fontSize: 16 }}>{coord.name}</p>
                <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 2 }}>{coord.role}</p>
              </div>
            </div>
            <ContactRows coord={coord} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const NAV_TABS = [
  { id: "home",          label: "Główna"        },
  { id: "organizatorzy", label: "Organizatorzy" },
  { id: "koordynatorzy", label: "Koordynatorzy" },
  { id: "informator",    label: "Informator"    },
];

export default function Welcome({ isDesktop, onEnterCode, onAdminLogin }) {
  const [tab, setTab] = useState("home");
  const [city, setCity] = useState("Kraków");

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)", display: "flex", flexDirection: "column", fontFamily: '"Outfit",sans-serif', color: "#EDE9FE" }}>

      {DEMO && (
        <div style={{ background: "rgba(245,197,24,.12)", borderBottom: "1px solid rgba(245,197,24,.3)", padding: "8px 20px", fontSize: 12, color: "#F5C518", textAlign: "center" }}>
          ⚠️ Tryb DEMO — dane przechowywane lokalnie. Skonfiguruj Supabase dla pełnej funkcjonalności.
        </div>
      )}

      <SocialBar />

      <nav style={{ borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(0,0,0,.2)", display: "flex", overflowX: "auto", flexShrink: 0 }}>
        {NAV_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`fue-tab${tab === t.id ? " active" : ""}`}
            style={{ whiteSpace: "nowrap", fontSize: 13, padding: "14px 22px" }}>
            {t.label}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1 }}>
        {tab === "home"          && <HomeTab isDesktop={isDesktop} onEnterCode={onEnterCode} onAdminLogin={onAdminLogin} />}
        {tab === "organizatorzy" && <OrganizatorszyTab />}
        {tab === "koordynatorzy" && <KoordynatorzyTab city={city} setCity={setCity} />}
        {tab === "informator"    && <InformatorTab city={city} setCity={setCity} />}
      </div>

      <UniversityTicker />
    </div>
  );
}
