#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { collectTimestamps } from "../src/scan.js";
import { buildHistogram, recommend, peakWindow, fmtHour } from "../src/analyze.js";
import { histogram, banner, c } from "../src/ui.js";
import { install, uninstall, checkInstalled, STABLE_DIR, labelFor } from "../src/install.js";
import { status } from "../src/status.js";
import { trigger } from "../src/trigger.js";
import { wizard } from "../src/wizard.js";
import { lastResults, recentStats, readHistory, HISTORY_PATH } from "../src/state.js";

const LOG_PATH = join(homedir(), ".cc-prewarm.log");

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out[k] = v === undefined ? true : v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function help() {
  console.log(`
${c.bold(c.cyan("⚡ cc-prewarm"))} ${c.gray("— 让 Claude Code / Codex 的 5 小时额度窗口在高峰中间重置")}

${c.bold("快速开始:")}
  cc-prewarm                    ${c.green("← 交互式设置向导（推荐）")}

${c.bold("命令:")}
  cc-prewarm ${c.cyan("setup")}              交互式设置向导（等同于直接运行 cc-prewarm）
  cc-prewarm ${c.cyan("analyze")}            分析本地使用习惯，推荐最佳触发时间
  cc-prewarm ${c.cyan("install")}            安装每日定时预热任务
  cc-prewarm ${c.cyan("trigger")}            立即发送一条预热消息
  cc-prewarm ${c.cyan("status")}             查看当前窗口状态 + 最近 7 天成功率
  cc-prewarm ${c.cyan("doctor")}             体检 node / claude / codex / 定时任务 / 睡眠唤醒
  cc-prewarm ${c.cyan("logs")}               查看最近的触发日志 (~/.cc-prewarm.log)
  cc-prewarm ${c.cyan("history")}            查看最近触发记录与失败原因聚合
  cc-prewarm ${c.cyan("uninstall")}          移除定时任务

${c.bold("选项:")}
  --agent=claude|codex     通过哪个工具预热（默认: claude）
  --hour=N                 指定触发时间（0-23，覆盖自动推荐）
  --lead=N                 提前于高峰几小时触发（默认: 3）
  --days=N                 history/status 看最近几天（默认: 7）
  --verbose                trigger 时直接显示 agent 的全部输出（调试 exit 1 用）
  --dry-run                仅展示将执行的操作，不实际安装

${c.gray("原理：5 小时窗口从第一条消息开始计时、过期不自动重启。")}
${c.gray("提前发一条「预热」消息，让重置点落在你高峰时段中间，")}
${c.gray("高峰可能因此横跨两个窗口，有效缓解额度紧张。")}
`);
}

function showAgentProfile(label, data, lead) {
  const { hours, total, days } = buildHistogram(data.timestamps);
  const peak = peakWindow(hours);
  const rec = recommend(hours, lead);

  banner(`${label} 使用画像`);
  const excluded = data.prewarmExcluded
    ? c.gray(`，已剔除 ${data.prewarmExcluded} 条预热产生的记录`)
    : "";
  console.log(c.gray(`  ${total} 条事件，跨 ${days} 天${excluded}  (${data.dir})\n`));
  histogram(hours, peak);
  console.log("");
  console.log(
    `  高峰时段:   ${c.bold(fmtHour(peak.start) + "–" + fmtHour(peak.end))} ` +
      c.gray(`(${Math.round((peak.sum / total) * 100)}% 集中)`)
  );
  console.log(
    `  建议触发:   ${c.bold(c.green(fmtHour(rec.trigger)))} ` +
      c.gray(`(提前 ${lead}h → ${rec.naiveWindows} → ${rec.smartWindows} 窗口，${rec.multiplier.toFixed(1)}×)`)
  );
  console.log("");
  return rec;
}

