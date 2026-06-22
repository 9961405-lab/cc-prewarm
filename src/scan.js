import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { prewarmTimes, PREWARM_MATCH_MS } from "./state.js";

// Drop activity that the tool's own prewarms generated, so our pings don't get
// counted as "usage" and bias the recommended trigger time over time.
function excludePrewarms(timestamps, prewarmMs) {
  if (prewarmMs.length === 0) return { kept: timestamps, removed: 0 };
  const sorted = [...prewarmMs].sort((a, b) => a - b);
  const isPrewarm = (t) => {
    // binary search for the nearest recorded prewarm time
    let lo = 0, hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < t) lo = mid + 1; else hi = mid;
    }
    const candidates = [sorted[lo], sorted[lo - 1]].filter((x) => x !== undefined);
    return candidates.some((p) => Math.abs(p - t) <= PREWARM_MATCH_MS);
  };
  const kept = timestamps.filter((d) => !isPrewarm(d.getTime()));
  return { kept, removed: timestamps.length - kept.length };
}

const HOME = homedir();

const SOURCES = {
  claude: {
    label: "Claude Code",
    dir: join(HOME, ".claude", "telemetry"),
    pattern: /\.json$/,
    tsRegex: /"client_timestamp":"([^"]+)"/g,
    recursive: false,
  },
  codex: {
    label: "Codex",
    dir: join(HOME, ".codex", "sessions"),
    pattern: /\.jsonl$/,
    tsRegex: /"timestamp":"([^"]+)"/g,
    recursive: true,
  },
};

async function findFiles(dir, pattern, recursive) {
  if (!existsSync(dir)) return [];
  const results = [];

  async function walk(d) {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory() && recursive) await walk(full);
      else if (e.isFile() && pattern.test(e.name)) results.push(full);
    }
  }

  await walk(dir);
  return results;
}

function extractTimestamps(text, regex) {
  const ts = [];
  let m;
  const re = new RegExp(regex.source, regex.flags);
  while ((m = re.exec(text)) !== null) {
    const d = new Date(m[1]);
    if (!Number.isNaN(d.getTime())) ts.push(d);
  }
  return ts;
}

export async function collectTimestamps(dir) {
  if (dir) {
    return collectFromDir(dir, /\.json$/, /"client_timestamp":"([^"]+)"/g, false);
  }
  const claude = await collectForAgent("claude");
  const codex = await collectForAgent("codex");
  return {
    timestamps: [...claude.timestamps, ...codex.timestamps],
    found: claude.found || codex.found,
    agents: { claude, codex },
  };
}

export async function collectForAgent(agent) {
  const src = SOURCES[agent];
  if (!src) return { timestamps: [], found: false, agent, label: agent };

  const files = await findFiles(src.dir, src.pattern, src.recursive);
  if (files.length === 0) {
    return { timestamps: [], dir: src.dir, found: existsSync(src.dir), fileCount: 0, agent, label: src.label };
  }

  const raw = [];
  for (const file of files) {
    let text;
    try { text = await readFile(file, "utf8"); } catch { continue; }
    raw.push(...extractTimestamps(text, src.tsRegex));
  }

  const { kept, removed } = excludePrewarms(raw, await prewarmTimes(agent));
  return {
    timestamps: kept,
    dir: src.dir,
    found: true,
    fileCount: files.length,
    prewarmExcluded: removed,
    agent,
    label: src.label,
  };
}

async function collectFromDir(dir, pattern, tsRegex, recursive) {
  const files = await findFiles(dir, pattern, recursive);
  const timestamps = [];
  for (const file of files) {
    let text;
    try { text = await readFile(file, "utf8"); } catch { continue; }
    timestamps.push(...extractTimestamps(text, tsRegex));
  }
  return { timestamps, dir, found: timestamps.length > 0, fileCount: files.length };
}

export { SOURCES };
