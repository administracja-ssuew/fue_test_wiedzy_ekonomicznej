// ─── Blokada ekranu (Faza 7 — P7-IOS-WAKE) ────────────────────────────────────
// Wygaszenie ekranu w trakcie gry = visibilitychange = naruszenie tab_switch,
// więc blokada to też uczciwość raportu naruszeń.
//
// iOS WebKit (Safari i Chrome na iOS) przyznaje navigator.wakeLock tylko w trakcie
// tymczasowej aktywacji — prośba MUSI paść synchronicznie w handlerze gestu
// (click / touchend / keydown; samo przyłożenie palca nie daje aktywacji). Dlatego:
//   1. setWanted(true) próbuje od razu (Android/desktop przyznają bez gestu),
//   2. dopóki blokada nie jest trzymana, nasłuchujemy gestów na document
//      (faza przechwytywania) i przy każdym ponawiamy prośbę,
//   3. gdy natywna blokada odmówi W GEŚCIE albo jej nie ma → kolejny gest gra
//      niewyciszone wideo mp4 z dźwiękiem, bez loop (wzorzec NoSleep.js).
// Kontroler jest singletonem (getWakeLock) — hook useWakeLock tylko ustawia
// „chcemy / nie chcemy”, a CodeEntry uzbraja blokadę kliknięciem „Dołącz”.

// Źródło mp4: NoSleep.js (MIT, © Rich Tibbett) — H.264 + AAC (cisza), ~3,7 KB. Ścieżka audio jest WYMAGANA: WebKit blokuje wygaszanie tylko dla niewyciszonego wideo z dźwiękiem i bez loop (HTMLMediaElement::shouldDisableSleep).
export const MP4_DATA_URI = "data:video/mp4;base64,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";

// Zdarzenia dające tymczasową aktywację (user activation) w WebKit.
const GESTURES = [
  "click",
  "touchend",
  "keydown",
];

export function createWakeLockController({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  const hasNative = !!nav && "wakeLock" in nav;
  let wanted = false;
  let sentinel = null;
  let nativeFailed = false; // odmowa W GEŚCIE → dalej tylko wideo
  let videoFailed = false;
  let videoPlaying = false;
  let video = null;
  let listening = false;
  let destroyed = false;
  let state = { wanted: false, held: false, failed: false, mode: null };
  const listeners = new Set();

  const onGesture = () => armFromGesture();

  function syncListening() {
    const want = !destroyed && wanted && !(sentinel || videoPlaying);
    if (want === listening || !doc) return;
    listening = want;
    for (const type of GESTURES) {
      if (want) doc.addEventListener(type, onGesture, { capture: true });
      else doc.removeEventListener(type, onGesture, { capture: true });
    }
  }

  function emit() {
    const held = !!sentinel || videoPlaying;
    const next = {
      wanted,
      held,
      failed: wanted && (nativeFailed || !hasNative) && videoFailed && !held,
      mode: sentinel ? "native" : videoPlaying ? "video" : null,
    };
    if (next.wanted !== state.wanted || next.held !== state.held
      || next.failed !== state.failed || next.mode !== state.mode) {
      state = next;
      if (doc?.body) {
        if (wanted) doc.body.dataset.fueWake = held ? "held" : "off";
        else delete doc.body.dataset.fueWake;
      }
      for (const fn of [...listeners]) fn();
    }
    syncListening();
  }

  // Wywołanie request(...) musi być synchroniczne w miejscu wołania (bez await
  // wcześniej) — inaczej iOS nie widzi gestu.
  function requestNative({ inGesture }) {
    const onFail = () => {
      if (inGesture) nativeFailed = true;
      emit();
    };
    let p;
    try {
      p = nav.wakeLock.request("screen");
    } catch (_) {
      onFail();
      return;
    }
    Promise.resolve(p).then((s) => {
      if (!wanted || destroyed || sentinel) {
        s?.release?.()?.catch?.(() => {});
        return;
      }
      sentinel = s;
      s?.addEventListener?.("release", () => {
        if (sentinel === s) { sentinel = null; emit(); }
      });
      emit();
    }, onFail);
  }

  function ensureVideo() {
    if (video) return video;
    const v = doc.createElement("video");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("title", "FUE");
    v.setAttribute("aria-hidden", "true");
    v.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0";
    const src = doc.createElement("source");
    src.setAttribute("src", MP4_DATA_URI);
    src.setAttribute("type", "video/mp4");
    v.appendChild(src);
    // Pętla ręcznie przez timeupdate — atrybut loop wyłącza blokadę w WebKit.
    v.addEventListener("timeupdate", () => { if (v.currentTime > 0.5) v.currentTime = 0; });
    // iOS pauzuje wideo przy ukryciu karty → blokada puszczona, nasłuch gestów wraca.
    v.addEventListener("pause", () => {
      if (!videoPlaying) return;
      videoPlaying = false;
      emit();
    });
    doc.body.appendChild(v);
    video = v;
    return v;
  }

  function playVideo() {
    try {
      const p = ensureVideo().play();
      p?.then?.(() => {
        if (!wanted || destroyed) { video?.pause?.(); return; }
        videoPlaying = true;
        videoFailed = false;
        emit();
      }, () => {
        videoFailed = true;
        emit();
      });
    } catch (_) {
      videoFailed = true;
    }
  }

  function armFromGesture({ force = false } = {}) {
    if (destroyed) return;
    if (force) wanted = true;
    if (!wanted) return;
    if (sentinel || videoPlaying) return;
    if (hasNative && !nativeFailed) requestNative({ inGesture: true });
    else playVideo();
    emit();
  }

  function setWanted(on) {
    if (destroyed) return;
    on = !!on;
    if (on === wanted && (!on || sentinel || videoPlaying)) return;
    if (on) {
      wanted = true;
      if (hasNative && !nativeFailed) requestNative({ inGesture: false });
      emit();
    } else {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      s?.release?.()?.catch?.(() => {});
      videoPlaying = false;
      video?.pause?.();
      emit();
    }
  }

  const onVisibility = () => {
    if (!doc.hidden && wanted && !sentinel && hasNative && !nativeFailed) requestNative({ inGesture: false });
  };
  doc?.addEventListener?.("visibilitychange", onVisibility);

  function destroy() {
    wanted = false;
    const s = sentinel;
    sentinel = null;
    s?.release?.()?.catch?.(() => {});
    videoPlaying = false;
    video?.pause?.();
    video?.remove?.();
    video = null;
    destroyed = true;
    syncListening();
    doc?.removeEventListener?.("visibilitychange", onVisibility);
    if (doc?.body) delete doc.body.dataset.fueWake;
    listeners.clear();
  }

  return {
    setWanted,
    armFromGesture,
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    destroy,
  };
}

let singleton = null;

export function getWakeLock() {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return (singleton ||= createWakeLockController());
}

export function armWakeLockFromGesture(opts) {
  getWakeLock()?.armFromGesture(opts);
}
