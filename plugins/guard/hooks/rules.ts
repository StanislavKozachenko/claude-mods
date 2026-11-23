// The guard's rules as pure functions: no `$`, so tests call them directly.

export type Verdict = {
  /** The rule that fired, as /guard lists it. */
  rule: string
  /** What was matched: a command segment or a path. */
  subject: string
  /** Why it is blocked, for the model and the person. */
  reason: string
  /** What to do instead. */
  hint: string
}

export type RmMode = 'dangerous' | 'any'

export type Policy = {
  destructive: boolean
  rmMode: RmMode
  commands: { source: string; pattern: RegExp }[]
  secrets: boolean
  protect: { source: string; pattern: RegExp }[]
  allow: RegExp[]
}

export const SECRET_GLOBS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.aws/credentials',
  '.docker/config.json',
  // direnv, database clients, web server and Java keystores
  '.envrc',
  '.pgpass',
  '.my.cnf',
  '.htpasswd',
  '*.jks',
  '*.keystore',
  // CLI tokens: Kubernetes, GitHub CLI (Unix and Windows), Vault, Terraform,
  // gcloud, Azure CLI, Cargo, RubyGems, the user's Gradle properties
  '.kube/config',
  'gh/hosts.yml',
  'GitHub CLI/hosts.yml',
  '.vault-token',
  '.terraformrc',
  'credentials.tfrc.json',
  'gcloud/application_default_credentials.json',
  'gcloud/credentials.db',
  '.azure/msal_token_cache.json',
  '.cargo/credentials',
  '.cargo/credentials.toml',
  '.gem/credentials',
  '.gradle/gradle.properties',
]

export const SECRET_EXCEPTIONS = ['.env.example', '.env.sample', '.env.template', '.env.dist', '*.pub']

const SECRETS = SECRET_GLOBS.map(glob => globToRegExp(glob))
const EXCEPTIONS = SECRET_EXCEPTIONS.map(glob => globToRegExp(glob))

