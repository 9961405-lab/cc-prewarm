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

const DEFAULT_MSG = "ping (prewarm: starting my 5h quota window)";

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
    console.log(c.red(`  Unknown agent "${agent}". Use "claude" or "codex".`));
    return false;
  }
  process.stdout.write(c.dim(`  Firing prewarm via ${spec.bin} … `));
  const res = await run(spec.bin, spec.args(message));
  if (res.reason === "not-found") {
    console.log(c.red("not found on PATH"));
    console.log(
      c.gray(`  Install ${agent === "claude" ? "Claude Code" : "Codex"} first, or pass --agent=` +
        (agent === "claude" ? "codex" : "claude"))
    );
    return false;
  }
  if (res.ok) {
    console.log(c.green("done ✓"));
    console.log(c.gray("  Your 5-hour window has started. It resets ~5h from now."));
    return true;
  }
  console.log(c.yellow(`exited with code ${res.code}`));
  return false;
}

export { DEFAULT_MSG };
