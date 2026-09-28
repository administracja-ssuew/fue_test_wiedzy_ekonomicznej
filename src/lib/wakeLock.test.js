import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWakeLockController, MP4_DATA_URI } from "./wakeLock.js";

// ─── P7-IOS-WAKE: kontroler blokady ekranu (natywna + fallback wideo) ─────────
// iOS WebKit przyznaje Wake Lock tylko w trakcie gestu; bez gestu → odmowa.
// Fallback: niewyciszone wideo mp4 z dźwiękiem, bez loop (wzorzec NoSleep.js).

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function makeSentinel() {
  const handlers = {};
  return {
    release: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn((t, cb) => { handlers[t] = cb; }),
    fire: (t) => handlers[t]?.(),
  };
}

function makeNav(impl) {
  return { wakeLock: { request: vi.fn(impl) } };
}

const click = () => document.dispatchEvent(new Event("click", { bubbles: true }));

let ctrl = null;
let playSpy;
let pauseSpy;

beforeEach(() => {
  playSpy = vi.fn(() => Promise.resolve());
  pauseSpy = vi.fn();
  HTMLMediaElement.prototype.play = playSpy;
  HTMLMediaElement.prototype.pause = pauseSpy;
});

afterEach(() => {
  ctrl?.destroy();
  ctrl = null;
  document.querySelectorAll("video").forEach((v) => v.remove());
  delete document.body.dataset.fueWake;
});