/**
 * A gitignore-like glob: `*` and `?` stay within one path segment, `**`
 * crosses them, and a pattern matches the end of the path at a segment
 * boundary, so `.env` matches `/repo/.env` and `.aws/credentials` matches
 * `~/.aws/credentials`. Case-insensitive, since some file systems are.
 */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '')
  let source = ''

  for (let i = 0; i < g.length; i++) {
    const char = g[i]!
    if (char === '*' && g[i + 1] === '*') {
      i++
      if (g[i + 1] === '/') {
        i++
        source += '(?:.*/)?'
      } else {
        source += '.*'
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }

  return new RegExp(`(?:^|/)${source}$`, 'i')
}

const normalize = (path: string) => path.replace(/\\/g, '/')

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []

/** Builds the policy from the mod's options; bad patterns are reported, not thrown. */
export function buildPolicy(options: Readonly<Record<string, unknown>>): { policy: Policy; problems: string[] } {
  const problems: string[] = []
  const commands: Policy['commands'] = []

  for (const source of asList(options.blockCommands)) {
    try {
      commands.push({ source, pattern: new RegExp(source) })
    } catch {
      problems.push(`invalid blockCommands pattern /${source}/`)
    }
  }

  return {
    policy: {
      destructive: options.destructive !== false,
      rmMode: options.rmMode === 'any' ? 'any' : 'dangerous',
      commands,
      secrets: options.secrets !== false,
      protect: asList(options.protectPaths).map(source => ({ source, pattern: globToRegExp(source) })),
      allow: asList(options.allowPaths).map(source => globToRegExp(source)),
    },
    problems,
  }
}

/** Checks one path (as given, or resolved) against the secret files and the protected paths. */
export function checkPath(path: string, policy: Policy): Verdict | undefined {
  const p = normalize(path)
  if (policy.allow.some(pattern => pattern.test(p))) return undefined

  if (policy.secrets && SECRETS.some(pattern => pattern.test(p)) && !EXCEPTIONS.some(pattern => pattern.test(p))) {
    return {
      rule: 'secret-file',
      subject: path,
      reason: 'it is a secret file (credentials, keys, environment)',
      hint: 'Work from an example file such as .env.example, or ask the user for the value you need.',
    }
  }

  const protectedBy = policy.protect.find(({ pattern }) => pattern.test(p))
  if (protectedBy) {
    return {
      rule: 'protected-path',
      subject: path,
      reason: `it matches the protected path ${protectedBy.source}`,
      hint: 'Leave this file alone, or ask the user to change it.',
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Shell commands

/** Wrappers that run the command after them, with their options that take a value. */
const PREFIXES: Record<string, ReadonlySet<string>> = {
  sudo: new Set(['-u', '-g', '-p', '-C', '-h', '-r', '-t', '-U', '-D', '-R', '-T']),
  doas: new Set(['-u', '-C']),
  command: new Set(),
  builtin: new Set(),
  exec: new Set(['-a']),
  nohup: new Set(),
  time: new Set(['-f', '-o']),
  nice: new Set(['-n']),
  ionice: new Set(['-c', '-n', '-p']),
  xargs: new Set(['-I', '-L', '-P', '-n', '-s', '-d', '-E', '-a']),
  // `timeout -s KILL 5 cmd`: the duration comes before the command
  timeout: new Set(['-s', '-k']),
  stdbuf: new Set(['-i', '-o', '-e']),
}

/** Shells whose `-c` string, or heredoc, is a command line of its own. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash'])

/** How deep `bash -c "sh -c '…'"` is followed. */
const MAX_DEPTH = 4

/** Programs that read, copy, send or edit the files they are given. */
const FILE_TOUCHERS = new Set([
  'cat', 'tac', 'less', 'more', 'head', 'tail', 'bat', 'nl', 'xxd', 'od', 'hexdump', 'strings', 'base64',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'awk', 'sed', 'cut', 'sort', 'uniq', 'diff', 'jq', 'yq',
  'cp', 'mv', 'ln', 'scp', 'rsync', 'tee', 'curl', 'wget', 'nc', 'zip', 'tar', 'gzip',
  'nano', 'vi', 'vim', 'nvim', 'emacs', 'code', 'open', 'type', 'truncate', 'shred',
])

/** Programs whose last argument is a destination: writing a secret file from a template is fine. */
const COPIERS = new Set(['cp', 'mv', 'ln', 'scp', 'rsync'])

const unquote = (token: string) => token.replace(/^(['"])(.*)\1$/, '$2')

/**
 * Splits a command line into simple commands (on `;`, `&&`, `||`, `|`, `&`,
 * newlines, `$(`, backticks and parentheses) and each into words. Quoting is
 * honoured for grouping only: this is a heuristic, not a shell parser. The
 * PowerShell check reads with it; Bash has parseBash.
 */
export function splitCommand(command: string): string[][] {
  return command
    .split(/\|\||&&|[;&|\n()`]|\$\(/)
    .map(part => (part.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote))
    .filter(words => words.length > 0)
}

/** One simple command of a Bash line: its words, quotes removed, and the bodies of the heredocs it reads. */
export type Segment = { words: string[]; heredocs: string[] }

/**
 * Splits a Bash command line into simple commands and their words, the way
 * Bash quotes: separators (`;`, `&&`, `||`, `|`, `&`, newlines, parentheses)
 * and comments count outside quotes only; inside single quotes everything is
 * text, inside double quotes only `$(…)` and backticks run. Each `$(…)` and
 * backtick body is a command line of its own, its commands listed with the
 * rest, and stands in its word as `$(…)`. A heredoc's body is data, kept on
 * the command that reads it. Still a heuristic: no aliases, functions or
 * expansions.
 */
export function parseBash(command: string): Segment[] {
  return parseFrom(command, 0, false).segments
}

function parseFrom(src: string, start: number, isSubstitution: boolean): { segments: Segment[]; end: number } {
  const segments: Segment[] = []
  const pending: { delimiter: string; isTabStripped: boolean; into: Segment }[] = []
  let current: Segment = { words: [], heredocs: [] }
  let word = ''
  let hasWord = false
  let depth = 0

  const endWord = () => {
    if (hasWord) current.words.push(word)
    word = ''
    hasWord = false
  }
  const endSegment = () => {
    endWord()
    if (current.words.length > 0) segments.push(current)
    current = { words: [], heredocs: [] }
  }
  // `$(…)` from just after its `(`: resolves to the index of its `)`
  const substitute = (from: number) => {
    const inner = parseFrom(src, from, true)
    segments.push(...inner.segments)
    word += '$(…)'
    hasWord = true
    return inner.end
  }
  // A backtick body from just after its opening backtick: resolves to the index of the closing one
  const backtick = (from: number) => {
    let j = from
    let body = ''
    for (; j < src.length && src[j] !== '`'; j++) body += src[j] === '\\' && j + 1 < src.length ? src[++j] : src[j]
    segments.push(...parseBash(body))
    word += '$(…)'
    hasWord = true
    return j
  }
  // The heredoc bodies that start after a newline: resolves to the index after the last delimiter line
  const readHeredocs = (from: number) => {
    let pos = from
    for (const { delimiter, isTabStripped, into } of pending) {
      const body: string[] = []
      while (pos < src.length) {
        const newline = src.indexOf('\n', pos)
        const line = src.slice(pos, newline < 0 ? src.length : newline)
        pos = newline < 0 ? src.length : newline + 1
        if ((isTabStripped ? line.replace(/^\t+/, '') : line).replace(/\r$/, '') === delimiter) break
        body.push(line)
      }
      into.heredocs.push(body.join('\n'))
    }
    pending.length = 0
    return pos
  }

  let i = start
  for (; i < src.length; i++) {
    const c = src[i]!

    if (c === '\\') {
      if (src[i + 1] === '\n') i++
      else if (i + 1 < src.length) {
        word += src[++i]
        hasWord = true
      }
    } else if (c === "'") {
      const close = src.indexOf("'", i + 1)
      const end = close < 0 ? src.length : close
      word += src.slice(i + 1, end)
      hasWord = true
      i = end
    } else if (c === '"') {
      hasWord = true
      let j = i + 1
      for (; j < src.length && src[j] !== '"'; j++) {
        if (src[j] === '\\' && '$`"\\\n'.includes(src[j + 1] ?? 'x')) {
          if (src[j + 1] !== '\n') word += src[j + 1]
          j++
        } else if (src[j] === '$' && src[j + 1] === '(') {
          j = substitute(j + 2)
        } else if (src[j] === '`') {
          j = backtick(j + 1)
        } else {
          word += src[j]
        }
      }
      i = j
    } else if (c === '$' && src[i + 1] === '(') {
      i = substitute(i + 2)
    } else if (c === '`') {
      i = backtick(i + 1)
    } else if (c === '#' && !hasWord) {
      while (i + 1 < src.length && src[i + 1] !== '\n') i++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
      // A redirection is a word of its own (`>`, `2>&`, `&>>`, `<<<`), its target the next word
      if (hasWord && !/^\d+$/.test(word)) endWord()
      let op = word
      word = ''
      hasWord = false
      while (i < src.length && '<>&|'.includes(src[i]!) && !(op.endsWith('&') && src[i] === '&')) {
        if (src[i] === '|' && !op.endsWith('>')) break
        op += src[i++]
      }
      i--
      if (/(?:^|[^<])<<$/.test(op)) {
        // A heredoc: `<<EOF`, `<<-'EOF'`, `<< "EOF"`; its body starts after the next newline
        const isTabStripped = src[i + 1] === '-'
        if (isTabStripped) i++
        while (src[i + 1] === ' ' || src[i + 1] === '\t') i++
        let delimiter = ''
        while (i + 1 < src.length && !/[\s;|&()<>]/.test(src[i + 1]!)) delimiter += src[++i]
        pending.push({ delimiter: delimiter.replace(/['"\\]/g, ''), isTabStripped, into: current })
      } else {
        current.words.push(op)
      }
    } else if (c === '\n') {
      endSegment()
      i = readHeredocs(i + 1) - 1
    } else if (c === '(') {
      endSegment()
      depth++
    } else if (c === ')') {
      endSegment()
      if (isSubstitution && depth === 0) return { segments, end: i }
      depth = Math.max(0, depth - 1)
    } else if (c === ';' || c === '|' || c === '&') {
      endSegment()
    } else {
      word += c
      hasWord = true
    }
  }
  endSegment()

  return { segments, end: i }
}

/** Drops wrappers (`sudo -u x`, `env A=1`, `VAR=1`, `nohup`, `timeout 5`) to reach the program and its arguments. */
export function stripPrefixes(words: string[]): string[] {
  const rest = [...words]

  for (;;) {
    const first = rest[0]
    if (first === undefined) return rest
    const name = basename(first)
    const valued = Object.hasOwn(PREFIXES, name) ? PREFIXES[name] : undefined

    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      rest.shift()
    } else if (name === 'env') {
      rest.shift()
      while (rest[0] !== undefined && (rest[0].startsWith('-') || rest[0].includes('='))) rest.shift()
    } else if (valued) {
      rest.shift()
      while (rest[0]?.startsWith('-')) {
        const option = rest.shift()!
        if (valued.has(option)) rest.shift()
      }
      if (name === 'timeout' && /^\d/.test(rest[0] ?? '')) rest.shift()
    } else {
      return rest
    }
  }
}

/**
 * The command line a shell is given to run, if any: the string after `-c`
 * (`bash -c`, `sh -lc`, `bash -o pipefail -c`), or the words of `eval`.
 */
export function innerScript(words: readonly string[]): string | undefined {
  const name = basename(words[0] ?? '')
  if (name === 'eval') return words.slice(1).join(' ')
  if (!SHELLS.has(name)) return undefined

  let hasScript = false
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!
    if (word === '--') return hasScript ? words[i + 1] : undefined
    if (/^[-+][A-Za-z]+$/.test(word)) {
      if (word.startsWith('-') && word.includes('c')) hasScript = true
      if (/^[-+][oO]$/.test(word)) i++
    } else if (!word.startsWith('--')) {
      return hasScript ? word : undefined
    }
  }

  return undefined
}

const basename = (word: string) => normalize(word).split('/').pop() ?? word

const shortFlags = (args: string[]) => args.filter(arg => /^-[^-]/.test(arg)).join('')

const hasFlag = (args: string[], short: string, long: string) =>
  args.includes(long) || shortFlags(args).includes(short)

/** A target an `rm -rf` must not reach: a root, a home, the whole project, an unset variable. */
export function isDangerousTarget(target: string): boolean {
  const t = normalize(target)
  const p = t.length > 1 ? t.replace(/\/+$/, '') : t

  return (
    /^(\/|\/\*|~|~\/\*|\$\{?HOME\}?(\/\*)?)$/.test(p) ||
    /^(\.|\.\/\*|\*|\.\*|\.\.|\.\.\/\*)$/.test(p) ||
    /^\/[^/]+(\/[^/]+)?(\/\*)?$/.test(p) ||
    /^(~|\$\{?HOME\}?)\/[^/]+$/.test(p) ||
    /^[A-Za-z]:(\/[^/]*)?$/.test(p) ||
    // `$DIR/` or `"$DIR"/*` with DIR unset is `/`; `${DIR:?}` refuses to expand empty
    (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?(\/\*?)?$/.test(p) && !p.includes(':?'))
  )
}

const deny = (rule: string, words: string[], reason: string, hint: string): Verdict => ({
  rule,
  subject: words.join(' '),
  reason,
  hint,
})

export function checkDestructive(words: string[], rmMode: RmMode): Verdict | undefined {
  const [program = '', ...args] = words
  const name = basename(program)

  if (name === 'rm') {
    const end = args.indexOf('--')
    const flags = (end < 0 ? args : args.slice(0, end)).filter(arg => arg.startsWith('-'))
    const targets = args.filter((arg, i) => !(arg.startsWith('-') && (end < 0 || i < end)) && arg !== '--')
    const isRecursive = flags.includes('--recursive') || /[rR]/.test(shortFlags(flags))
    const isForced = flags.includes('--force') || shortFlags(flags).includes('f')

    if (isRecursive && isForced) {
      if (rmMode === 'any') {
        return deny('rm-rf', words, 'it force-deletes recursively', 'Delete specific files, or ask the user to run it.')
      }
      const target = targets.find(isDangerousTarget)
      if (target !== undefined) {
        return deny(
          'rm-rf',
          words,
          `it force-deletes ${target} recursively`,
          'Name a specific path inside the project, guard variables with ${VAR:?}, or ask the user to run it.',
        )
      }
    }
  }

  if (name === 'git') {
    let i = 0
    while (i < args.length && args[i]!.startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
    const sub = args[i]
    const rest = args.slice(i + 1)

    if (sub === 'push') {
      const isForced =
        rest.includes('--force') || shortFlags(rest).includes('f') || rest.some(arg => /^\+[^+]/.test(arg))
      if (isForced) {
        return deny(
          'git-force-push',
          words,
          'it force-pushes and can overwrite commits on the remote',
          'Use --force-with-lease, or ask the user.',
        )
      }
    }
    if (sub === 'reset' && rest.includes('--hard')) {
      return deny(
        'git-reset-hard',
        words,
        'it discards uncommitted changes for good',
        'Use git stash, or ask the user.',
      )
    }
    if (sub === 'clean' && hasFlag(rest, 'f', '--force') && !hasFlag(rest, 'n', '--dry-run')) {
      return deny(
        'git-clean',
        words,
        'it deletes untracked files for good',
        'Preview with git clean -n and ask the user.',
      )
    }
  }

  if (name === 'chmod' && hasFlag(args, 'R', '--recursive') && args.some(arg => /^(0?777|a\+rwx|ugo\+rwx)$/.test(arg))) {
    return deny('chmod-777', words, 'it makes a whole tree world-writable', 'Grant the narrowest permission needed.')
  }

  if (name.startsWith('mkfs') || (name === 'dd' && args.some(arg => /^of=\/dev\//.test(arg)))) {
    return deny('disk-write', words, 'it writes a file system or raw data to a device', 'Ask the user to run it.')
  }

  return undefined
}

function checkWhole(command: string): Verdict | undefined {
  const piped = command.match(/\b(curl|wget)\b[^\n;&|]*\|\s*(sudo\s+)?(env\s+(\S+=\S*\s+)*)?(ba|z|da|k|fi)?sh\b/)
  if (piped) {
    return {
      rule: 'pipe-to-shell',
      subject: piped[0],
      reason: 'it runs a downloaded script without review',
      hint: 'Download the script to a file, show it to the user, and run it only after they agree.',
    }
  }
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(command)) {
    return { rule: 'fork-bomb', subject: ':(){ :|:& };:', reason: 'it is a fork bomb', hint: 'Do not run it.' }
  }

  return undefined
}

function checkSecretMentions(words: string[], policy: Policy): Verdict | undefined {
  const [program = '', ...args] = words
  const name = basename(program)
  const isGitAdd = name === 'git' && args.includes('add')
  const destination = COPIERS.has(name) ? args.findLastIndex(arg => !arg.startsWith('-')) : -1

  for (let i = 0; i < args.length; i++) {
    if (i === destination) continue
    const arg = args[i]!
    const isRedirect = /^(?:\d*|&)(?:>>?\|?|<)&?$/.test(arg)
    const target = isRedirect ? args[i + 1] : arg.replace(/^\d*(>>?|<)&?/, '')

    if (!isRedirect && !/^\d*(>>?|<)/.test(arg) && !FILE_TOUCHERS.has(name) && !isGitAdd) continue
    if (target === undefined || target === '' || target.startsWith('-')) continue

    const verdict = checkPath(target.replace(/^@/, '').replace(/^[A-Za-z_]+=/, ''), policy)
    if (verdict) return { ...verdict, subject: words.join(' ') }
  }

  return undefined
}

/**
 * Checks a whole Bash command line; the first rule that fires wins. What a
 * shell is handed to run (`bash -c "…"`, `eval "…"`, `bash <<EOF`) is checked
 * as a command line of its own.
 */
export function checkCommand(command: string, policy: Policy, depth = 0): Verdict | undefined {
  for (const { source, pattern } of policy.commands) {
    if (pattern.test(command)) {
      return {
        rule: 'blocked-command',
        subject: command,
        reason: `it matches the blocked pattern /${source}/`,
        hint: 'Find another way, or ask the user to run it.',
      }
    }
  }

  if (policy.destructive) {
    const whole = checkWhole(command)
    if (whole) return whole
  }

  for (const segment of parseBash(command)) {
    const words = stripPrefixes(segment.words)
    if (words.length === 0) continue
    const verdict =
      (policy.destructive ? checkDestructive(words, policy.rmMode) : undefined) ??
      (policy.secrets || policy.protect.length > 0 ? checkSecretMentions(words, policy) : undefined)
    if (verdict) return verdict

    if (depth >= MAX_DEPTH) continue
    const inner = innerScript(words)
    const scripts = inner !== undefined ? [inner] : SHELLS.has(basename(words[0]!)) ? segment.heredocs : []
    for (const script of scripts) {
      const nested = checkCommand(script, policy, depth + 1)
      if (nested) return nested
    }
  }

  return undefined
}

/** The text the model receives in place of the tool's result. */
export function denyMessage(verdict: Verdict): string {
  return `guard blocked this (${verdict.rule}): ${verdict.reason}. ${verdict.hint}`
}

/** The active rules, one per line, for /guard. */
export function describePolicy(policy: Policy): string[] {
  const lines: string[] = []
  if (policy.destructive) {
    lines.push(
      `destructive commands: rm -rf (${policy.rmMode === 'any' ? 'any target' : 'dangerous targets'}), git push --force, git reset --hard, git clean -f, chmod -R 777, mkfs/dd to devices, curl|sh`,
    )
  }
  if (policy.secrets) lines.push(`secret files: ${SECRET_GLOBS.join(', ')} (except ${SECRET_EXCEPTIONS.join(', ')})`)
  if (policy.protect.length > 0) lines.push(`protected paths: ${policy.protect.map(({ source }) => source).join(', ')}`)
  if (policy.commands.length > 0) lines.push(`blocked patterns: ${policy.commands.map(({ source }) => `/${source}/`).join(', ')}`)
  if (policy.allow.length > 0) lines.push('allowed paths override the file rules')
  if (lines.length === 0) lines.push('no rules are on')

  return lines
}
