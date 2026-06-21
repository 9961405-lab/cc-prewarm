// Tiny ANSI helpers + the usage histogram renderer. Zero dependencies.
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  blue: wrap("34"),
  cyan: wrap("36"),
  green: wrap("32"),
  yellow: wrap("33"),
  red: wrap("31"),
  gray: wrap("90"),
};

export function banner(title) {
  console.log("");
  console.log(c.bold(c.cyan("  ⚡ " + title)));
  console.log(c.gray("  " + "─".repeat(title.length + 4)));
}

// Horizontal hour-by-hour bar chart. Peak hours are highlighted.
export function histogram(hours, peak) {
  const max = Math.max(1, ...hours);
  const inPeak = (h) => {
    const s = peak.start;
    const e = peak.end <= s ? peak.end + 24 : peak.end;
    const hh = h < s ? h + 24 : h;
    return hh >= s && hh < e;
  };
  for (let h = 0; h < 24; h++) {
    const v = hours[h];
    const len = Math.round((v / max) * 32);
    const bar = "█".repeat(len);
    const label = String(h).padStart(2, "0") + ":00";
    const colored = v === 0 ? c.gray(bar || "·") : inPeak(h) ? c.cyan(bar) : c.blue(bar);
    const count = v === 0 ? c.gray("   0") : String(v).padStart(4);
    const tag = inPeak(h) && v > 0 ? c.yellow("  ◀ peak") : "";
    console.log("  " + c.gray(label) + " " + count + "  " + colored + tag);
  }
}
