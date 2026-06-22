import { writeFile, unlink, mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { c } from "./ui.js";

const LABEL_PREFIX = "com.cc-prewarm";
const STABLE_DIR = join(homedir(), ".cc-prewarm", "app");
const STABLE_CLI = join(STABLE_DIR, "bin", "cli.js");

// Where this file currently lives — used as the source for staging.
const SRC_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_BIN = join(SRC_ROOT, "bin");
const SRC_SRC = join(SRC_ROOT, "src");

const labelFor = (agent) => `${LABEL_PREFIX}.${agent}`;
const plistPath = (agent = "claude") =>
  join(homedir(), "Library", "LaunchAgents", `${labelFor(agent)}.plist`);

// ── Stable install ──────────────────────────────────────────────────────────
// The schedule lives forever, but a clone in ~/Documents may not. Stage a copy
// of bin/ and src/ under ~/.cc-prewarm/app/, so even if the repo is deleted or
// moved, scheduled jobs keep working. Idempotent — if files are byte-identical
// we skip the write.
async function copyTreeIfChanged(srcDir, dstDir) {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const s = join(srcDir, e.name);
    const d = join(dstDir, e.name);
    if (e.isDirectory()) {
      await copyTreeIfChanged(s, d);
    } else if (e.isFile()) {
      let needCopy = true;
      if (existsSync(d)) {
        const [a, b] = await Promise.all([stat(s), stat(d)]);
        if (a.size === b.size && a.mtimeMs <= b.mtimeMs) needCopy = false;
      }
      if (needCopy) await copyFile(s, d);
    }
  }
}

async function stageApp() {
  // If we're already running from the stable dir, no-op.
  if (SRC_ROOT === STABLE_DIR) return STABLE_CLI;
  await copyTreeIfChanged(SRC_BIN, join(STABLE_DIR, "bin"));
  await copyTreeIfChanged(SRC_SRC, join(STABLE_DIR, "src"));
  return STABLE_CLI;
}

// ── Node path sanity ────────────────────────────────────────────────────────
// process.execPath is whatever node we happen to be running under. That's
// stable for a Homebrew/system install, but disastrous if it lives in /tmp,
// inside a npx cache, or inside a deleted clone. Caller can override.
function pickNodePath(override) {
  if (override) return { path: override, source: "用户指定" };
  const cur = process.execPath;
  const transient = ["/tmp/", "/private/tmp/", "/var/folders/", "/.npm/_npx/"];
  const isTransient = transient.some((p) => cur.includes(p));
  if (!isTransient) return { path: cur, source: "当前 node" };

  // Try common stable locations.
  const candidates = [
    join(homedir(), "bin", "node"),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return { path: p, source: "回退到稳定位置", warn: cur };
  }
  return { path: cur, source: "无可用稳定 node", warn: cur };
}

