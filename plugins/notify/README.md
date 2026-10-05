# notify

Native desktop notifications that say what happened, for when you switch away during a long turn:

| When | Notification |
| --- | --- |
| A turn longer than `minSeconds` finished | **Claude Code · my-app**: Done in 2m 3s: All 42 tests pass. |
| A permission prompt is still waiting after `permissionDelaySeconds` | **Claude Code · my-app**: Needs permission: Claude needs your permission to use Bash |
| Claude asked a question (`AskUserQuestion`) and it is still open after the same delay | **Claude Code · my-app**: Question: Which database should the migration target? |

```text
/plugin install notify@claude-mods
```

The title names the project folder, so two sessions are told apart. A prompt you answer within the delay sends nothing, and neither does a turn you interrupted (you were there) or a subagent's turn.

## How it notifies

No dependencies, and the text never passes through a shell or into a script:

- **Windows**: a WinRT toast through Windows PowerShell; the title and body arrive on stdin as ASCII-only JSON, so any language reads right whatever the console code page
- **macOS**: `osascript`, the texts passed as AppleScript arguments
- **Linux**: `notify-send` from libnotify (`apt install libnotify-bin`, `dnf install libnotify`, `pacman -S libnotify`), the texts after `--`
- **WSL**: the Windows toast through `powershell.exe`, since WSL draws on the Windows desktop

`/notify test` sends a sample, and says why if it could not (a missing notifier comes with how to install it). Windows shows one toast at a time: one sent while another is on screen goes straight to the notification centre.

## Options

| Option | Default | |
| --- | --- | --- |
| `events` | `done`, `permission`, `question` | Which notifications to send |
| `minSeconds` | `30` | Shortest finished turn to notify about |
| `permissionDelaySeconds` | `10` | How long a prompt or question may wait before it notifies |
| `speak` | `false` | Also read the notification aloud with the system voice |
