// Condensing command output, as pure functions: no `$`, so tests call them
// directly with real-looking logs.

/** Commands whose output is mostly noise: installs, builds, tests, containers, CI logs. */
export const NOISY = [
  /^(npm|pnpm|yarn|bun|npx|bunx)\b/,
  /^(pip3?|poetry|uv|pipenv|conda)\b/,
  /^(cargo|go|rustup)\b/,
  /^(mvn|mvnw|gradle|gradlew|\.\/gradlew|\.\/mvnw|ant|sbt)\b/,
  /^(dotnet|msbuild|nuget)\b/,
  /^(make|cmake|ninja|bazel|meson)\b/,
  /^(tsc|jest|vitest|mocha|ava|playwright|cypress|pytest|tox|nox|phpunit|rspec)\b/,
  /^(webpack|vite|rollup|esbuild|parcel|next|nuxt|turbo|nx|lerna|astro|ng)\b/,
  /^(docker|docker-compose|podman|buildah|kubectl|helm|terraform|tofu|pulumi|ansible-playbook)\b/,
  /^(bundle|rake|rails|composer|flutter|xcodebuild|swift|gem)\b/,
  /^gh\s+run\s+(view|watch)\b/,
]

/** Commands that show files or diffs: their exact text matters, so they are never touched. */
export const READERS = /^(cat|tac|head|tail|less|more|bat|sed|awk|grep|egrep|rg|ag|find|ls|tree|jq|yq|xxd|od|diff|cmp|type|Get-Content|gc|Select-String|git\s+(show|diff|log|blame|cat-file|grep))\b/

/** Wrappers before the program: `sudo`, `env A=1`, `VAR=1`, `time`, `cd x &&`. */
function program(command: string): string {
  const firstSegment = command.split(/&&|\|\||;|\|/).map(part => part.trim()).filter(Boolean)
  const last = firstSegment.find(part => !/^cd\s/.test(part)) ?? ''
  return last.replace(/^((sudo|time|nice|nohup|command|exec)\s+|env\s+(\S+=\S*\s+)*|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '')
}

export function isNoisy(command: string, extra: readonly RegExp[] = []): boolean {
  const run = program(command)
  if (READERS.test(run)) return false
  return NOISY.some(pattern => pattern.test(run)) || extra.some(pattern => pattern.test(command))
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

/** What a person would see: no colour codes, and of a line rewritten with `\r` only its last state. */
export function clean(text: string): string[] {
  return text
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => {
      const parts = line.split('\r')
      return (parts.findLast(part => part.trim() !== '') ?? '').replace(/\s+$/, '')
    })
}

const IMPORTANT =
  /\b(error|errors|err!|failed|failure|failing|fail|fatal|panic|exception|traceback|warning|warn|deprecated|cannot|could not|unable to|not found|denied|refused|timed? ?out|aborted|segmentation fault|exit code [1-9]|exited with)\b|[✗✖×❌]|^\s*(FAIL|ERROR|WARN)\b/i
const STACK = /^\s+(at |File "|from |\^|~+\s*$|\d+ \|)|^\s*-->\s|^\s*\|/

export const isImportant = (line: string) => IMPORTANT.test(line)

/** A line that only draws progress: bars, spinners, percentages, byte counters. */
export function isProgress(line: string): boolean {
  if (isImportant(line)) return false
  const t = line.trim()
  if (t === '') return false
  if (/^[\s|/\\\-⠁-⣿◐◓◑◒⣾⣽⣻⢿⡿⣟⣯⣷.·•]+$/.test(t)) return true
  if (/[█▓▒░■□▉▊▋▌▍▎▏━─=#>]{6,}/.test(t)) return true
  // A bracketed bar of any fill: `[##      ] 10% resolving packages`
  if (/^\[[#=>\-.*\s]*\]\s*\d{1,3}(\.\d+)?\s?%/.test(t)) return true
  if (/^\[?\s*\d{1,3}(\.\d+)?\s?%\s*\]?/.test(t) && t.replace(/[\d.%\s[\]()/:|-]/g, '').length < 24) return true
  return /^(downloading|downloaded|extracting|fetching|resolving|progress|building|transferring)\b.*\d/i.test(t) && /(\d+(\.\d+)?\s?(k|m|g)?i?b\b|\d+\/\d+|\d+%)/i.test(t)
}

/** Lines that differ only in numbers, hashes and paths' digits count as similar. */
const shape = (line: string) =>
  line
    .replace(/\b[0-9a-f]{7,}\b/gi, 'H')
    .replace(/\d+(\.\d+)?/g, '0')
    .replace(/\s+/g, ' ')
    .trim()

/** Runs of `minRun` or more similar lines become their first and last line and a count. */
export function collapse(lines: readonly string[], minRun = 4): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    let j = i + 1
    const s = shape(lines[i]!)
    while (j < lines.length && shape(lines[j]!) === s && !isImportant(lines[j]!)) j++
    const run = j - i
    if (run >= minRun && s !== '' && !isImportant(lines[i]!)) {
      out.push(lines[i]!, `… ${run - 2} similar lines`, lines[j - 1]!)
    } else {
      out.push(...lines.slice(i, j))
    }
    i = j
  }
  return out
}

/** Above `max` lines: the head, every important line with its stack, the tail, and marks for the gaps. */
export function excerpt(lines: readonly string[], max: number, head = 30, tail = 50, context = 8): string[] {
  if (lines.length <= max) return [...lines]
  const keep = new Set<number>()
  for (let i = 0; i < Math.min(head, lines.length); i++) keep.add(i)
  for (let i = Math.max(0, lines.length - tail); i < lines.length; i++) keep.add(i)
  lines.forEach((line, i) => {
    if (!isImportant(line)) return
    keep.add(i)
    for (let k = i + 1; k < Math.min(lines.length, i + 1 + context) && (STACK.test(lines[k]!) || k === i + 1); k++) keep.add(k)
  })

  const out: string[] = []
  let gap = 0
  lines.forEach((line, i) => {
    if (keep.has(i)) {
      if (gap > 0) out.push(`… ${gap} lines omitted`)
      gap = 0
      out.push(line)
    } else {
      gap += 1
    }
  })
  if (gap > 0) out.push(`… ${gap} lines omitted`)

  return out
}

export type Trimmed = { text: string; linesBefore: number; linesAfter: number; charsSaved: number }

/** Condenses a command's output; undefined when it would not get meaningfully shorter. */
export function trim(text: string, options: { maxLines: number; minSaving?: number }): Trimmed | undefined {
  const raw = text.split('\n').length
  const lines = excerpt(
    collapse(clean(text).filter(line => !isProgress(line))).filter((line, i, all) => !(line === '' && all[i - 1] === '')),
    options.maxLines,
  )
  const out = lines.join('\n').trim()
  const saved = text.length - out.length
  if (saved <= 0 || saved / text.length < (options.minSaving ?? 0.2)) return undefined

  return { text: out, linesBefore: raw, linesAfter: lines.length, charsSaved: saved }
}

/** Claude Code's note for output it saved to a file: the path and the preview it kept. */
export function persistedPath(text: string): string | undefined {
  if (!text.includes('<persisted-output>')) return undefined
  return text.match(/Full output saved to:\s*(.+?)\s*$/m)?.[1]
}

/** The header the model reads first: what was condensed and where the rest is. */
export const header = (trimmed: Trimmed, fullPath: string | undefined) =>
  `[log-trim: ${trimmed.linesBefore} → ${trimmed.linesAfter} lines${fullPath ? `; full output: ${fullPath}` : ''}]`