async function cmdAnalyze(args, { silent } = {}) {
  const { found, agents } = await collectTimestamps();
  const lead = args.lead ? Number(args.lead) : 3;

  if (!found) {
    if (!silent) {
      console.log(c.yellow("\n  未找到本地数据。"));
      console.log(c.gray("  ~/.claude/telemetry (Claude Code)"));
      console.log(c.gray("  ~/.codex/sessions   (Codex)"));
      console.log(c.gray("  请先使用一两天积累数据，然后再运行 analyze。\n"));
    }
    return null;
  }

  const results = {};
  for (const [agent, data] of Object.entries(agents)) {
    if (data.timestamps.length >= 10) {
      const { hours } = buildHistogram(data.timestamps);
      results[agent] = recommend(hours, lead);
      if (!silent) showAgentProfile(data.label, data, lead);
    } else if (!silent && data.found) {
      console.log(c.gray(`  ${data.label}: 仅 ${data.timestamps.length} 条事件，数据不足，跳过。\n`));
    }
  }

  const allTs = [...agents.claude.timestamps, ...agents.codex.timestamps];
  if (allTs.length >= 10) {
    const { hours, total, days } = buildHistogram(allTs);
    const combinedRec = recommend(hours, lead);

    if (!silent && Object.keys(results).length > 1) {
      banner("综合推荐（两个工具合并分析）");
      console.log(c.gray(`  合计 ${total} 条事件，跨 ${days} 天\n`));
      const peak = peakWindow(hours);
      histogram(hours, peak);
      console.log("");
    }

    if (!silent) {
      banner("最终推荐");
      const peak = peakWindow(hours);
      console.log(
        `  高峰时段:   ${c.bold(fmtHour(peak.start) + "–" + fmtHour(peak.end))} ` +
          c.gray(`(${Math.round((peak.sum / total) * 100)}% 的使用量集中在这)`)
      );
      console.log(
        `  触发时间:   ${c.bold(c.green(fmtHour(combinedRec.trigger)))} ` +
          c.gray(`(提前 ${lead}h → 窗口在高峰中间重置)`)
      );
      console.log(
        `  窗口数量:   ${c.gray(combinedRec.naiveWindows + " → ")}${c.bold(c.cyan(combinedRec.smartWindows))} ` +
          c.gray(`个窗口覆盖高峰  (${combinedRec.multiplier.toFixed(1)}× 提升)`)
      );
      console.log("");
      console.log(c.gray("  下一步:  ") + c.cyan(`cc-prewarm install --hour=${combinedRec.trigger}`));
      console.log("");
    }

    return { ...combinedRec, perAgent: results };
  }

  const only = results.claude || results.codex;
  if (only && !silent) {
    console.log(c.gray("  下一步:  ") + c.cyan(`cc-prewarm install --hour=${only.trigger}`));
    console.log("");
  }
  return only ? { ...only, perAgent: results } : null;
}

async function cmdStatus(args) {
  const { agents } = await collectTimestamps();
  const last = await lastResults();
  const health = checkInstalled();
  const days = args.days ? Number(args.days) : 7;
  const stats = await recentStats(days);

  banner("窗口状态");
  let any = false;
  for (const [key, data] of Object.entries(agents)) {
    if (!data.found || data.timestamps.length === 0) continue;
    any = true;
    console.log(c.bold(`  ${data.label}`) + c.gray("  (各工具的额度窗口相互独立)"));
    status(data.timestamps);
    const lr = last[key];
    if (lr) {
      const when = new Date(lr.ts).toLocaleString("zh-CN", { hour12: false });
      console.log(
        lr.ok
          ? c.gray(`  最近一次预热: ${when}  `) + c.green("成功 ✓")
          : c.gray(`  最近一次预热: ${when}  `) + c.red(`失败：${lr.reason || lr.code}`),
      );
    }
    const s = stats[key];
    if (s) {
      const pct = Math.round(s.successRate * 100);
      const colorRate = pct >= 90 ? c.green : pct >= 60 ? c.yellow : c.red;
      console.log(
        c.gray(`  最近 ${days} 天: ${s.ok}/${s.total} 成功，成功率 `) + colorRate(`${pct}%`),
      );
    }
    const h = health[key];
    if (h && !h.nodeOk) {
      console.log(c.red(`  ⚠ 定时任务依赖的 node 已失效: ${h.nodePath}`));
      console.log(c.gray("    请重新运行 cc-prewarm install 修复。"));
    }
    if (h && !h.cliOk) {
      console.log(c.red(`  ⚠ 定时任务依赖的 cli.js 不存在: ${h.cliPath}`));
      console.log(c.gray("    请重新运行 cc-prewarm install 把应用固化到 ~/.cc-prewarm/app。"));
    }
    console.log("");
  }
  if (!any) {
    console.log(c.gray("  未找到本地活动记录，无法估算窗口状态。"));
    console.log("");
  }
}

