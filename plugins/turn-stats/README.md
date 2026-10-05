# turn-stats

Adds what a turn did under the line Claude Code draws when the turn ends, so it is where you already look:

```text
✻ Baked for 2m 3s
  15 tools (Bash 6, Edit 5, Read 3, …) · 2 failed · 4 files · $0.42
```

```text
/plugin install turn-stats@claude-mods
```

- **tools**: every tool call of the turn, subagents' included, with the most used named first
- **failed**: calls that ended in an error or were denied
- **files**: distinct files `Edit`, `Write` and `NotebookEdit` changed
- **cost**: what the turn cost, from the session's own cost total; shown when the session reports one

A turn that did nothing worth saying keeps the plain line. Summaries are kept across sessions (the last 200), so a resumed transcript shows them too; turns from before the mod was installed have none.

## How it finds the line

The line is the transcript's `turn_duration` row, and its render instance is that row's uuid. A `session.append` hook catches the row as it is stored and binds the turn that just ran to it; a `ui.render` hook on `TurnDuration` draws the engine's own line and the summary on a row beneath it.

## Options

| Option | Default | |
| --- | --- | --- |
| `cost` | `true` | Show the turn's cost |
| `topTools` | `3` | How many tools to name in the breakdown (`0`: the count alone) |
