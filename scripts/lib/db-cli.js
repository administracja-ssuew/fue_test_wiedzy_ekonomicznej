// Czyste funkcje CLI bazy (scripts/db.js) — bez sieci i bez dysku, żeby dało się je testować.

export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

// Podmienia (albo dopisuje) jedną zmienną w treści .env, reszty pliku nie rusza.
export function upsertEnv(text, key, value) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(`${key}=${value}`, "");
  }
  return lines.join(eol);
}

// https://abcdefgh.supabase.co → abcdefgh
export function projectRefFromUrl(url) {
  const m = String(url || "").match(/^https?:\/\/([a-z0-9]+)\.supabase\.(co|in)\/?/i);
  return m ? m[1] : null;
}

// Sekcja N z SUPABASE_FIXES.sql: od nagłówka „-- ─── N.” do następnego nagłówka sekcji (bez niego).
export function extractSection(sql, n) {
  const lines = sql.split(/\r?\n/);
  const isHeader = (l) => /^-- ─── \d+\./.test(l);
  const start = lines.findIndex((l) => l.startsWith(`-- ─── ${n}.`));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (isHeader(lines[i])) { end = i; break; }
  while (end > start + 1 && lines[end - 1].trim() === "") end--;
  return { text: lines.slice(start, end).join("\n"), from: start + 1, to: end };
}

// Zapytanie tylko do odczytu — wtedy na prod nie pytamy o potwierdzenie.
export function isReadOnlySql(sql) {
  const body = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim()
    .replace(/;\s*$/, "");
  if (!body || body.includes(";")) return false;
  if (!/^(select|with|explain|show|table|values)\b/i.test(body)) return false;
  return !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|notify|call|do|copy|vacuum|comment)\b/i.test(
    body.replace(/'(?:[^']|'')*'/g, "''")
  );
}

export function parseArgs(argv) {
  const flags = { stage: false, yes: false, section: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stage") flags.stage = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--section") flags.section = argv[++i] ?? null;
    else if (a.startsWith("--section=")) flags.section = a.slice("--section=".length);
    else positional.push(a);
  }
  return { cmd: positional[0] || null, rest: positional.slice(1), ...flags };
}
