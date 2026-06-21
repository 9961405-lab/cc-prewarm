import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { c } from "./ui.js";

const LABEL = "com.cc-prewarm.daily";
const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), "bin", "cli.js");
const NODE = process.execPath;

const plistPath = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function macPlist(hour, agent) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
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
    const path = plistPath();
    if (dryRun) {
      console.log(c.yellow(`  [dry-run] would write launchd plist → ${path}`));
      console.log(c.gray(`  [dry-run] would run: launchctl load ${path}`));
      console.log(c.gray("  Fires daily at " + hh + ":00 via " + agent + ". plist contents:\n"));
      console.log(macPlist(hour, agent).replace(/^/gm, "    "));
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, macPlist(hour, agent));
    spawnSync("launchctl", ["unload", path], { stdio: "ignore" });
    const r = spawnSync("launchctl", ["load", path], { stdio: "ignore" });
    if (r.status === 0) {
      console.log(c.green(`  ✓ Installed launchd job — fires daily at ${hh}:00 via ${agent}`));
      console.log(c.gray(`    plist: ${path}`));
      console.log(c.gray(`    logs:  ~/.cc-prewarm.log`));
      console.log(c.gray(`    remove with: cc-prewarm uninstall`));
    } else {
      console.log(c.yellow("  Wrote plist but launchctl load failed. Load it manually:"));
      console.log(c.gray(`    launchctl load ${path}`));
    }
    return;
  }

  if (os === "linux") {
    const line = `0 ${hour} * * * ${NODE} ${CLI} trigger --agent=${agent}`;
    console.log(c.bold("  Add this cron line (crontab -e):"));
    console.log("");
    console.log("    " + c.cyan(line));
    console.log("");
    console.log(c.gray("  Or run: (crontab -l 2>/dev/null; echo '" + line + "') | crontab -"));
    return;
  }

  // Windows
  const cmd = `schtasks /Create /SC DAILY /TN "cc-prewarm" /TR "\\"${NODE}\\" \\"${CLI}\\" trigger --agent=${agent}" /ST ${hh}:00`;
  console.log(c.bold("  Run this in PowerShell / cmd to create the scheduled task:"));
  console.log("");
  console.log("    " + c.cyan(cmd));
  console.log("");
  console.log(c.gray('  Remove with: schtasks /Delete /TN "cc-prewarm" /F'));
}

export async function uninstall() {
  if (platform() === "darwin") {
    const path = plistPath();
    if (existsSync(path)) {
      spawnSync("launchctl", ["unload", path], { stdio: "ignore" });
      await unlink(path);
      console.log(c.green("  ✓ Removed launchd job"));
    } else {
      console.log(c.gray("  No launchd job found — nothing to remove."));
    }
    return;
  }
  if (platform() === "win32") {
    console.log(c.gray('  Remove with: schtasks /Delete /TN "cc-prewarm" /F'));
  } else {
    console.log(c.gray("  Remove the cc-prewarm line from your crontab (crontab -e)."));
  }
}
