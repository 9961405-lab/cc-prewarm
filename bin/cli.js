#!/usr/bin/env node
import { collectTimestamps, collectForAgent } from "../src/scan.js";
import { buildHistogram, recommend, peakWindow, fmtHour } from "../src/analyze.js";
import { histogram, banner, c } from "../src/ui.js";
import { install, uninstall } from "../src/install.js";
import { status } from "../src/status.js";
import { trigger } from "../src/trigger.js";
import { wizard } from "../src/wizard.js";

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
${c.bold(c.cyan("⚡ cc-prewarm"))} ${c.gray("— 让 Claude Code / Codex 的 5 小时额度窗口翻倍")}

${c.bold("快速开始:")}
  cc-prewarm                    ${c.green("← 交互式设置向导（推荐）")}

${c.bold("命令:")}
  cc-prewarm ${c.cyan("setup")}              交互式设置向导（等同于直接运行 cc-prewarm）
  cc-prewarm ${c.cyan("analyze")}            分析本地使用习惯，推荐最佳触发时间
  cc-prewarm ${c.cyan("install")}            安装每日定时预热任务
  cc-prewarm ${c.cyan("trigger")}            立即发送一条预热消息
  cc-prewarm ${c.cyan("status")}             查看当前窗口何时重置
  cc-prewarm ${c.cyan("uninstall")}          移除定时任务

${c.bold("选项:")}
  --agent=claude|codex     通过哪个工具预热（默认: claude）
  --hour=N                 指定触发时间（0-23，覆盖自动推荐）
  --lead=N                 提前于高峰几小时触发（默认: 3）
  --dry-run                仅展示将执行的操作，不实际安装

${c.gray("5 小时窗口从你发第一条消息时开始计时，过期后不会自动重启。")}
${c.gray("提前发一条预热消息，让重置点落在工作时段中间，高峰期即可")}
${c.gray("享受两个窗口的额度。")}
`);
}

function showAgentProfile(label, data, lead) {
  const { hours, total, days } = buildHistogram(data.timestamps);
  const peak = peakWindow(hours);
  const rec = recommend(hours, lead);

  banner(`${label} 使用画像`);
  console.log(c.gray(`  ${total} 条事件，跨 ${days} 天  (${data.dir})\n`));
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

  // Combined recommendation from all data
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

  // Only one agent had enough data
  const only = results.claude || results.codex;
  if (only && !silent) {
    console.log(c.gray("  下一步:  ") + c.cyan(`cc-prewarm install --hour=${only.trigger}`));
    console.log("");
  }
  return only ? { ...only, perAgent: results } : null;
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
        hour = rec ? rec.trigger : 6;
        console.log(
          c.gray(rec ? `\n  使用分析推荐的触发时间: ${String(hour).padStart(2, "0")}:00` : `\n  无数据，使用默认时间 06:00`)
        );
      }
      await install({ hour, agent, dryRun: !!args["dry-run"] });
      break;
    }

    case "trigger":
      await trigger({ agent, message: args.message });
      break;

    case "status": {
      const { timestamps } = await collectTimestamps();
      banner("窗口状态");
      status(timestamps);
      console.log("");
      break;
    }

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
