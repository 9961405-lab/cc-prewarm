# ⚡ cc-prewarm

Double the 5-hour quota windows you get during your peak hours — by pre-warming
Claude Code / Codex so the window resets *in the middle of your workday* instead
of after it.

## The trick

Both Claude Code and Codex meter usage in a **5-hour rolling window**. The clock
starts the moment you send your first message, and — crucially — it does **not**
auto-restart. The system waits until your next message to begin a fresh window.

So if your peak working hours are, say, 09:00–13:00 and you only start at 09:00,
your window runs 09:00→14:00 and you get **one** window for the whole stretch.

But if you fire one throwaway message at **06:00**, the window resets at 11:00 —
right in the middle of your peak. Now 09:00–13:00 spans **two** windows. Same
hours, double the quota.

`cc-prewarm` automates this: it reads your local usage telemetry, figures out
when your peak actually is, and schedules a daily one-line prewarm so the reset
lands where it helps most.

## Install

```bash
npm install -g cc-prewarm
# or run without installing:
npx cc-prewarm analyze
```

## Usage

```bash
cc-prewarm analyze      # scan ~/.claude/telemetry, recommend a trigger time
cc-prewarm install      # schedule the daily prewarm at the recommended hour
cc-prewarm trigger      # fire one prewarm message right now
cc-prewarm status       # estimate when your current window resets
cc-prewarm uninstall    # remove the scheduled job
```

### Example

```
$ cc-prewarm analyze

  ⚡ Your usage profile
  938 events across 4 day(s) of local telemetry

  09:00   92  ██████████████████  ◀ peak
  10:00  115  ███████████████████████  ◀ peak
  11:00  104  ████████████████████  ◀ peak
  12:00  209  ████████████████████████████████  ◀ peak
  ...

  ⚡ Recommendation
  Peak hours:   09:00–13:00 (55% of your usage)
  Trigger at:   06:00 (3h before peak → resets mid-peak)
  Windows hit:  1 → 2 during peak  (2.0× more)
```

## How it schedules

| OS | Mechanism |
|----|-----------|
| macOS | LaunchAgent plist in `~/Library/LaunchAgents` (survives reboot) |
| Linux | prints a `crontab` line to add |
| Windows | prints a `schtasks` command to run |

The scheduled job just runs `cc-prewarm trigger`, which sends one tiny headless
message (`claude -p` or `codex exec`) to open the window.

## Privacy

`cc-prewarm` only ever reads the **timestamps** in your local
`~/.claude/telemetry` files — never message contents — and never sends anything
off your machine. The window-reset estimate in `status` is computed locally and
is a best-effort guess, not the live billing figure.

## Caveat

This leans on a quirk of how the window is metered today. If Anthropic or OpenAI
change the rules (e.g. reset on a calendar day, or on *any* message), the trick
stops working. It's a clever hack, not a guarantee.

## License

MIT