// ── doctor ──────────────────────────────────────────────────────────────────
function ok(msg)   { console.log("  " + c.green("✓ ") + msg); }
function warn(msg) { console.log("  " + c.yellow("⚠ ") + msg); }
function bad(msg)  { console.log("  " + c.red("✗ ") + msg); }
function info(msg) { console.log("  " + c.gray("• ") + c.gray(msg)); }

// Same search dirs the trigger uses — system `which` misses ~/bin under
// minimal PATHs, so we replicate the lookup here.
const WHICH_DIRS = [
  join(homedir(), "bin"),
  join(homedir(), ".claude", "local"),
  join(homedir(), ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
];
function which(cmd) {
  const seen = new Set();
  const dirs = [...(process.env.PATH || "").split(":").filter(Boolean), ...WHICH_DIRS];
  for (const d of dirs) {
    if (seen.has(d)) continue;
    seen.add(d);
    const p = join(d, cmd);
    if (existsSync(p)) return p;
  }
  return null;
}

async function cmdDoctor() {
  banner("体检");

  // node
  const node = process.execPath;
  const nodeTransient = ["/tmp/", "/private/tmp/", "/var/folders/"].some((p) => node.includes(p));
  if (nodeTransient) {
    warn(`当前 node 在临时位置: ${node}`);
    info(`建议把它复制到 ~/bin/node 或安装 Homebrew node 后重新 cc-prewarm install`);
  } else {
    ok(`node: ${node}`);
  }

  // agent CLIs
  for (const a of ["claude", "codex"]) {
    const w = which(a);
    if (w) ok(`${a}: ${w}`);
    else warn(`未找到 ${a} 命令（如果你不用 ${a} 则可忽略）`);
  }

  // installed jobs
  const health = checkInstalled();
  if (platform() !== "darwin") {
    info("非 macOS — 跳过 launchd 检查");
  } else if (Object.keys(health).length === 0) {
    warn("未安装任何定时任务。运行 cc-prewarm 启动向导。");
  } else {
    for (const [agent, h] of Object.entries(health)) {
      const hh = String(h.hour).padStart(2, "0");
      if (h.nodeOk && h.cliOk) {
        ok(`${agent} 定时任务: 每天 ${hh}:00，node + cli 路径有效${h.stable ? "（已固化到 ~/.cc-prewarm/app）" : ""}`);
        // Verify launchctl knows about it.
        const list = spawnSync("launchctl", ["list", labelFor(agent)], { stdio: "ignore" });
        if (list.status !== 0) {
          warn(`${agent} 任务文件存在，但 launchctl 没注册（重启 Mac 或重新 install）`);
        }
      } else {
        if (!h.nodeOk) bad(`${agent} 定时任务的 node 路径已失效: ${h.nodePath}`);
        if (!h.cliOk) bad(`${agent} 定时任务的 cli.js 不存在: ${h.cliPath}`);
        info("修复：运行 cc-prewarm install");
      }
    }
  }

  // stable dir
  if (existsSync(STABLE_DIR)) ok(`应用固化目录存在: ${STABLE_DIR}`);
  else warn(`应用尚未固化到 ${STABLE_DIR}（运行 cc-prewarm install 时会自动固化）`);

  // pmset wake (macOS only)
  if (platform() === "darwin") {
    const r = spawnSync("pmset", ["-g", "sched"], { encoding: "utf8" });
    const text = r.stdout || "";
    if (/wakepoweron at/i.test(text) || /wake at \d/i.test(text)) {
      ok("已配置 pmset 定时唤醒（睡眠时也能准点触发）");
    } else {
      warn("未配置 pmset 定时唤醒 — 如果 Mac 经常在触发时段睡眠，预热不会准点触发");
      info("修复（管理员密码）：sudo pmset repeat wakeorpoweron MTWRFSU 05:58:00");
    }
  }

  console.log("");
}

// ── logs ────────────────────────────────────────────────────────────────────
async function cmdLogs(args) {
  const n = args.tail ? Number(args.tail) : 20;
  if (!existsSync(LOG_PATH)) {
    console.log(c.gray(`  ${LOG_PATH} 还不存在 — 跑一次 cc-prewarm trigger 就有了。`));
    return;
  }
  const text = await readFile(LOG_PATH, "utf8");
  const lines = text.split("\n").filter(Boolean).slice(-n);
  banner(`触发日志（最近 ${lines.length} 行）`);
  for (const line of lines) {
    if (/失败|未找到|超时|退出码 [1-9]/.test(line)) console.log("  " + c.red(line));
    else if (/成功 ✓/.test(line)) console.log("  " + c.green(line));
    else console.log("  " + c.gray(line));
  }
  console.log("");
  info(`完整文件: ${LOG_PATH}`);
  console.log("");
}

// ── history ─────────────────────────────────────────────────────────────────
async function cmdHistory(args) {
  const days = args.days ? Number(args.days) : 14;
  const rows = await readHistory();
  if (rows.length === 0) {
    console.log(c.gray(`  ${HISTORY_PATH} 还没有记录。`));
    return;
  }
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const recent = rows.filter((r) => new Date(r.ts).getTime() >= cutoff);

  banner(`最近 ${days} 天触发记录`);
  if (recent.length === 0) {
    console.log(c.gray("  该时段无记录。\n"));
    return;
  }
  for (const r of recent.slice(-30)) {
    const when = new Date(r.ts).toLocaleString("zh-CN", { hour12: false });
    if (r.ok) console.log("  " + c.gray(when) + "  " + r.agent.padEnd(6) + c.green("成功 ✓"));
    else console.log("  " + c.gray(when) + "  " + r.agent.padEnd(6) + c.red(`失败：${r.reason || r.code}`));
  }
  console.log("");

  // Aggregated reasons + success rate per agent
  const stats = await recentStats(days);
  banner("汇总");
  for (const [agent, s] of Object.entries(stats)) {
    const pct = Math.round(s.successRate * 100);
    const colorRate = pct >= 90 ? c.green : pct >= 60 ? c.yellow : c.red;
    console.log(
      `  ${c.bold(agent)}: ${s.ok}/${s.total} 成功（成功率 ` + colorRate(`${pct}%`) + "）",
    );
    const reasons = Object.entries(s.reasons || {}).sort((a, b) => b[1] - a[1]);
    for (const [reason, count] of reasons) {
      console.log("    " + c.gray(`× ${count}  ${reason}`));
    }
  }
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const agent = args.agent || "claude";

  if (!cmd && !args.help && !args.h) {
    await wizard();
    return;
  }

  switch (cmd) {
    case "setup":
      await wizard();
      break;
    case "analyze":
      await cmdAnalyze(args);
      break;

    case "install": {
      let hour = args.hour !== undefined ? Number(args.hour) : null;
      if (hour === null) {
        const rec = await cmdAnalyze(args, { silent: true });
        const agentRec = rec && rec.perAgent && rec.perAgent[agent];
        hour = agentRec ? agentRec.trigger : rec ? rec.trigger : 6;
        console.log(
          c.gray(rec ? `\n  使用分析推荐的触发时间: ${String(hour).padStart(2, "0")}:00` : `\n  无数据，使用默认时间 06:00`)
        );
      }
      await install({ hour, agent, dryRun: !!args["dry-run"], nodePath: args["node-path"] });
      break;
    }

    case "trigger":
      await trigger({ agent, message: args.message, verbose: !!args.verbose });
      break;

    case "status":
      await cmdStatus(args);
      break;

    case "doctor":
      await cmdDoctor();
      break;

    case "logs":
      await cmdLogs(args);
      break;

    case "history":
      await cmdHistory(args);
      break;

    case "uninstall":
      await uninstall();
      break;

    case "help":
    case "--help":
    case "-h":
    default:
      help();
  }
}

main().catch((e) => {
  console.error(c.red("cc-prewarm error: " + e.message));
  process.exit(1);
});
