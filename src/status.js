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
    console.log(c.gray("  No local activity found — can't estimate the window."));
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
    d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", weekday: "short" });

  if (now < reset) {
    const mins = Math.round((reset - now) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    console.log(`  Window opened: ${c.cyan(fmt(start))}`);
    console.log(`  Resets at:     ${c.bold(c.green(fmt(reset)))}  ${c.gray(`(in ${h}h ${m}m)`)}`);
  } else {
    console.log(c.yellow("  No active window — it expired and hasn't been re-opened."));
    console.log(c.gray(`  Last window opened ${fmt(start)}, expired ${fmt(reset)}.`));
    console.log(c.gray("  Run `cc-prewarm trigger` to start a fresh one now."));
  }
}