// ── Plist generation ────────────────────────────────────────────────────────
function macPlist(hour, agent, nodePath, cliPath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${labelFor(agent)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${cliPath}</string>
    <string>trigger</string>
    <string>--agent=${agent}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>${join(homedir(), ".cc-prewarm.log")}</string>
  <key>StandardErrorPath</key><string>${join(homedir(), ".cc-prewarm.log")}</string>
</dict>
</plist>
`;
}

export async function install({ hour, agent = "claude", dryRun = false, nodePath }) {
  const os = platform();
  const hh = String(hour).padStart(2, "0");

  // Resolve node and stage app to a stable location before writing any scheduler config.
  const node = pickNodePath(nodePath);
  if (node.warn) {
    console.log(
      c.yellow(
        `  ⚠ 当前 node (${node.warn}) 看起来是临时位置，已切换到 ${node.path}`,
      ),
    );
  }

  let cli = STABLE_CLI;
  if (!dryRun) {
    cli = await stageApp();
    if (SRC_ROOT !== STABLE_DIR) {
      console.log(c.gray(`  ✓ 应用已固化到 ${STABLE_DIR}（不依赖当前仓库位置）`));
    }
  }

  if (os === "darwin") {
    const path = plistPath(agent);
    if (dryRun) {
      console.log(c.yellow(`  [预览] 将写入 launchd 配置 → ${path}`));
      console.log(c.gray(`  [预览] 将执行: launchctl load ${path}`));
      console.log(c.gray(`  [预览] node:  ${node.path}`));
      console.log(c.gray(`  [预览] cli:   ${cli}`));
      console.log(c.gray("  配置内容：\n"));
      console.log(macPlist(hour, agent, node.path, cli).replace(/^/gm, "    "));
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, macPlist(hour, agent, node.path, cli));
    spawnSync("launchctl", ["unload", path], { stdio: "ignore" });
    const r = spawnSync("launchctl", ["load", path], { stdio: "ignore" });
    if (r.status === 0) {
      // Verify launchd actually picked it up — load can "succeed" silently.
      const list = spawnSync("launchctl", ["list", labelFor(agent)], {
        stdio: "pipe",
        encoding: "utf8",
      });
      const loaded = list.status === 0;
      console.log(
        c.green(`  ✓ 已安装定时任务 — 每天 ${hh}:00 通过 ${agent} 自动预热`),
      );
      console.log(c.gray(`    配置文件: ${path}`));
      console.log(c.gray(`    可执行:   ${node.path}`));
      console.log(c.gray(`    cli:      ${cli}`));
      console.log(c.gray(`    日志:     ~/.cc-prewarm.log`));
      if (!loaded) {
        console.log(c.yellow(`    ⚠ launchctl load 返回 0，但 list 没找到任务，可能未真正注册`));
        console.log(c.gray(`      可手动验证: launchctl list ${labelFor(agent)}`));
      }
      console.log(c.gray(`    卸载命令: cc-prewarm uninstall`));
    } else {
      console.log(c.yellow("  配置文件已写入，但 launchctl 加载失败。请手动执行："));
      console.log(c.gray(`    launchctl load ${path}`));
    }
    return;
  }

  if (os === "linux") {
    const line = `0 ${hour} * * * ${node.path} ${cli} trigger --agent=${agent}`;
    console.log(c.bold("  请将以下内容添加到 crontab（运行 crontab -e）："));
    console.log("");
    console.log("    " + c.cyan(line));
    console.log("");
    console.log(c.gray("  或直接运行: (crontab -l 2>/dev/null; echo '" + line + "') | crontab -"));
    return;
  }

  // Windows
  const winCmd = `schtasks /Create /SC DAILY /TN "cc-prewarm-${agent}" /TR "\\"${node.path}\\" \\"${cli}\\" trigger --agent=${agent}" /ST ${hh}:00`;
  console.log(c.bold("  请在 PowerShell 或 cmd 中运行以下命令："));
  console.log("");
  console.log("    " + c.cyan(winCmd));
  console.log("");
  console.log(c.gray(`  卸载命令: schtasks /Delete /TN "cc-prewarm-${agent}" /F`));
}

export async function uninstall() {
  if (platform() === "darwin") {
    let removed = 0;
    const targets = [
      ["claude", plistPath("claude")],
      ["codex", plistPath("codex")],
      ["legacy", join(homedir(), "Library", "LaunchAgents", `${LABEL_PREFIX}.daily.plist`)],
    ];
    for (const [agent, path] of targets) {
      if (existsSync(path)) {
        spawnSync("launchctl", ["unload", path], { stdio: "ignore" });
        await unlink(path);
        console.log(c.green(`  ✓ 已移除 ${agent} 定时任务`));
        removed++;
      }
    }
    if (removed === 0) console.log(c.gray("  未找到定时任务，无需移除。"));
    return;
  }
  if (platform() === "win32") {
    console.log(c.gray('  卸载命令: schtasks /Delete /TN "cc-prewarm-claude" /F'));
    console.log(c.gray('  卸载命令: schtasks /Delete /TN "cc-prewarm-codex" /F'));
  } else {
    console.log(c.gray("  请从 crontab 中移除 cc-prewarm 相关行（运行 crontab -e）。"));
  }
}

// Inspect an installed plist: cli/node paths, scheduled hour, freshness checks.
export function checkInstalled() {
  const out = {};
  if (platform() !== "darwin") return out;
  for (const agent of ["claude", "codex"]) {
    const path = plistPath(agent);
    if (!existsSync(path)) continue;
    let text = "";
    try { text = readFileSync(path, "utf8"); } catch { /* ignore */ }
    const args = [...text.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
    const hourMatch = text.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
    // ProgramArguments order: node, cli, "trigger", "--agent=…"
    const nodePath = args.find((a) => /node$/.test(a)) || null;
    const cliPath = args.find((a) => /cli\.js$/.test(a)) || null;
    out[agent] = {
      plistPath: path,
      hour: hourMatch ? Number(hourMatch[1]) : null,
      nodePath,
      cliPath,
      nodeOk: nodePath ? existsSync(nodePath) : false,
      cliOk: cliPath ? existsSync(cliPath) : false,
      stable: cliPath ? cliPath.startsWith(STABLE_DIR) : false,
    };
  }
  return out;
}

export { STABLE_DIR, STABLE_CLI, labelFor, plistPath };
