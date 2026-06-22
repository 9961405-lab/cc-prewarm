import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, delimiter } from "node:path";
import { c } from "./ui.js";
import { recordTrigger } from "./state.js";

const labelOf = (agent) => (agent === "claude" ? "Claude Code" : agent === "codex" ? "Codex" : agent);

// Timestamped, color-free one-liner that lands in ~/.cc-prewarm.log (the plist's
// StandardOutPath). This is what makes "did it run at 06:00, did it work?"
// answerable at a glance.
function logLine(text) {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false });
  console.log(`[${ts}] ${text}`);
}

function notify(title, body) {
  if (process.platform !== "darwin") return;
  try {
    const osa = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
    spawn("osascript", ["-e", osa], { stdio: "ignore" });
  } catch { /* notifications are a nicety */ }
}

// Empty, owned-by-us scratch dir for codex to run in. Avoids picking up
// arbitrary CLAUDE.md / AGENTS.md / .git context from wherever the user
// happened to be when they invoked us.
const SCRATCH = join(homedir(), ".cc-prewarm", "scratch");
function ensureScratch() {
  try { mkdirSync(SCRATCH, { recursive: true }); } catch { /* ignore */ }
  return SCRATCH;
}

const AGENTS = {
  claude: { bin: "claude", args: (msg) => ["-p", msg] },
  // codex exec refuses to run outside a "trusted"/git directory by default and
  // would otherwise try to execute model-suggested commands. We:
  //  - skip the trust gate (it's our throwaway dir),
  //  - pin a read-only sandbox so it can't write the filesystem even if it tried,
  //  - cd into an empty scratch dir to avoid picking up any project context.
  codex: {
    bin: "codex",
    args: (msg) => [
      "exec",
      "--skip-git-repo-check",
      "--sandbox", "read-only",
      "--cd", ensureScratch(),
      msg,
    ],
  },
};

// One short Chinese line that asks the model not to do anything — keeps the
// prewarm a one-token round trip even if some agent tries to be helpful.
const DEFAULT_MSG = "预热心跳，仅为开启 5 小时额度窗口。请直接回复「ok」，不要执行任何命令或读写文件。";

// Hard ceiling on a single prewarm. Headless replies usually return in seconds;
// if it's still running after this, something is wrong (network, hung agent).
const TIMEOUT_MS = 90_000;

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

function childEnv() {
  const existing = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const merged = [...SEARCH_DIRS, ...existing].filter((d, i, a) => a.indexOf(d) === i);
  return { ...process.env, PATH: merged.join(delimiter) };
}

function run(bin, args, { verbose = false } = {}) {
  return new Promise((resolve) => {
    // Capture stdout + stderr so we can show the agent's own error message on
    // failure. On success we throw it away — we only need the tail of the
    // error stream to make "exit 1" actually debuggable.
    const child = spawn(bin, args, {
      stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
      env: childEnv(),
      cwd: ensureScratch(),
    });
    let out = "";
    let err = "";
    const MAX = 2000;
    if (!verbose) {
      child.stdout?.on("data", (d) => { if (out.length < MAX) out += d.toString(); });
      child.stderr?.on("data", (d) => { if (err.length < MAX) err += d.toString(); });
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 3000);
    }, TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: "not-found" });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const stderr = err.trim().slice(-MAX);
      const stdout = out.trim().slice(-MAX);
      if (timedOut) resolve({ ok: false, reason: "timeout", code: signal || "timeout", stderr, stdout });
      else resolve({ ok: code === 0, code, stderr, stdout });
    });
  });
}

// Map exit codes / reasons to a human-friendly category for history + logs.
function categorize(reason, code) {
  if (reason === "not-found") return "命令未找到";
  if (reason === "timeout") return `执行超时（>${Math.round(TIMEOUT_MS / 1000)}s）`;
  // Both agents tend to exit 1 for auth/quota — we can't disambiguate without
  // capturing stderr, which we deliberately don't (privacy).
  if (code === 1) return "退出码 1（多为登录过期或额度已满）";
  return `退出码 ${code}`;
}

export async function trigger({ agent = "claude", message = DEFAULT_MSG, verbose = false } = {}) {
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
      c.gray(`  请先安装 ${labelOf(agent)}，或使用 --agent=` +
        (agent === "claude" ? "codex" : "claude"))
    );
    const reason = "命令未找到";
    logLine(`${agent} 预热失败：${reason}`);
    notify("cc-prewarm 预热失败", `${labelOf(agent)}：找不到 ${spec.bin} 命令`);
    await recordTrigger({ agent, ok: false, code: "not-found", reason });
    return false;
  }

  const res = await run(resolved, spec.args(message), { verbose });
  if (res.ok) {
    console.log(c.green("成功 ✓"));
    console.log(c.gray("  5 小时窗口已开启，约 5 小时后重置。"));
    logLine(`${agent} 预热成功 ✓ 窗口已开启`);
    await recordTrigger({ agent, ok: true, code: 0 });
    return true;
  }

  const reason = categorize(res.reason, res.code);
  const tag = res.reason === "timeout" ? "超时" : res.reason === "not-found" ? "未找到" : `退出码 ${res.code}`;
  console.log(c.yellow(tag));

  // On failure, show the agent's own error output so "exit 1" stops being a
  // black box. Keep it tight — last ~10 lines is plenty for the real signal.
  const tail = (s) => s.split("\n").filter(Boolean).slice(-10).join("\n");
  const stderrTail = tail(res.stderr || "");
  const stdoutTail = tail(res.stdout || "");
  if (stderrTail) {
    console.log(c.gray("  ── 报错输出 ──"));
    console.log(stderrTail.split("\n").map((l) => "  " + c.gray(l)).join("\n"));
  } else if (stdoutTail) {
    console.log(c.gray("  ── 输出 ──"));
    console.log(stdoutTail.split("\n").map((l) => "  " + c.gray(l)).join("\n"));
  } else {
    console.log(c.gray("  (没有抓到任何输出 — 可加 --verbose 重跑看实时输出)"));
  }

  logLine(`${agent} 预热失败：${reason}`);
  if (stderrTail) logLine(`${agent} stderr 尾部：${stderrTail.replace(/\n/g, " | ")}`);

  notify("cc-prewarm 预热失败", `${labelOf(agent)}：${reason}`);
  await recordTrigger({
    agent,
    ok: false,
    code: res.code ?? res.reason,
    reason,
    stderr: stderrTail || undefined,
  });
  return false;
}

export { DEFAULT_MSG, TIMEOUT_MS };
