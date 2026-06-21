import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

  const timestamps = [];
  for (const file of files) {
    let text;
    try { text = await readFile(file, "utf8"); } catch { continue; }
    timestamps.push(...extractTimestamps(text, src.tsRegex));
  }

  return { timestamps, dir: src.dir, found: true, fileCount: files.length, agent, label: src.label };
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
