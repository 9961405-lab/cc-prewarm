import { c } from "./ui.js";

const WINDOW_MS = 5 * 60 * 60 * 1000;

// Estimate the current window's reset time from local activity alone.
// The window is anchored to the first message after the previous one expired
// and lasts exactly 5h regardless of idle gaps. So we find the latest "opener"
// — a message whose predecessor was >5h earlier (or none) — and add 5h.
//
// This is a best-effort *estimate* from local logs, not the live billing API.
// Confidence buckets:
//   高 — opener is recent (last 12h) and surrounded by activity → almost certainly real
//   中 — opener fits the data but is older / sparse, may have missed events
//   低 — only a single event, or local records are clearly partial
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

  // Confidence — see comment block above.
  const eventsInWindow = ts.length - openerIdx;
  const ageH = (now - start) / 3600_000;
  let confidence;
  if (eventsInWindow >= 5 && ageH <= 12) confidence = { label: "高", color: c.green };
  else if (eventsInWindow >= 2 && ageH <= 36) confidence = { label: "中", color: c.cyan };
  else confidence = { label: "低", color: c.yellow };

  const fmt = (d) =>
    d.toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", weekday: "short" });

  if (now < reset) {
    const mins = Math.round((reset - now) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    console.log(`  窗口开启于: ${c.cyan(fmt(start))}`);
    console.log(
      `  重置时间:   ${c.bold(c.green(fmt(reset)))}  ${c.gray(`(还剩 ${h}小时${m}分钟)`)}`,
    );
  } else {
    console.log(c.yellow("  当前没有活跃窗口 — 已过期，尚未重新开启。"));
    console.log(c.gray(`  上次窗口开启于 ${fmt(start)}，过期于 ${fmt(reset)}。`));
    console.log(c.gray("  运行 cc-prewarm trigger 可立即开启新窗口。"));
  }
  console.log(
    c.gray("  置信度: ") + confidence.color(confidence.label) +
    c.gray(`  (依据 ${eventsInWindow} 条本地事件估算，非官方账单数据)`),
  );
}
