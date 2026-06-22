import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".cc-prewarm");
const HISTORY = join(DIR, "history.jsonl");

export const HISTORY_PATH = HISTORY;

// Activity within this many ms of a recorded prewarm is treated as the prewarm
// itself (the agent writes its session a few seconds after we fire).
export const PREWARM_MATCH_MS = 3 * 60 * 1000;

export async function recordTrigger({ agent, ok, code, reason, ts = new Date() }) {
  try {
    if (!existsSync(DIR)) await mkdir(DIR, { recursive: true });
    const row = { ts: ts.toISOString(), agent, ok, code };
    if (reason) row.reason = reason;
    await appendFile(HISTORY, JSON.stringify(row) + "\n");
  } catch { /* never let bookkeeping break the actual prewarm */ }
}

export async function readHistory() {
  if (!existsSync(HISTORY)) return [];
  try {
    const text = await readFile(HISTORY, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

export async function prewarmTimes(agent) {
  const rows = await readHistory();
  return rows
    .filter((r) => r.agent === agent && r.ok)
    .map((r) => new Date(r.ts).getTime())
    .filter((n) => !Number.isNaN(n));
}

export async function lastResults() {
  const rows = await readHistory();
  const out = {};
  for (const r of rows) out[r.agent] = r;
  return out;
}

// Per-agent stats over the last `days` days: success rate + reason histogram.
export async function recentStats(days = 7) {
  const rows = await readHistory();
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const recent = rows.filter((r) => new Date(r.ts).getTime() >= cutoff);
  const byAgent = {};
  for (const r of recent) {
    const a = (byAgent[r.agent] ||= { total: 0, ok: 0, reasons: {} });
    a.total++;
    if (r.ok) a.ok++;
    else if (r.reason) a.reasons[r.reason] = (a.reasons[r.reason] || 0) + 1;
  }
  for (const a of Object.values(byAgent)) {
    a.successRate = a.total ? a.ok / a.total : 0;
  }
  return byAgent;
}
