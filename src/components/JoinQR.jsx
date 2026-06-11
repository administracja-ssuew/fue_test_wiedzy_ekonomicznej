import { useEffect, useState } from "react";
import QRCode from "qrcode";

// Kod QR kierujący na stronę główną aplikacji — żeby uczestnicy mogli wejść
// skanując zamiast wpisywać adres. Generowany LOKALNIE (canvas → data URL),
// bez zewnętrznego serwisu (pewniejsze na evencie, działa offline po załadowaniu).
// `to` pozwala nadpisać cel (domyślnie origin = strona główna apki).
export default function JoinQR({ size = 180, label = "Zeskanuj telefonem, aby dołączyć", to }) {
  const url = to || (typeof window !== "undefined" ? window.location.origin : "");
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (!url) return;
    let alive = true;
    QRCode.toDataURL(url, { width: size * 2, margin: 1, errorCorrectionLevel: "M",
      color: { dark: "#070215", light: "#ffffff" } })
      .then((d) => { if (alive) setSrc(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [url, size]);

  if (!src) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ background: "#fff", padding: 12, borderRadius: 16, boxShadow: "0 8px 30px rgba(0,0,0,.35)" }}>
        <img src={src} alt="Kod QR — dołącz do quizu" width={size} height={size} style={{ display: "block" }} />
      </div>
      {label && <p style={{ fontSize: 13, color: "#9B89CC", fontWeight: 600, textAlign: "center" }}>{label}</p>}
      <p style={{ fontSize: 11, color: "rgba(155,137,204,.6)", letterSpacing: .3 }}>{url.replace(/^https?:\/\//, "")}</p>
    </div>
  );
}
