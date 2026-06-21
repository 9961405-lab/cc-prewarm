import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { collectTimestamps } from "./scan.js";
import { buildHistogram, recommend, fmtHour } from "./analyze.js";
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

    const { timestamps, found } = await collectTimestamps();

    let rec;
    let defaultHour = 6;

    if (!found || timestamps.length < 10) {
      console.log(c.yellow("数据不足"));
      console.log("");
      console.log(c.gray("  还没有足够的本地使用记录（需要用几天 Claude Code 积累数据）。"));
      console.log(c.gray("  没关系，我们手动设定就行！"));
      console.log("");

      const workStart = await ask(rl, "你每天几点开始用 Claude Code？（输入 0-23 的数字，如 9 代表上午 9 点）", "9");
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

      const { hours, total, days } = buildHistogram(timestamps);
      rec = recommend(hours);
      defaultHour = rec.trigger;

      console.log(c.gray(`  找到 ${total} 条事件，跨 ${days} 天。你的 24 小时使用分布：`));
      console.log("");
      histogram(hours, rec.peak);
      console.log("");
      console.log("  " + c.green("✓") + " 峰值时段: " + c.bold(fmtHour(rec.peak.start) + "–" + fmtHour(rec.peak.end)) +
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

    console.log(c.gray(`  系统根据你的使用习惯，推荐每天 ${c.bold(c.cyan(fmtHour(defaultHour)))} 自动触发预热。`));
    console.log(c.gray("  直接按回车使用推荐时间，或输入 0-23 的数字修改。"));
    console.log("");
    const hourInput = await ask(rl, `每天几点触发预热？`, fmtHour(defaultHour));
    const parsed = parseInt(hourInput, 10);
    const hour = Math.max(0, Math.min(23, isNaN(parsed) ? defaultHour : parsed));

    console.log("");
    const agentInput = await ask(rl, "你用的是哪个？[1] Claude Code  [2] Codex", "1");
    const agent = agentInput === "2" ? "codex" : "claude";
    const agentLabel = agent === "claude" ? "Claude Code" : "Codex";

    console.log("");
    console.log(c.gray("  ┌─────────────────────────────────────┐"));
    console.log(c.gray("  │") + "  触发时间:  " + c.bold(c.cyan(fmtHour(hour))) + " 每天自动执行" + c.gray("       │"));
    console.log(c.gray("  │") + "  目标工具:  " + c.bold(agentLabel) + c.gray("                       │".slice(agentLabel.length)));
    console.log(c.gray("  │") + "  执行内容:  发一条极短消息开启窗口" + c.gray("  │"));
    console.log(c.gray("  └─────────────────────────────────────┘"));
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

    await install({ hour, agent });

    // ── Verify trigger ──
    console.log("");
    const testNow = await confirm(rl, "要现在测试一次触发吗？（会发一条极短消息）");
    if (testNow) {
      console.log("");
      await trigger({ agent });
    }

    // ── Done ──
    console.log("");
    console.log(c.bold(c.green("  ✅ 全部搞定！")));
    console.log("");
    console.log(c.gray("  从明天起，系统会在每天 " + fmtHour(hour) + " 自动帮你预热窗口。"));
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
