// How a toast is shown on each platform, and the texts it carries, as pure
// functions: no `$`, so tests call them directly.

export type Platform = 'windows' | 'macos' | 'linux'

export type Toast = { title: string; body: string }

/** A command to run with no shell: the text travels as argv or stdin, never inside a script. */
export type Command = { argv: string[]; stdin?: string }

// WinRT toast through Windows PowerShell, which every Windows 10/11 has. The
// title and body arrive as JSON on stdin; the AppUserModelID is PowerShell's
// own, so no shortcut or registration is needed.
const WINDOWS_SCRIPT = [
  '$toast = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
  '$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  "$text = $xml.GetElementsByTagName('text')",
  '$text.Item(0).AppendChild($xml.CreateTextNode($toast.title)) > $null',
  '$text.Item(1).AppendChild($xml.CreateTextNode($toast.body)) > $null',
  "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))',
].join('; ')

// AppleScript reads the texts from its argv, so they are never parsed as code.
const MACOS_SCRIPT = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run']

export function toastCommand(platform: Platform, toast: Toast): Command {
  if (platform === 'windows') {
    return {
      argv: ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT],
      stdin: JSON.stringify(toast),
    }
  }
  if (platform === 'macos') {
    return { argv: ['osascript', ...MACOS_SCRIPT.flatMap(line => ['-e', line]), toast.title, toast.body] }
  }
  return { argv: ['notify-send', '--app-name=Claude Code', '--', toast.title, toast.body] }
}

/** `42s`, `2m 3s`, `1h 5m`, as Claude Code writes durations. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The first non-empty line, Markdown marks dropped, cut to `max` characters. */
export function firstLine(text: string, max = 140): string {
  const line =
    text
      .split('\n')
      .map(part => part.replace(/^[#>*\-\s]+/, '').replace(/[*_`]/g, '').trim())
      .find(part => part.length > 0) ?? ''

  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** `Claude Code · claude-mods`: the project folder tells two sessions apart. */
export function title(cwd: string): string {
  const folder = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return folder ? `Claude Code · ${folder}` : 'Claude Code'
}

export const doneToast = (cwd: string, durationMs: number, answer: string): Toast => ({
  title: title(cwd),
  body: [`Done in ${formatDuration(durationMs)}`, firstLine(answer)].filter(Boolean).join(': '),
})

export const permissionToast = (cwd: string, message: string): Toast => ({
  title: title(cwd),
  body: `Needs permission: ${firstLine(message) || 'a tool call is waiting'}`,
})

export const questionToast = (cwd: string, question: string): Toast => ({
  title: title(cwd),
  body: `Question: ${firstLine(question) || 'Claude is asking you something'}`,
})
