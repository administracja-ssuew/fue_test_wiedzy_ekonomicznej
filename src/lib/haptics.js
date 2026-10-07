// ─── Haptyka wyboru odpowiedzi (P7-IOS-HAPTIC, 07-RESEARCH Wzorzec 3) ─────────
// iOS nie ma navigator.vibrate. Od iOS 18 Safari ma przełącznik <input type="checkbox" switch>,
// który przy przełączeniu daje tyknięcie haptyczne - ale TYLKO przy PRAWDZIWYM dotknięciu
// (zaufane kliknięcie w <label>). Od iOS 26.5 `label.click()` z JS już nie działa (WebKit fc1ef83),
// więc przełącznik musi leżeć pod palcem: przezroczysta nakładka <label> w kafelku.
// Przełącznik musi mieć renderer: visibility:hidden działa, display:none - nie; nie może być disabled.
// Android (i reszta) = navigator.vibrate.

export function hasSwitchHaptics() {
  return typeof HTMLInputElement !== "undefined" && "switch" in HTMLInputElement.prototype;
}

export function vibrateTap() {
  try { navigator.vibrate?.(15); } catch (_) { /* nieistotne */ }
}
