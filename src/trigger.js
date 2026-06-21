import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, delimiter } from "node:path";
import { c } from "./ui.js";

// The actual prewarm: fire one throwaway message through whichever agent CLI is
// installed, in non-interactive/headless mode. This consumes a sliver of quota,
// which is exactly the point — it *starts* the 5-hour window.
//
// Claude Code:  claude -p "<msg>"        (print mode, exits immediately)
// Codex:        codex exec "<msg>"       (non-interactive exec)
const AGENTS = {
  claude: { bin: "claude", args: (msg) => ["-p", msg] },
  // codex exec refuses to run outside a "trusted"/git directory, and would try
  // to execute model-suggested commands. For a throwaway prewarm we skip the
  // git check and pin a read-only sandbox so it can never touch the filesystem.
  codex: {
    bin: "codex",
    args: (msg) => ["exec", "--skip-git-repo-check", "--sandbox", "read-only", msg],
  },
};

const DEFAULT_MSG = "你好（预热：开启 5 小时额度窗口，无需回复）";

// launchd/cron run with a minimal PATH that usually excludes ~/bin, Homebrew,
// and npm-global dirs — so a bare "claude" won't be found even though it works
// in your interactive shell. Resolve to an absolute path against the likely
// install locations so scheduled runs behave the same as manual ones.
const SEARCH_DIRS = [
  join(homedir(), "bin"),
  join(homedir(), ".claude", "local"),
  join(homedir(), ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
];

function resolveBin(name) {
  if (isAbsolute(name)) return existsSync(name) ? name : null;
  const pathDirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const dir of [...pathDirs, ...SEARCH_DIRS]) {
    const full = join(dir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

// Augment PATH for the child: some agent CLIs are node scripts whose
// `#!/usr/bin/env node` shebang needs `node` on PATH — which launchd's minimal
// PATH lacks. Prepend our known install dirs (which include the node binary).
function childEnv() {
  const existing = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const merged = [...SEARCH_DIRS, ...existing].filter((d, i, a) => a.indexOf(d) === i);
  return { ...process.env, PATH: merged.join(delimiter) };
}

function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "ignore", env: childEnv() });
    child.on("error", () => resolve({ ok: false, reason: "not-found" }));
    child.on("close", (code) => resolve({ ok: code === 0, code }));
  });
}

export async function trigger({ agent = "claude", message = DEFAULT_MSG } = {}) {
  const spec = AGENTS[agent];
  if (!spec) {
    console.log(c.red(`  未知工具 "${agent}"，请使用 "claude" 或 "codex"。`));
    return false;
  }
  process.stdout.write(c.dim(`  正在通过 ${spec.bin} 发送预热消息… `));
  const resolved = resolveBin(spec.bin);
  if (!resolved) {
    console.log(c.red("未找到"));
    console.log(
      c.gray(`  请先安装 ${agent === "claude" ? "Claude Code" : "Codex"}，或使用 --agent=` +
        (agent === "claude" ? "codex" : "claude"))
    );
    return false;
  }
  const res = await run(resolved, spec.args(message));
  if (res.reason === "not-found") {
    console.log(c.red("未找到"));
    console.log(
      c.gray(`  请先安装 ${agent === "claude" ? "Claude Code" : "Codex"}，或使用 --agent=` +
        (agent === "claude" ? "codex" : "claude"))
    );
    return false;
  }
  if (res.ok) {
    console.log(c.green("成功 ✓"));
    console.log(c.gray("  5 小时窗口已开启，约 5 小时后重置。"));
    return true;
  }
  console.log(c.yellow(`退出码 ${res.code}`));
  return false;
}

export { DEFAULT_MSG };
