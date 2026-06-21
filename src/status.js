import { c } from "./ui.js";

const WINDOW_MS = 5 * 60 * 60 * 1000;

// Estimate the current window's reset time from local telemetry alone.
// The window is anchored to the first message after the previous one expired and
// lasts exactly 5h regardless of idle gaps. So we find the latest "opener" — a
// message whose predecessor was >5h earlier (or none) — and add 5h.
//
// This is a best-effort *estimate* from local logs, not the live billing API.
export function status(timestamps) {
  if (timestamps.length === 0) {
    console.log(c.gray("  未找到本地活动记录，无法估算窗口状态。"));
    return;
  }
  const ts = [...timestamps].sort((a, b) => a - b);
  const now = new Date();

  let openerIdx = 0;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] > WINDOW_MS) openerIdx = i;
  }
  const start = ts[openerIdx];
  const reset = new Date(start.getTime() + WINDOW_MS);

  const fmt = (d) =>
    d.toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", weekday: "short" });

  if (now < reset) {
    const mins = Math.round((reset - now) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    console.log(`  窗口开启于: ${c.cyan(fmt(start))}`);
    console.log(`  重置时间:   ${c.bold(c.green(fmt(reset)))}  ${c.gray(`(还剩 ${h}小时${m}分钟)`)}`);
  } else {
    console.log(c.yellow("  当前没有活跃窗口 — 已过期，尚未重新开启。"));
    console.log(c.gray(`  上次窗口开启于 ${fmt(start)}，过期于 ${fmt(reset)}。`));
    console.log(c.gray("  运行 cc-prewarm trigger 可立即开启新窗口。"));
  }
}
