import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { collectTimestamps } from "./scan.js";
import { buildHistogram, recommend, peakWindow, fmtHour } from "./analyze.js";
import { histogram, banner, c } from "./ui.js";
import { install } from "./install.js";
import { trigger } from "./trigger.js";

async function ask(rl, question, fallback) {
  try {
    const answer = (await rl.question(c.bold("  ? ") + question + c.gray(fallback ? ` (${fallback}) ` : " "))).trim();
    return answer || fallback;
  } catch { return fallback; }
}

async function confirm(rl, question) {
  try {
    const answer = (await rl.question(c.bold("  ? ") + question + c.gray(" (Y/n) "))).trim().toLowerCase();
    return answer !== "n" && answer !== "no";
  } catch { return true; }
}

async function pause(rl, msg) {
  try { await rl.question(c.gray("  " + (msg || "按回车继续 ↵ "))); } catch {}
}

export async function wizard() {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log("");
    console.log(c.bold(c.cyan("  ⚡ cc-prewarm 设置向导")));
    console.log(c.gray("  ─────────────────────────"));
    console.log("");
    console.log("  这个工具帮你把 Claude Code / Codex 的 5 小时额度窗口");
    console.log("  重置点移到工作时段中间，让你在高峰期享受" + c.bold(c.cyan("双倍额度")) + "。");
    console.log("");
    console.log(c.gray("  整个设置只需 3 步，1 分钟搞定。"));
    console.log("");
    await pause(rl);

    // ── Step 1: Scan ──
    console.log("");
    console.log(c.bold("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(c.bold("  STEP 1/3  ") + "分析你的使用习惯");
    console.log(c.bold("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log("");
    process.stdout.write(c.gray("  正在扫描本地数据（只读时间戳，不读消息内容）… "));

    const { found, agents } = await collectTimestamps();
    const allTs = [...(agents.claude?.timestamps || []), ...(agents.codex?.timestamps || [])];

    let rec;
    let defaultHour = 6;
    let detectedAgents = [];
    const recByAgent = {};

    if (!found || allTs.length < 10) {
      console.log(c.yellow("数据不足"));
      console.log("");
      console.log(c.gray("  还没有足够的本地使用记录（需要用几天 Claude Code / Codex 积累数据）。"));
      console.log(c.gray("  没关系，我们手动设定就行！"));
      console.log("");

      const workStart = await ask(rl, "你每天几点开始工作？（输入 0-23 的数字，如 9 代表上午 9 点）", "9");
      const h = parseInt(workStart, 10);
      if (!isNaN(h) && h >= 0 && h <= 23) {
        defaultHour = ((h - 3) % 24 + 24) % 24;
      }
      console.log("");
      console.log("  " + c.green("✓") + " 根据你的工作时间，建议在 " + c.bold(c.cyan(fmtHour(defaultHour))) + " 触发");
      console.log(c.gray(`    (工作前 3 小时触发 → 窗口在 ${fmtHour(h)}–${fmtHour(h + 4)} 中间重置)`));
    } else {
      console.log(c.green("完成！"));
      console.log("");

      for (const [agent, data] of Object.entries(agents)) {
        if (data.timestamps.length >= 10) {
          detectedAgents.push(agent);
          const { hours, total, days } = buildHistogram(data.timestamps);
          const peak = peakWindow(hours);
          const agentRec = recommend(hours);
          recByAgent[agent] = agentRec;
          console.log(c.bold(`  📊 ${data.label}`) + c.gray(` — ${total} 条事件，跨 ${days} 天`));
          console.log("");
          histogram(hours, peak);
          console.log("");
          console.log("    " + c.green("✓") + " 高峰: " + c.bold(fmtHour(peak.start) + "–" + fmtHour(peak.end)) +
            c.gray(` (${Math.round((peak.sum / total) * 100)}%)`) +
            "  建议触发: " + c.bold(c.cyan(fmtHour(agentRec.trigger))) +
            c.gray(` (${agentRec.naiveWindows}→${agentRec.smartWindows} 窗口)`));
          console.log("");
        } else if (data.found && data.timestamps.length > 0) {
          console.log(c.gray(`  ${data.label}: 仅 ${data.timestamps.length} 条事件，数据不足。`));
          console.log("");
        }
      }

      // Combined recommendation
      const { hours, total, days } = buildHistogram(allTs);
      rec = recommend(hours);
      defaultHour = rec.trigger;

      if (detectedAgents.length > 1) {
        console.log(c.bold("  📊 综合分析") + c.gray(` — 两个工具合计 ${total} 条事件，跨 ${days} 天`));
        console.log("");
      }
      console.log("  " + c.green("✓") + " 综合峰值: " + c.bold(fmtHour(rec.peak.start) + "–" + fmtHour(rec.peak.end)) +
        c.gray(` (${Math.round((rec.peak.sum / total) * 100)}% 的使用量集中在这)`));
      console.log("  " + c.green("✓") + " 推荐触发: " + c.bold(c.cyan(fmtHour(rec.trigger))) +
        c.gray(` (提前 ${rec.lead}h → 窗口在高峰中间重置)`));
      console.log("  " + c.green("✓") + " 效果: 高峰期额度窗口 " +
        c.gray(rec.naiveWindows + " → ") + c.bold(c.cyan(rec.smartWindows)) +
        c.gray(` (${rec.multiplier.toFixed(1)}× 提升)`));
    }

    console.log("");
    await pause(rl);

    // ── Step 2: Confirm settings ──
    console.log("");
    console.log(c.bold("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(c.bold("  STEP 2/3  ") + "确认设置");
    console.log(c.bold("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log("");

    // First: which tool(s)? Each has its own independent quota window.
    const hasBoth = detectedAgents.length === 2;
    const defaultAgent = hasBoth ? "3" : detectedAgents.includes("codex") ? "2" : "1";
    if (hasBoth) {
      console.log(c.gray("  检测到你同时使用 Claude Code 和 Codex，已默认选择「两个都用」。"));
      console.log("");
    }
    const agentInput = await ask(rl, "你用的是哪个？[1] Claude Code  [2] Codex  [3] 两个都用", defaultAgent);
    const selectedAgents = agentInput === "3" ? ["claude", "codex"]
      : agentInput === "2" ? ["codex"]
      : ["claude"];

    const labelOf = (agent) => (agent === "claude" ? "Claude Code" : "Codex");

    // Each tool has its own 5h window, so each gets its own trigger time —
    // we ask per-agent, pre-filled with that agent's own recommendation.
    console.log("");
    console.log(c.gray("  每个工具的额度窗口是独立的，所以分别设定触发时间。"));
    console.log(c.gray("  直接按回车使用推荐时间，或输入 0-23 的数字修改。"));
    console.log("");
    const schedule = {};
    for (const agent of selectedAgents) {
      const recHour = recByAgent[agent] ? recByAgent[agent].trigger : defaultHour;
      const input = await ask(rl, `${labelOf(agent)} 每天几点触发预热？`, fmtHour(recHour));
      const p = parseInt(input, 10);
      schedule[agent] = Math.max(0, Math.min(23, isNaN(p) ? recHour : p));
    }

    console.log("");
    console.log(c.gray("  即将安装以下定时任务："));
    console.log("");
    for (const agent of selectedAgents) {
      console.log("    " + c.cyan("•") + " " + c.bold(labelOf(agent)) +
        c.gray(" — 每天 ") + c.bold(c.cyan(fmtHour(schedule[agent]))) +
        c.gray(" 自动发一条极短消息，开启 5h 窗口"));
    }
    console.log("");

    const ok = await confirm(rl, "确认以上设置？");
    if (!ok) {
      console.log("");
      console.log(c.gray("  已取消。随时可以重新运行 cc-prewarm 再来。"));
      console.log("");
      return;
    }

    // ── Step 3: Install ──
    console.log("");
    console.log(c.bold("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log(c.bold("  STEP 3/3  ") + "安装定时任务");
    console.log(c.bold("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
    console.log("");

    for (const agent of selectedAgents) {
      await install({ hour: schedule[agent], agent });
    }

    // ── Verify trigger ──
    console.log("");
    const testNow = await confirm(rl, "要现在测试一次触发吗？（会发一条极短消息）");
    if (testNow) {
      console.log("");
      for (const agent of selectedAgents) {
        await trigger({ agent });
      }
    }

    // ── Done ──
    console.log("");
    console.log(c.bold(c.green("  ✅ 全部搞定！")));
    console.log("");
    console.log(c.gray("  从明天起，系统会自动帮你预热窗口："));
    for (const agent of selectedAgents) {
      console.log(c.gray(`    ${labelOf(agent)} — 每天 ${fmtHour(schedule[agent])}`));
    }
    console.log(c.gray("  你什么都不用做，额度窗口会在工作时段中间自动重置。"));
    console.log("");
    console.log(c.gray("  其他命令："));
    console.log(c.gray("    cc-prewarm status      查看当前窗口何时重置"));
    console.log(c.gray("    cc-prewarm trigger      手动立刻开一个新窗口"));
    console.log(c.gray("    cc-prewarm uninstall    不想用了，移除定时任务"));
    console.log("");
  } finally {
    rl.close();
  }
}
