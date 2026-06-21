import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { c } from "./ui.js";

const LABEL_PREFIX = "com.cc-prewarm";
const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), "bin", "cli.js");
const NODE = process.execPath;

const labelFor = (agent) => `${LABEL_PREFIX}.${agent}`;
const plistPath = (agent = "claude") => join(homedir(), "Library", "LaunchAgents", `${labelFor(agent)}.plist`);

function macPlist(hour, agent) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${labelFor(agent)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${CLI}</string>
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

export async function install({ hour, agent = "claude", dryRun = false }) {
  const os = platform();
  const hh = String(hour).padStart(2, "0");

  if (os === "darwin") {
    const path = plistPath(agent);
    if (dryRun) {
      console.log(c.yellow(`  [预览] 将写入 launchd 配置 → ${path}`));
      console.log(c.gray(`  [预览] 将执行: launchctl load ${path}`));
      console.log(c.gray("  每天 " + hh + ":00 通过 " + agent + " 触发。配置内容：\n"));
      console.log(macPlist(hour, agent).replace(/^/gm, "    "));
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, macPlist(hour, agent));
    spawnSync("launchctl", ["unload", path], { stdio: "ignore" });
    const r = spawnSync("launchctl", ["load", path], { stdio: "ignore" });
    if (r.status === 0) {
      console.log(c.green(`  ✓ 已安装定时任务 — 每天 ${hh}:00 通过 ${agent} 自动预热`));
      console.log(c.gray(`    配置文件: ${path}`));
      console.log(c.gray(`    日志:     ~/.cc-prewarm.log`));
      console.log(c.gray(`    卸载命令: cc-prewarm uninstall`));
    } else {
      console.log(c.yellow("  配置文件已写入，但 launchctl 加载失败。请手动执行："));
      console.log(c.gray(`    launchctl load ${path}`));
    }
    return;
  }

  if (os === "linux") {
    const line = `0 ${hour} * * * ${NODE} ${CLI} trigger --agent=${agent}`;
    console.log(c.bold("  请将以下内容添加到 crontab（运行 crontab -e）："));
    console.log("");
    console.log("    " + c.cyan(line));
    console.log("");
    console.log(c.gray("  或直接运行: (crontab -l 2>/dev/null; echo '" + line + "') | crontab -"));
    return;
  }

  // Windows
  const cmd = `schtasks /Create /SC DAILY /TN "cc-prewarm" /TR "\\"${NODE}\\" \\"${CLI}\\" trigger --agent=${agent}" /ST ${hh}:00`;
  console.log(c.bold("  请在 PowerShell 或 cmd 中运行以下命令："));
  console.log("");
  console.log("    " + c.cyan(cmd));
  console.log("");
  console.log(c.gray('  卸载命令: schtasks /Delete /TN "cc-prewarm" /F'));
}

export async function uninstall() {
  if (platform() === "darwin") {
    let removed = 0;
    // Per-agent plists, plus the legacy single-task label from older versions.
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
    if (removed === 0) {
      console.log(c.gray("  未找到定时任务，无需移除。"));
    }
    return;
  }
  if (platform() === "win32") {
    console.log(c.gray('  卸载命令: schtasks /Delete /TN "cc-prewarm" /F'));
  } else {
    console.log(c.gray("  请从 crontab 中移除 cc-prewarm 相关行（运行 crontab -e）。"));
  }
}
