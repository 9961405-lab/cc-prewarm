# ⚡ cc-prewarm

**English | [中文](README.zh-CN.md)**

[![npm version](https://img.shields.io/npm/v/cc-prewarm.svg)](https://www.npmjs.com/package/cc-prewarm)
[![license](https://img.shields.io/npm/l/cc-prewarm.svg)](LICENSE)
[![node](https://img.shields.io/node/v/cc-prewarm.svg)](https://nodejs.org)

📖 **[Project page →](https://9961405-lab.github.io/cc-prewarm/)**

> Pre-warm the **5-hour rolling quota window** of Claude Code / Codex so it resets *in the middle of your workday* instead of when you start — so your peak hours can span **two** windows instead of one, easing rate-limit pressure.

Zero dependencies, fully local analysis, supports **Claude Code** and **Codex** side by side.

---

## How it works

Both Claude Code and Codex meter usage in a **5-hour rolling window**. The clock has two key properties:

1. It **starts the moment you send your first message**;
2. It does **not** auto-restart when the window expires — it waits until your *next* message to begin a fresh one.

Example: your peak hours are **09:00–13:00**. If you only start at 09:00, the window runs 09:00→14:00 and that whole peak is covered by just **one** window.

But if you fire one throwaway message at **06:00**, the window resets at 11:00 — right in the middle of your peak. Now 09:00–13:00 spans **two** windows. *Same working hours, two quota windows instead of one — a meaningful boost during peak, not literally 2× of everything.*

`cc-prewarm` automates this: it reads your local usage history, figures out when your peak actually is, and schedules a daily one-line "prewarm" message so the reset lands where it helps most.

---

## Install

Requires Node.js ≥ 18.

```bash
npm install -g cc-prewarm
cc-prewarm                # launch the setup wizard
```

Or run without installing globally:

```bash
npx cc-prewarm
```

Or from source (for hacking on it):

```bash
git clone https://github.com/9961405-lab/cc-prewarm.git
cd cc-prewarm
node bin/cli.js
```

To use `cc-prewarm` as a global command, symlink or wrap `bin/cli.js`, or run `npm link`.

---

## Quick start: the wizard

Just run it and follow the 3 steps:

```bash
cc-prewarm
```

The wizard will:

1. **Scan local data** — analyze Claude Code and Codex usage *separately*, draw a 24-hour histogram, and find each tool's peak;
2. **Confirm settings** — auto-detect which tool(s) you have and recommend a trigger time for each (editable);
3. **Install the scheduled job** — write the system task, with an optional immediate test.

> The two tools have **independent** quota windows, so each gets its own trigger time (e.g. Claude 06:00, Codex 17:00).

---

## Commands

```bash
cc-prewarm              # interactive setup wizard (recommended)
cc-prewarm analyze      # analyze usage, recommend trigger times (per-agent + combined)
cc-prewarm install      # install the scheduled prewarm job (stages app to ~/.cc-prewarm/app)
cc-prewarm trigger      # fire one prewarm message right now
cc-prewarm status       # window state + confidence + 7-day success rate
cc-prewarm doctor       # health check: node, agent CLIs, scheduler, pmset wake
cc-prewarm logs         # tail of ~/.cc-prewarm.log
cc-prewarm history      # recent triggers + failure-reason aggregation
cc-prewarm uninstall    # remove the scheduled job

# Common options
--agent=claude|codex    which tool to prewarm (default: claude)
--hour=N                trigger hour (0-23, overrides auto recommendation)
--lead=N                fire this many hours before peak (default: 3)
--dry-run               preview the actions without installing
```

### `analyze` example

```
  ⚡ Claude Code usage profile
  938 events across 4 days  (/Users/you/.claude/telemetry)

  09:00   92  ██████████████  ◀ peak
  10:00  115  ██████████████████  ◀ peak
  11:00  104  ████████████████  ◀ peak
  12:00  209  ████████████████████████████████  ◀ peak
  ...

  Peak hours:   09:00–13:00 (55% of usage)
  Suggested:    06:00 (3h before peak → 1 → 2 windows, 2.0×)

  ⚡ Codex usage profile
  ...analyzed independently...

  ⚡ Final recommendation
  Trigger at:   06:00 (3h before peak → resets mid-peak)
  Windows hit:  1 → 2 during peak  (2.0× more)
```

> The CLI is currently localized in Chinese; the example above is translated for readability.

---

## How it schedules

| OS | Mechanism |
|----|-----------|
| **macOS** | A LaunchAgent plist in `~/Library/LaunchAgents` (survives reboot), one per tool |
| **Linux** | prints a `crontab` line to add |
| **Windows** | prints a `schtasks` command to run |

The scheduled job runs `cc-prewarm trigger`, which sends one tiny headless message (`claude -p` or `codex exec --skip-git-repo-check --sandbox read-only`) to open the window.

### ⚠️ macOS: don't let the Mac sleep through the trigger

`launchd` jobs **do not wake a sleeping Mac**. If your machine is asleep at the trigger time (say 06:00), the prewarm won't fire on time and the whole point is lost.

The fix is to have the Mac wake itself shortly before (e.g. 2 minutes early):

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 05:58:00
```

(Changing power settings needs admin rights — run it yourself.)

---

## Observability

- **Timestamped logs** — every trigger appends a dated result line to `~/.cc-prewarm.log`, so "did it run at 06:00 and succeed?" is answerable with a single `cat`.
- **Last result** — `cc-prewarm status` shows each tool's most recent prewarm time and outcome.
- **Failure notifications** — a scheduled run that fails (expired login, quota hit, missing binary) fires a macOS notification.
- **Health self-check** — `status` verifies the `node` path the scheduled job depends on still exists, and warns in red if it's gone.

Activity generated by the prewarms themselves is recorded in `~/.cc-prewarm/history.jsonl` and **automatically excluded** from analysis, so the tool's own pings don't bias the recommended trigger time over time.

---

## Privacy

`cc-prewarm` only ever reads the **timestamps** in your local usage files —
- Claude Code: `~/.claude/telemetry/*.json`
- Codex: `~/.codex/sessions/**/*.jsonl`

**It never reads message contents and never sends anything off your machine.** The window-reset estimate in `status` is computed locally and is a best-effort guess, not the live billing figure.

---

## Caveat

This leans on a quirk of how the window is metered today. If Anthropic or OpenAI change the rules (e.g. reset on a calendar day, or on *any* message), the trick stops working. **It's a clever hack, not a guarantee.**

The prewarm message itself consumes a sliver of quota — which is exactly what opens the window.

---

## License

MIT
