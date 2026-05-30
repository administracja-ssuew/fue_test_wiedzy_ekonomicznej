// Minimalny loader .env dla Playwright (node bez vite nie ładuje .env sam).
import fs from "fs";

export function loadEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { /* brak .env */ }
  return out;
}
