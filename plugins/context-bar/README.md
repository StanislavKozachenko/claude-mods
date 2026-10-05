# context-bar

Shows the context window as a stacked bar above the prompt, one colour per `/context` category, so you see where the window goes without running `/context`.

```text
32% · 317k / 1M ███▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
■ Messages 270k  ■ System tools 37k  ■ Skills 6.6k  ■ System prompt 2.2k  ■ Autocompact buffer 33k  ■ Free space 650k
```

```text
/plugin install context-bar@claude-mods
```

- Each segment is a `/context` category in the colour `/context` draws it in: used space `█`, the autocompact buffer `▒`, free space `░`; deferred tool schemas are left out, as `/context` leaves them out of the grid
- The summary reads `percent · used / window` and turns bold from 80%
- The legend lists used categories largest first, then the buffer and free space, as many as fit the width (`+N more` for the rest)
- In a narrow terminal the band shows `context 32%` alone
- It yields to surveys and is not drawn over a subagent's transcript

The numbers are the local estimate `/context` makes (`$.session.usage({ breakdown: 'summary' })`): no token-count requests. They refresh when the session starts, after every turn, after compaction and, during a long turn, after tool calls at most once per `refreshSeconds`.

## `/context-bar`

`/context-bar` toggles the band, `/context-bar on` and `/context-bar off` set it. The choice is remembered across sessions.

## Options

| Option | Default | |
| --- | --- | --- |
| `legend` | `true` | Show the legend row |
| `refreshSeconds` | `5` | During a turn, re-measure after a tool call at most this often |
