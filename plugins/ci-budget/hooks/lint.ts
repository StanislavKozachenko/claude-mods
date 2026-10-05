// Spend risks in a workflow file, read from its text: a mod has no YAML
// parser, so these are heuristics over the lines GitHub's syntax fixes.

export const isWorkflowPath = (path: string) => /(^|[\\/])\.github[\\/]workflows[\\/][^\\/]+\.ya?ml$/i.test(path)

const lines = (text: string) => text.replace(/\r\n/g, '\n').split('\n')
const indentOf = (line: string) => line.length - line.trimStart().length
const stripComment = (line: string) => line.replace(/\s+#.*$/, '')

/** The lines indented under the first line matching `key:`, with that line's indent. */
function blockUnder(all: string[], key: RegExp): { indent: number; body: string[] }[] {
  const blocks: { indent: number; body: string[] }[] = []
  all.forEach((line, i) => {
    if (!key.test(line)) return
    const indent = indentOf(line)
    const body: string[] = []
    for (const next of all.slice(i + 1)) {
      if (next.trim() === '' || next.trim().startsWith('#')) continue
      if (indentOf(next) <= indent) break
      body.push(next)
    }
    blocks.push({ indent, body })
  })
  return blocks
}

/** How many values each matrix key lists, inline (`[a, b]`) or as a block list. */
export function matrixSize(text: string): number {
  let largest = 1
  for (const { body } of blockUnder(lines(text), /^\s*matrix:\s*$/)) {
    let size = 1
    const keyIndent = body.length > 0 ? Math.min(...body.map(indentOf)) : 0
    body.forEach((line, i) => {
      if (indentOf(line) !== keyIndent) return
      const clean = stripComment(line).trim()
      if (/^(include|exclude):/.test(clean)) return
      const inline = clean.match(/^[\w-]+:\s*\[(.*)\]\s*$/)
      if (inline) {
        size *= Math.max(1, inline[1]!.split(',').filter(value => value.trim() !== '').length)
        return
      }
      if (/^[\w-]+:\s*$/.test(clean)) {
        const items = body.slice(i + 1).filter((next, j, rest) => {
          const before = rest.slice(0, j)
          return indentOf(next) > keyIndent && next.trim().startsWith('- ') && before.every(b => indentOf(b) > keyIndent)
        })
        if (items.length > 0) size *= items.length
      }
    })
    largest = Math.max(largest, size)
  }
  return largest
}

/** How often a cron expression fires per day, from its minute and hour fields. */
export function cronRunsPerDay(expression: string): number {
  const [minute = '*', hour = '*'] = expression.trim().split(/\s+/)
  const count = (field: string, range: number) =>
    field
      .split(',')
      .map(part => {
        const step = part.match(/^(\*|\d+-\d+)\/(\d+)$/)
        if (step) {
          const [from, to] = step[1] === '*' ? [0, range - 1] : step[1]!.split('-').map(Number)
          return Math.floor((to! - from!) / Number(step[2])) + 1
        }
        if (part === '*') return range
        const span = part.match(/^(\d+)-(\d+)$/)
        return span ? Number(span[2]) - Number(span[1]) + 1 : 1
      })
      .reduce((sum, n) => sum + n, 0)

  return count(minute, 60) * count(hour, 24)
}

/** The spend risks in a workflow, one sentence each, worst first. */
export function lintWorkflow(text: string, options: { isPrivate?: boolean } = {}): string[] {
  const all = lines(text).map(stripComment)
  const warnings: string[] = []
  const has = (pattern: RegExp) => all.some(line => pattern.test(line))

  const jobs = all.filter(line => /^\s+runs-on:/.test(line)).length
  const timeouts = all.filter(line => /^\s+timeout-minutes:/.test(line)).length
  if (jobs > 0 && timeouts < jobs) {
    warnings.push(
      `${jobs - timeouts} of ${jobs} jobs have no timeout-minutes: a stuck job runs for up to 6 hours (360 minutes) before GitHub stops it. Set timeout-minutes on each job.`,
    )
  }

  const size = matrixSize(text)
  if (size >= 6) warnings.push(`The matrix expands to ${size} jobs per run: each one is billed, rounded up to a whole minute.`)

  const isPrivate = options.isPrivate !== false
  const runners = all.filter(line => /runs-on:|^\s*-?\s*(os|runner|platform):|^\s*-\s+[\w.-]*(macos|windows)/i.test(line)).join(' ').toLowerCase()
  if (isPrivate && runners.includes('macos')) {
    warnings.push('macOS runners cost 10 included minutes per minute in a private repo: keep them to what must run on macOS.')
  }
  if (isPrivate && runners.includes('windows')) {
    warnings.push('Windows runners cost 2 included minutes per minute in a private repo.')
  }

  const onPullRequest = has(/^\s*pull_request(_target)?:/) || has(/^on:.*\bpull_request\b/)
  if (onPullRequest && !has(/^\s*concurrency:/)) {
    warnings.push(
      'Pull request runs are not cancelled by a newer push: add concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }.',
    )
  }

  const onPush = has(/^on:\s*\[.*\bpush\b.*\]/) || has(/^on:\s*push\s*$/) || has(/^\s*push:\s*$/)
  const isPushFiltered = blockUnder(all, /^\s*push:\s*$/)[0]?.body.some(line => /branches|tags|paths/.test(line)) ?? false
  if (onPullRequest && onPush && !isPushFiltered) {
    warnings.push('It runs on push to every branch and on pull_request: each push to a PR branch runs it twice. Limit push to the default branch (push: { branches: [main] }).')
  }

  for (const line of all) {
    const cron = line.match(/cron:\s*["']([^"']+)["']/)
    if (!cron) continue
    const perDay = cronRunsPerDay(cron[1]!)
    if (perDay >= 24) warnings.push(`The schedule "${cron[1]}" runs ${perDay} times a day, about ${perDay * 30} runs a month.`)
  }

  const name = all.find(line => /^name:/.test(line))?.replace(/^name:\s*/, '').replace(/^["']|["']$/g, '').trim()
  const watched = blockUnder(all, /^\s*workflow_run:\s*$/)[0]?.body.join(' ') ?? ''
  if (name && watched.includes(name)) {
    warnings.push(`It triggers on workflow_run of "${name}", its own name: every run starts another one.`)
  }

  return warnings
}