describe("createWakeLockController — natywny Wake Lock", () => {
  it("setWanted(true) + udana prośba → held, mode native; nasłuch gestów zdjęty", async () => {
    const s = makeSentinel();
    const nav = makeNav(() => Promise.resolve(s));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.setWanted(true);
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
    expect(nav.wakeLock.request).toHaveBeenCalledWith("screen");
    await flush();
    expect(ctrl.getState()).toMatchObject({ wanted: true, held: true, failed: false, mode: "native" });
    click();
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it("odmowa poza gestem → held=false, failed=false; click na document ponawia prośbę", async () => {
    const nav = makeNav(() => Promise.reject(new Error("NotAllowedError")));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.setWanted(true);
    await flush();
    expect(ctrl.getState()).toMatchObject({ wanted: true, held: false, failed: false });
    click();
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it("touchend i keydown też uzbrajają; pointerdown nie (brak aktywacji)", async () => {
    const nav = makeNav(() => Promise.reject(new Error("NotAllowedError")));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.setWanted(true);
    await flush();
    document.dispatchEvent(new Event("pointerdown"));
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("touchend"));
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
    await flush();
    // po odmowie w geście natywna jest pomijana → keydown gra wideo
    document.dispatchEvent(new Event("keydown"));
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createWakeLockController — fallback wideo", () => {
  it("odmowa w geście → kolejny gest gra wideo mp4 (playsinline, bez muted i loop)", async () => {
    const nav = makeNav(() => Promise.reject(new Error("NotAllowedError")));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.setWanted(true);
    await flush();
    ctrl.armFromGesture();
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
    await flush();
    expect(playSpy).not.toHaveBeenCalled();
    ctrl.armFromGesture();
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);

    const v = document.querySelector("video");
    expect(v).not.toBeNull();
    expect(v.hasAttribute("playsinline")).toBe(true);
    expect(v.hasAttribute("muted")).toBe(false);
    expect(v.hasAttribute("loop")).toBe(false);
    expect(v.muted).toBe(false);
    expect(v.loop).toBe(false);
    const src = v.querySelector("source");
    expect(src.getAttribute("type")).toBe("video/mp4");
    expect(src.getAttribute("src").startsWith("data:video/mp4;base64,")).toBe(true);
  });

  it("play() rozwiązany → held=true, mode video", async () => {
    const nav = makeNav(() => Promise.reject(new Error("NotAllowedError")));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.armFromGesture({ force: true });
    await flush();
    ctrl.armFromGesture();
    await flush();
    expect(ctrl.getState()).toMatchObject({ wanted: true, held: true, failed: false, mode: "video" });
  });

  it("play() odrzucony po odmowie natywnej → failed=true", async () => {
    playSpy.mockImplementation(() => Promise.reject(new Error("NotAllowedError")));
    const nav = makeNav(() => Promise.reject(new Error("NotAllowedError")));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.armFromGesture({ force: true });
    await flush();
    ctrl.armFromGesture();
    await flush();
    expect(ctrl.getState()).toMatchObject({ wanted: true, held: false, failed: true });
  });

  it("brak wakeLock w nav → armFromGesture od razu gra wideo", async () => {
    ctrl = createWakeLockController({ nav: {}, doc: document });
    ctrl.armFromGesture({ force: true });
    expect(playSpy).toHaveBeenCalledTimes(1);
    await flush();
    expect(ctrl.getState()).toMatchObject({ held: true, mode: "video" });
  });

  it("timeupdate > 0,5 s przewija wideo na początek (pętla bez atrybutu loop)", async () => {
    ctrl = createWakeLockController({ nav: {}, doc: document });
    ctrl.armFromGesture({ force: true });
    const v = document.querySelector("video");
    Object.defineProperty(v, "currentTime", { value: 0.7, writable: true, configurable: true });
    v.dispatchEvent(new Event("timeupdate"));
    expect(v.currentTime).toBe(0);
  });
});

describe("createWakeLockController — wanted / zwalnianie", () => {
  it("armFromGesture() gdy wanted=false → nic; force → wanted=true i prośba", () => {
    const nav = makeNav(() => new Promise(() => {}));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.armFromGesture();
    expect(nav.wakeLock.request).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
    expect(ctrl.getState().wanted).toBe(false);
    ctrl.armFromGesture({ force: true });
    expect(ctrl.getState().wanted).toBe(true);
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it("setWanted(false) → sentinel.release(), held=false, nasłuch zdjęty", async () => {
    const s = makeSentinel();
    const nav = makeNav(() => Promise.resolve(s));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.setWanted(true);
    await flush();
    ctrl.setWanted(false);
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(ctrl.getState()).toMatchObject({ wanted: false, held: false, mode: null });
    click();
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it("setWanted(false) w trybie wideo → video.pause()", async () => {
    ctrl = createWakeLockController({ nav: {}, doc: document });
    ctrl.armFromGesture({ force: true });
    await flush();
    expect(ctrl.getState().held).toBe(true);
    ctrl.setWanted(false);
    expect(pauseSpy).toHaveBeenCalled();
    expect(ctrl.getState()).toMatchObject({ wanted: false, held: false, mode: null });
  });

  it("wanted=false, gdy prośba jeszcze w locie → sentinel od razu zwolniony", async () => {
    const s = makeSentinel();
    let resolve;
    const nav = makeNav(() => new Promise((r) => { resolve = r; }));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.setWanted(true);
    ctrl.setWanted(false);
    resolve(s);
    await flush();
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(ctrl.getState().held).toBe(false);
  });

  it("sentinel „release” (system zwolnił) → held=false; visibilitychange→visible ponawia prośbę", async () => {
    const s = makeSentinel();
    const nav = makeNav(() => Promise.resolve(s));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.setWanted(true);
    await flush();
    expect(ctrl.getState().held).toBe(true);
    s.fire("release");
    expect(ctrl.getState().held).toBe(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
    await flush();
    expect(ctrl.getState().held).toBe(true);
  });

  it("wideo zatrzymane przez system (pause) → held=false i nasłuch gestów wraca", async () => {
    ctrl = createWakeLockController({ nav: {}, doc: document });
    ctrl.armFromGesture({ force: true });
    await flush();
    const v = document.querySelector("video");
    v.dispatchEvent(new Event("pause"));
    expect(ctrl.getState()).toMatchObject({ wanted: true, held: false });
    click();
    expect(playSpy).toHaveBeenCalledTimes(2);
  });
});

describe("createWakeLockController — stan dla UI", () => {
  it("subscribe dostaje powiadomienia; getState() stabilny, gdy nic się nie zmienia", async () => {
    const s = makeSentinel();
    const nav = makeNav(() => Promise.resolve(s));
    ctrl = createWakeLockController({ nav, doc: document });
    const fn = vi.fn();
    const unsub = ctrl.subscribe(fn);
    const s0 = ctrl.getState();
    expect(ctrl.getState()).toBe(s0);
    ctrl.setWanted(false); // bez zmiany
    expect(fn).not.toHaveBeenCalled();
    expect(ctrl.getState()).toBe(s0);
    ctrl.setWanted(true);
    expect(fn).toHaveBeenCalledTimes(1);
    const s1 = ctrl.getState();
    expect(s1).not.toBe(s0);
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(ctrl.getState().held).toBe(true);
    unsub();
    ctrl.setWanted(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("body.dataset.fueWake: off → held → usunięte", async () => {
    const s = makeSentinel();
    const nav = makeNav(() => Promise.resolve(s));
    ctrl = createWakeLockController({ nav, doc: document });
    ctrl.setWanted(true);
    expect(document.body.dataset.fueWake).toBe("off");
    await flush();
    expect(document.body.dataset.fueWake).toBe("held");
    ctrl.setWanted(false);
    expect(document.body.dataset.fueWake).toBeUndefined();
  });
});

describe("MP4_DATA_URI", () => {
  it("to mp4 w data URI o rozmiarze ~3,7 KB po zdekodowaniu", () => {
    expect(MP4_DATA_URI.startsWith("data:video/mp4;base64,")).toBe(true);
    const len = atob(MP4_DATA_URI.split(",")[1]).length;
    expect(len).toBeGreaterThanOrEqual(3000);
    expect(len).toBeLessThanOrEqual(5000);
  });
});
