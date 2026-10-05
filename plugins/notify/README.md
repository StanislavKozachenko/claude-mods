# notify

Notifications that say what happened, for when you switch away during a long turn: on the desktop of the machine Claude Code runs on, and on your phone through Claude Code's own push:

| When | Notification |
| --- | --- |
| A turn longer than `minSeconds` finished | **Claude Code · my-app**: Done in 2m 3s: All 42 tests pass. |
| A permission prompt is still waiting after `permissionDelaySeconds` | **Claude Code · my-app**: Needs permission: Claude needs your permission to use Bash |
| Claude asked a question (`AskUserQuestion`) and it is still open after the same delay | **Claude Code · my-app**: Question: Which database should the migration target? |
| The repo owner's Actions usage reached `budgetPercent` of its included minutes, and again at 100% (needs [ci-budget](../ci-budget)) | **Claude Code · my-app**: Actions budget: acme has used 85% of its included minutes this month (1700 of 2000 minutes) |

```text
/plugin install notify@claude-mods
```

Each notification has its own switch, all on by default. The title names the project folder, so two sessions are told apart. A prompt you answer within the delay sends nothing, and neither does a turn you interrupted (you were there) or a subagent's turn.

## On your phone

Each notification also goes through Claude Code's own push (its `PushNotification` tool), so it reaches the **Claude app on your phone** when you are away: Claude Code decides delivery itself. It needs nothing beyond Claude Code:

- **Remote Control** connected for the session, and the Claude app (iOS or Android) signed in to the same claude.ai account; open the app once so it registers for push
- **"Push when Claude decides"** on in `/config` (`agentPushNotifEnabled`, on unless you turned it off)

While you are typing in or looking at the connected terminal, Claude Code holds the push: nothing pings you twice. When it does deliver, Claude Code also shows its own desktop notification, and notify then skips its own, so the desktop gets one. Without Remote Control the phone gets nothing and the desktop notification works as before. `/notify test` says what each channel did and, for the phone, why it got nothing and what to do. `push: false` turns the phone off, `desktop: false` the desktop.

## Budget notifications

With [ci-budget](../ci-budget) installed, notify watches the measurement ci-budget keeps and sends one notification when the owner of the current repo (organisation or account) reaches `budgetPercent` of its included Actions minutes, and one more at 100%. Each is sent once per owner and month, remembered across sessions. It needs exact numbers, so it works where ci-budget reads GitHub billing (see its setup); an estimate has no percentage and sends nothing. Without ci-budget nothing happens: notify does not depend on it.

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
| `desktop` | `true` | Native desktop notification on the machine Claude Code runs on |
| `push` | `true` | Also through Claude Code push: the Claude app on your phone when you are away |
| `done` | `true` | A turn longer than `minSeconds` finished |
| `permission` | `true` | A permission prompt is still waiting |
| `question` | `true` | A question is still waiting |
| `budget` | `true` | An Actions budget reached `budgetPercent` (with ci-budget) |
| `budgetPercent` | `80` | Share of the included minutes that triggers the budget notification |
| `minSeconds` | `30` | Shortest finished turn to notify about |
| `permissionDelaySeconds` | `10` | How long a prompt or question may wait before it notifies |
| `speak` | `false` | Also read the notification aloud with the system voice |
