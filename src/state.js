import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Small append-only record of every prewarm we fire. Two consumers:
//   1. analyze — exclude prewarm-generated activity from the usage histogram,
//      otherwise the tool's own pings bias the recommended trigger time.
//   2. status — show the result of the most recent scheduled run per agent.
const DIR = join(homedir(), ".cc-prewarm");
const HISTORY = join(DIR, "history.jsonl");

// Activity within this many ms of a recorded prewarm is treated as the prewarm
// itself (the agent writes its telemetry/session a few seconds after we fire).
export const PREWARM_MATCH_MS = 3 * 60 * 1000;

export async function recordTrigger({ agent, ok, code, ts = new Date() }) {
  try {
    if (!existsSync(DIR)) await mkdir(DIR, { recursive: true });
    const line = JSON.stringify({ ts: ts.toISOString(), agent, ok, code }) + "\n";
    await appendFile(HISTORY, line);
  } catch {
    // Never let bookkeeping break the actual prewarm.
  }
}

async function readHistory() {
  if (!existsSync(HISTORY)) return [];
  try {
    const text = await readFile(HISTORY, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Timestamps (ms) of successful prewarms for an agent — used to filter analysis.
export async function prewarmTimes(agent) {
  const rows = await readHistory();
  return rows
    .filter((r) => r.agent === agent && r.ok)
    .map((r) => new Date(r.ts).getTime())
    .filter((n) => !Number.isNaN(n));
}

// Most recent trigger result per agent, e.g. { claude: {...}, codex: {...} }.
export async function lastResults() {
  const rows = await readHistory();
  const out = {};
  for (const r of rows) out[r.agent] = r; // later rows overwrite earlier
  return out;
}
