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
      { name: "Helena Popek", role: "Wiceprzewodnicząca, Członkini Prezydium ds. Projektów",  univ: "SGH"   },
      { name: "Jan Peciak", role: "Członek Prezydium ds. Kontaktów Zewnętrznych",   univ: "UEKat"   },
      { name: "Maciej Kuźmiński", role: "Członek Prezydium ds. Public Relations",   univ: "UEK"   },
      { name: "Jakub Kliński", role: "Członek Prezydium ds. Administracji",   univ: "UEP"   },
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
    <div style={{ position: "relative", minHeight: "calc(100vh - 120px)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {/* Animated background blobs */}
      <div style={{ position: "absolute", top: "8%", left: "5%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle,rgba(107,33,232,.16) 0%,transparent 70%)", animation: "float1 9s ease-in-out infinite", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "10%", right: "3%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle,rgba(245,197,24,.07) 0%,transparent 70%)", animation: "float2 11s ease-in-out infinite", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "45%", right: "20%", width: 240, height: 240, borderRadius: "50%", background: "radial-gradient(circle,rgba(78,205,196,.06) 0%,transparent 70%)", animation: "float3 13s ease-in-out infinite", pointerEvents: "none" }} />

      {/* Central content */}
      <div style={{ textAlign: "center", position: "relative", zIndex: 1, padding: "40px 32px" }}>

        {/* Eyebrow */}
        <p style={{ animation: "slideUp .5s ease both", fontSize: 11, letterSpacing: 4, color: "#9B89CC", textTransform: "uppercase", fontWeight: 600, marginBottom: 28 }}>
          Forum Uczelni Ekonomicznych · {new Date().getFullYear()}
        </p>

        {/* Title — staggered lines */}
        <div style={{ lineHeight: 1, marginBottom: 12 }}>
          <div style={{ overflow: "hidden" }}>
            <h1 style={{ animation: "slideUp .5s .08s ease both", fontFamily: '"Bebas Neue",sans-serif', fontSize: isDesktop ? 130 : 88, letterSpacing: 4, color: "#fff", lineHeight: .9 }}>
              TEST
            </h1>
          </div>
          <div style={{ overflow: "hidden" }}>
            <h1 style={{ animation: "slideUp .5s .18s ease both", fontFamily: '"Bebas Neue",sans-serif', fontSize: isDesktop ? 130 : 88, letterSpacing: 4, color: "#C4B5FD", lineHeight: .9 }}>
              WIEDZY
            </h1>
          </div>
          <div style={{ overflow: "hidden" }}>
            <h1 style={{ animation: "slideUp .5s .28s ease both", fontFamily: '"Bebas Neue",sans-serif', fontSize: isDesktop ? 86 : 58, letterSpacing: 3, lineHeight: 1.1, color: "transparent", WebkitTextStroke: `1.5px rgba(107,33,232,.75)` }}>
              EKONOMICZNEJ
            </h1>
          </div>
        </div>

        {/* Animated separator */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 36, marginTop: 16 }}>
          <div style={{ height: 2, background: "linear-gradient(90deg,transparent,#6B21E8 40%,#F5C518 60%,transparent)", animation: "revealLine .8s .4s ease both", width: 0 }} />
        </div>

        {/* Buttons */}
        <div style={{ animation: "slideUp .5s .48s ease both", display: "flex", flexDirection: "column", gap: 12, maxWidth: 340, margin: "0 auto" }}>
          <button style={W.btn("primary", { fontSize: 16, padding: "18px 28px" })} onClick={() => onEnterCode()}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-3px) scale(1.02)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "")}>
            🎟️ Mam kod — dołącz do quizu
          </button>
          <button style={W.btn("ghost", { color: "#F5C518", borderColor: "rgba(245,197,24,.25)", fontSize: 13, padding: "13px 24px" })} onClick={() => onAdminLogin()}>
            🔐 Panel Administratora
          </button>
        </div>

        {/* Subtle bottom info */}
        <p style={{ animation: "slideUp .5s .58s ease both", marginTop: 32, fontSize: 11, color: "rgba(155,137,204,.35)", letterSpacing: 1 }}>
          5 MIAST · 4 MODUŁY · 2 ETAPY
        </p>
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
