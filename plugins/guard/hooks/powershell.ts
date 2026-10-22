// The guard's rules for Claude Code's PowerShell tool, in PowerShell's own
// syntax: cmdlets and their aliases, case-insensitive parameters that may be
// abbreviated, `-Name:value`. Pure functions, like rules.ts.

import { checkDestructive, checkPath, isDangerousTarget, splitCommand } from './rules'
import type { Policy, Verdict } from './rules'

const REMOVE = new Set(['remove-item', 'rm', 'del', 'erase', 'rd', 'rmdir', 'ri'])
const READERS = new Set(['get-content', 'gc', 'cat', 'type', 'select-string', 'sls', 'format-hex', 'fhx', 'import-csv', 'ipcsv'])
const WRITERS = new Set(['set-content', 'sc', 'add-content', 'ac', 'out-file', 'tee-object', 'tee'])
const COPIERS = new Set(['copy-item', 'cp', 'copy', 'cpi', 'move-item', 'mv', 'move', 'mi', 'compress-archive', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'])
const DISK = new Set(['format-volume', 'clear-disk', 'initialize-disk', 'remove-partition', 'diskpart'])

/** Parameters whose value is a path the cmdlet reads or writes. */
const PATH_PARAMS = ['path', 'literalpath', 'lp', 'pspath', 'filepath', 'infile']
/** Parameters that take a value, so the next word is not a positional argument. */
const VALUE_PARAMS = [...PATH_PARAMS, 'destination', 'encoding', 'filter', 'include', 'exclude', 'value', 'pattern', 'delimiter', 'outfile', 'uri', 'body', 'method', 'headers']

const deny = (rule: string, words: string[], reason: string, hint: string): Verdict => ({ rule, subject: words.join(' '), reason, hint })

/** A word as PowerShell names a command: no path, no `.exe`, lower case. */
const commandName = (word: string) =>
  word
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.exe$/i, '')
    .toLowerCase()

/** `-Recurse`, `-rec`, `-r`: PowerShell accepts any unambiguous prefix. */
const isPrefixOf = (name: string, full: string, shortest = 1) => name.length >= shortest && full.startsWith(name)

type Parsed = { switches: string[]; named: Map<string, string>; positional: string[] }

/** Splits a cmdlet's words into switches, named values and positional arguments. */
export function parseParams(args: readonly string[]): Parsed {
  const parsed: Parsed = { switches: [], named: new Map(), positional: [] }
  for (let i = 0; i < args.length; i++) {
    const word = args[i]!
    if (!/^-[A-Za-z]/.test(word)) {
      parsed.positional.push(word)
      continue
    }
    const [rawName = '', inline] = word.slice(1).split(/:(.*)/s)
    const name = rawName.toLowerCase()
    // -Force, -fo, -f and -Recurse never take a value
    const isSwitch = name === 'f' || isPrefixOf(name, 'force', 2) || isPrefixOf(name, 'recurse')
    const takesValue = !isSwitch && VALUE_PARAMS.some(full => isPrefixOf(name, full, 2))
    if (isSwitch) {
      // `-Recurse:$true` is the switch on, `-Recurse:$false` off
      if (!/^\$false$/i.test(inline ?? '')) parsed.switches.push(name)
    } else if (inline !== undefined && inline !== '') {
      parsed.named.set(name, inline)
    } else if (takesValue && args[i + 1] !== undefined) {
      parsed.named.set(name, args[++i]!)
    } else {
      parsed.switches.push(name)
    }
  }
  return parsed
}

/** PowerShell's home and system locations, spelled as rules.ts reads them. */
function asUnixTarget(target: string): string {
  return target
    .replace(/^\$env:(USERPROFILE|HOMEPATH)/i, '~')
    .replace(/^\$HOME\b/i, '~')
    .replace(/^\$env:(SystemRoot|windir|SystemDrive|ProgramFiles(\(x86\))?|ProgramData)/i, '/')
    .replace(/^\$env:([A-Za-z_]\w*)/i, '$$$1')
    .replace(/\\/g, '/')
}

/** A target a recursive delete must not reach; `C:\Users\me` as well as `/home/me`. */
export function isDangerousPsTarget(target: string): boolean {
  const t = asUnixTarget(target).replace(/\/+$/, '')
  return isDangerousTarget(t === '' ? '/' : t) || /^[A-Za-z]:\/[^/]+\/[^/]+(\/\*)?$/.test(t)
}

function checkRemove(name: string, args: string[], words: string[], policy: Policy): Verdict | undefined {
  if (!REMOVE.has(name)) return undefined
  const { switches, named, positional } = parseParams(args)
  // cmd's `rd /s` and a bash-style `-rf` count as recursive too
  const isRecursive =
    switches.some(s => isPrefixOf(s, 'recurse') || /^r[f]?$|^fr$/.test(s)) || args.some(arg => /^\/s$/i.test(arg))
  if (!isRecursive) return undefined

  if (policy.rmMode === 'any') {
    return deny('rm-rf', words, 'it deletes a folder recursively', 'Delete specific files, or ask the user to run it.')
  }
  const targets = [...PATH_PARAMS.map(p => named.get(p)), ...positional.filter(arg => !/^\/[a-z]$/i.test(arg))].filter(
    (target): target is string => target !== undefined,
  )
  const target = targets.find(isDangerousPsTarget)
  if (target === undefined) return undefined
  return deny(
    'rm-rf',
    words,
    `it deletes ${target} recursively (PowerShell's -Recurse does not ask, even without -Force)`,
    'Name a specific path inside the project, or ask the user to run it.',
  )
}

function checkOther(name: string, args: string[], words: string[]): Verdict | undefined {
  if (DISK.has(name) || (name === 'format' && /^[A-Za-z]:$/.test(args[0] ?? ''))) {
    return deny('disk-write', words, 'it formats or wipes a disk or partition', 'Ask the user to run it.')
  }
  if (name === 'icacls' && args.some(arg => /^\/t$/i.test(arg)) && /\/grant\S*\s+(\*?S-1-1-0|everyone)\S*:\(?(OI\)\(CI\)\(?)?F/i.test(args.join(' '))) {
    return deny('chmod-777', words, 'it gives Everyone full control of a whole tree', 'Grant the narrowest permission needed.')
  }
  return undefined
}

/** The files a cmdlet reads, copies, sends or writes: never a copy's destination. */
function touchedPaths(name: string, args: string[]): string[] {
  const isCopier = COPIERS.has(name)
  if (!READERS.has(name) && !WRITERS.has(name) && !isCopier) return []
  const { named, positional } = parseParams(args)
  const paths = PATH_PARAMS.map(p => named.get(p)).filter((path): path is string => path !== undefined)
  if (WRITERS.has(name)) {
    // Set-Content .env "x": the path comes first, the rest is the value written
    return paths.length > 0 ? paths : positional.slice(0, 1)
  }
  // Invoke-WebRequest -InFile sends a file; Copy-Item's second positional is the destination
  const sources = isCopier && !named.has('destination') && positional.length > 1 ? positional.slice(0, -1) : positional
  return [...paths, ...sources]
}

/** `> .env`, `>> secrets.txt`, `2>file`: what a redirection writes to. */
function redirectTargets(args: readonly string[]): string[] {
  const out: string[] = []
  args.forEach((arg, i) => {
    if (/^\d?>>?$/.test(arg) && args[i + 1]) out.push(args[i + 1]!)
    else if (/^\d?>>?./.test(arg)) out.push(arg.replace(/^\d?>>?/, ''))
  })
  return out
}

/** Checks a whole PowerShell command line with the same policy as Bash; the first rule that fires wins. */
export function checkPowerShell(command: string, policy: Policy): Verdict | undefined {
  for (const { source, pattern } of policy.commands) {
    if (pattern.test(command)) {
      return { rule: 'blocked-command', subject: command, reason: `it matches the blocked pattern /${source}/`, hint: 'Find another way, or ask the user to run it.' }
    }
  }

  if (
    policy.destructive &&
    (/\b(iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget|downloadstring|downloadfile)\b[\s\S]*\|\s*(iex|invoke-expression)\b/i.test(command) ||
      /\b(iex|invoke-expression)\b[\s\S]*\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|net\.webclient)\b/i.test(command))
  ) {
    return { rule: 'pipe-to-shell', subject: command, reason: 'it runs a downloaded script without review', hint: 'Download the script to a file, show it to the user, and run it only after they agree.' }
  }

  for (const segment of splitCommand(command)) {
    let words = segment
    while (words[0] === '&' || words[0] === '.') words = words.slice(1)
    // `cmd /c rd /s /q C:\` runs cmd's command inside PowerShell
    if (commandName(words[0] ?? '') === 'cmd' && /^\/[ck]$/i.test(words[1] ?? '')) words = words.slice(2)
    if (words.length === 0) continue

    const name = commandName(words[0]!)
    const args = words.slice(1)

    if (policy.destructive) {
      const verdict = checkRemove(name, args, words, policy) ?? checkOther(name, args, words) ?? (name === 'git' ? checkDestructive(['git', ...args], policy.rmMode) : undefined)
      if (verdict) return verdict
    }

    if (policy.secrets || policy.protect.length > 0) {
      const candidates = [...touchedPaths(name, args), ...redirectTargets(args), ...(name === 'git' && args[0] === 'add' ? args.slice(1).filter(a => !a.startsWith('-')) : [])]
      for (const path of candidates) {
        const verdict = checkPath(path, policy)
        if (verdict) return { ...verdict, subject: words.join(' ') }
      }
    }
  }

  return undefined
}
