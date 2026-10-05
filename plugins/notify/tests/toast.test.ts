import { describe, expect, test } from 'claude-code/testing'

import { asciiJson, doneToast, pushMessage, pushReason, firstLine, formatDuration, permissionToast, questionToast, title, toastCommand } from '../hooks/toast'

const TOAST = { title: 'Claude Code · app', body: `Done: it's "quoted" $(rm -rf ~) \`x\`` }

describe('toastCommand', () => {
  test('windows: PowerShell reads the text from stdin, the script never contains it', async () => {
    const command = toastCommand('windows', TOAST)
    expect(command.argv[0]).toBe('powershell')
    expect(JSON.parse(command.stdin ?? '')).toEqual(TOAST)
    expect(command.argv.join(' ')).not.toContain('quoted')
  })

  test('windows: the JSON on stdin is ASCII alone, whatever the language', async () => {
    const toast = { title: 'Claude Code · проект', body: 'Вопрос: какую базу выбрать? 🚀' }
    const stdin = toastCommand('windows', toast).stdin ?? ''
    expect(/^[\x00-\x7f]*$/.test(stdin)).toBe(true)
    expect(JSON.parse(stdin)).toEqual(toast)
    expect(asciiJson('·')).toBe('"\\u00b7"')
  })

  test('macos: AppleScript takes the text as argv', async () => {
    const command = toastCommand('macos', TOAST)
    expect(command.argv[0]).toBe('osascript')
    expect(command.argv.slice(-2)).toEqual([TOAST.title, TOAST.body])
    expect(command.argv.filter(arg => arg.includes('quoted'))).toHaveLength(1)
  })

  test('linux: notify-send with -- before the text', async () => {
    expect(toastCommand('linux', TOAST).argv).toEqual(['notify-send', '--app-name=Claude Code', '--', TOAST.title, TOAST.body])
  })
})

describe('texts', () => {
  test('formatDuration', async () => {
    expect(formatDuration(42_400)).toBe('42s')
    expect(formatDuration(123_000)).toBe('2m 3s')
    expect(formatDuration(3_900_000)).toBe('1h 5m')
  })

  test('firstLine drops Markdown and cuts long lines', async () => {
    expect(firstLine('\n\n## **Done.** All `tests` pass\nmore')).toBe('Done. All tests pass')
    expect(firstLine('- item one')).toBe('item one')
    expect(firstLine('x'.repeat(200), 10)).toBe('xxxxxxxxx…')
    expect(firstLine('   ')).toBe('')
  })

  test('title names the project folder', async () => {
    expect(title('C:\\Users\\me\\claude-mods')).toBe('Claude Code · claude-mods')
    expect(title('/home/me/app/')).toBe('Claude Code · app')
    expect(title('')).toBe('Claude Code')
  })

  test('toasts', async () => {
    expect(doneToast('/x/app', 125_000, 'All green.\nDetails')).toEqual({ title: 'Claude Code · app', body: 'Done in 2m 5s: All green.' })
    expect(doneToast('/x/app', 5_000, '').body).toBe('Done in 5s')
    expect(permissionToast('/x/app', 'Claude needs your permission to use Bash').body).toBe(
      'Needs permission: Claude needs your permission to use Bash',
    )
    expect(questionToast('/x/app', '').body).toBe('Question: Claude is asking you something')
  })
})

describe('push', () => {
  test('pushMessage fits a phone', async () => {
    expect(pushMessage({ title: 'Claude Code · app', body: 'Done in 5s' })).toBe('Claude Code · app: Done in 5s')
    expect(pushMessage({ title: 'T', body: 'x'.repeat(300) }).length).toBe(200)
  })

  test('pushReason says what to do', async () => {
    expect(pushReason('user_present')).toContain('when you are away')
    expect(pushReason('config_off')).toContain('agentPushNotifEnabled')
    expect(pushReason('no_transport')).toContain('Remote Control')
    expect(pushReason(undefined)).toBe('Claude Code did not send it.')
  })
})
