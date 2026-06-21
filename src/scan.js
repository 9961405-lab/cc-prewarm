import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Where Claude Code drops local telemetry. Each file is JSON containing one or
// more events; every event carries an ISO `client_timestamp`. We only read the
// timestamps — never message bodies — to profile *when* you work.
const TELEMETRY_DIR = join(homedir(), ".claude", "telemetry");

const TS_RE = /"client_timestamp":"([^"]+)"/g;

// Pull every client_timestamp out of every telemetry file. Robust to the files
// being single objects, arrays, or newline-delimited — we just regex-scan text.
export async function collectTimestamps(dir = TELEMETRY_DIR) {
  if (!existsSync(dir)) {
    return { timestamps: [], dir, found: false };
  }

  let names;
  try {
    names = await readdir(dir);
  } catch {
    return { timestamps: [], dir, found: false };
  }

  const jsonFiles = names.filter((n) => n.endsWith(".json"));
  const timestamps = [];

  for (const name of jsonFiles) {
    let text;
    try {
      text = await readFile(join(dir, name), "utf8");
    } catch {
      continue;
    }
    let m;
    while ((m = TS_RE.exec(text)) !== null) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) timestamps.push(d);
    }
  }

  return { timestamps, dir, found: true, fileCount: jsonFiles.length };
}
