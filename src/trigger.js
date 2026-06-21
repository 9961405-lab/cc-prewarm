import { spawn } from "node:child_process";
import { c } from "./ui.js";

// The actual prewarm: fire one throwaway message through whichever agent CLI is
// installed, in non-interactive/headless mode. This consumes a sliver of quota,
// which is exactly the point — it *starts* the 5-hour window.
//
// Claude Code:  claude -p "<msg>"        (print mode, exits immediately)
// Codex:        codex exec "<msg>"       (non-interactive exec)
const AGENTS = {
  claude: { bin: "claude", args: (msg) => ["-p", msg] },
  codex: { bin: "codex", args: (msg) => ["exec", msg] },
};

const DEFAULT_MSG = "你好（预热：开启 5 小时额度窗口，无需回复）";

function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "ignore" });
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
  const res = await run(spec.bin, spec.args(message));
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
