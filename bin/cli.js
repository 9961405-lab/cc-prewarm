#!/usr/bin/env node
import { collectTimestamps } from "../src/scan.js";
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
${c.bold(c.cyan("⚡ cc-prewarm"))} ${c.gray("— double your Claude Code / Codex 5-hour windows")}

${c.bold("Quick start:")}
  cc-prewarm                    ${c.green("← interactive setup wizard (recommended)")}

${c.bold("Commands:")}
  cc-prewarm ${c.cyan("setup")}              Interactive setup wizard (same as bare cc-prewarm)
  cc-prewarm ${c.cyan("analyze")}            Scan local usage, recommend a trigger time
  cc-prewarm ${c.cyan("install")}            Schedule the daily prewarm (uses analyze's pick)
  cc-prewarm ${c.cyan("trigger")}            Fire one prewarm message now
  cc-prewarm ${c.cyan("status")}             Estimate when your current window resets
  cc-prewarm ${c.cyan("uninstall")}          Remove the scheduled job

${c.bold("Options:")}
  --agent=claude|codex     Which CLI to prewarm through (default: claude)
  --hour=N                 Override the trigger hour for install (0-23)
  --lead=N                 Hours before peak to fire (default: 3)
  --dry-run                Show what install would do, without scheduling anything

${c.gray("The 5-hour window starts on your first message and never auto-restarts.")}
${c.gray("Fire one throwaway message before your peak hours and the reset lands")}
${c.gray("mid-workday — so peak time spans two windows instead of one.")}
`);
}

async function cmdAnalyze(args, { silent } = {}) {
  const { timestamps, found } = await collectTimestamps();
  if (!found || timestamps.length === 0) {
    if (!silent) {
      console.log(c.yellow("\n  No local telemetry found at ~/.claude/telemetry."));
      console.log(c.gray("  Use Claude Code for a day or two, then run analyze again.\n"));
    }
    return null;
  }
  const { hours, total, days } = buildHistogram(timestamps);
  const peak = peakWindow(hours);
  const lead = args.lead ? Number(args.lead) : 3;
  const rec = recommend(hours, lead);

  if (silent) return rec;

  banner("Your usage profile");
  console.log(c.gray(`  ${total} events across ${days} day(s) of local telemetry\n`));
  histogram(hours, peak);

  banner("Recommendation");
  console.log(
    `  Peak hours:   ${c.bold(fmtHour(peak.start) + "–" + fmtHour(peak.end))} ` +
      c.gray(`(${Math.round((peak.sum / total) * 100)}% of your usage)`)
  );
  console.log(
    `  Trigger at:   ${c.bold(c.green(fmtHour(rec.trigger)))} ` +
      c.gray(`(${lead}h before peak → resets mid-peak)`)
  );
  console.log(
    `  Windows hit:  ${c.gray(rec.naiveWindows + " → ")}${c.bold(c.cyan(rec.smartWindows))} ` +
      c.gray(`during peak  (${rec.multiplier.toFixed(1)}× more)`)
  );
  console.log("");
  console.log(c.gray("  Next:  ") + c.cyan(`cc-prewarm install --hour=${rec.trigger}`));
  console.log("");
  return rec;
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
          c.gray(rec ? `\n  Using analyzed trigger hour: ${String(hour).padStart(2, "0")}:00` : `\n  No data — defaulting to 06:00`)
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
      banner("Window status");
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
