// What a secret looks like and how a row's blocks are rewritten, as pure
// functions: no `$`, so tests call them directly.

export type Rule = {
  /** What the placeholder names: `[redacted:<kind>]`. */
  kind: string
  /**
   * Global. Without groups the whole match is the secret; with named groups
   * `pre` and `post` around `secret`, only the secret is replaced.
   */
  pattern: RegExp
}

export type Hits = Record<string, number>

const SECRET_NAME = String.raw`[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|AUTH_?KEY|CLIENT_SECRET|CREDENTIALS?)[A-Za-z0-9_]*`
const SECRET_KEY = String.raw`[A-Za-z0-9_.-]*(?:secret|token|password|passwd|passphrase|api[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?key|client[_-]?secret|credentials?)[A-Za-z0-9_.-]*`

/** Well-known formats: precise enough to redact wherever they appear. */
export const FORMAT_RULES: Rule[] = [
  { kind: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  { kind: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'aws-secret-key', pattern: /(?<pre>aws_secret_access_key["']?\s*[=:]\s*["']?)(?<secret>[A-Za-z0-9/+=]{40})/gi },
  { kind: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { kind: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-key', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { kind: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'pypi-token', pattern: /\bpypi-[A-Za-z0-9_-]{50,}/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'url-password', pattern: /(?<pre>\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)(?<secret>[^\s@/]+)(?<post>@)/gi },
  { kind: 'auth-header', pattern: /(?<pre>\bAuthorization["']?\s*[:=]\s*["']?(?:Bearer|Basic|Token)\s+)(?<secret>[A-Za-z0-9._~+/=-]{12,})/gi },
]

/** Values under a secret-looking name: catch what has no known format. */
export const GENERIC_RULES: Rule[] = [
  // .env and shell style: DB_PASSWORD=..., export API_KEY="..."
  { kind: 'secret-value', pattern: new RegExp(String.raw`(?<pre>^[ \t]*(?:export[ \t]+)?${SECRET_NAME}[ \t]*=[ \t]*["']?)(?<secret>[^\s"'#]+)`, 'gim') },
  // JSON, YAML, code: "apiKey": "...", password: '...', token = "..."
  { kind: 'secret-value', pattern: new RegExp(String.raw`(?<pre>["']?${SECRET_KEY}["']?[ \t]*[:=][ \t]*["'])(?<secret>[^"'\s]+)(?<post>["'])`, 'gi') },
]

/** Values that are not secrets even under a secret-looking name. */
const NOT_SECRET =
  /^(?:changeme|change_me|change-me|secret|password|token|your[_-].*|xxx+|\*+|\.{3,}|<.*>|\$\{.*\}|\$[A-Za-z_][A-Za-z0-9_]*|\{\{.*\}\}|%.*%|example.*|placeholder|dummy|test|none|null|nil|undefined|true|false|yes|no|on|off|\d+(?:\.\d+)?|process\.env\..*|os\.environ.*|\[redacted:.*)$/i

const MIN_GENERIC_LENGTH = 6

export function isPlaceholder(value: string): boolean {
  return NOT_SECRET.test(value) || /^(.)\1*$/.test(value)
}

export const placeholder = (kind: string) => `[redacted:${kind}]`

/** Builds the rules from the mod's options; bad patterns are reported, not thrown. */
export function buildRules(options: Readonly<Record<string, unknown>>): { rules: Rule[]; allow: Set<string>; problems: string[] } {
  const problems: string[] = []
  const custom: Rule[] = []
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [])

  for (const source of list(options.patterns)) {
    try {
      custom.push({ kind: 'custom', pattern: new RegExp(source, 'g') })
    } catch {
      problems.push(`invalid pattern /${source}/`)
    }
  }

  return {
    rules: [...FORMAT_RULES, ...(options.generic === false ? [] : GENERIC_RULES), ...custom],
    allow: new Set(list(options.allow)),
    problems,
  }
}

/** Replaces every secret in `text`, counting them by kind. */
export function redactText(text: string, rules: Rule[], allow: ReadonlySet<string> = new Set()): { text: string; hits: Hits } {
  const hits: Hits = {}
  let out = text

  for (const { kind, pattern } of rules) {
    out = out.replace(pattern, (...args) => {
      const match = args[0] as string
      const groups = args.at(-1) as Record<string, string | undefined> | undefined
      const hasGroups = typeof groups === 'object' && groups !== null && groups.secret !== undefined
      const secret = hasGroups ? groups.secret! : match

      if (allow.has(secret) || secret.startsWith('[redacted:')) return match
      if (kind === 'secret-value' && (secret.length < MIN_GENERIC_LENGTH || isPlaceholder(secret))) return match
      if (kind === 'url-password' && isPlaceholder(secret)) return match

      hits[kind] = (hits[kind] ?? 0) + 1
      return hasGroups ? `${groups.pre ?? ''}${placeholder(kind)}${groups.post ?? ''}` : placeholder(kind)
    })
  }

  return { text: out, hits }
}

export function addHits(into: Hits, from: Hits): Hits {
  const sum = { ...into }
  for (const [kind, n] of Object.entries(from)) sum[kind] = (sum[kind] ?? 0) + n
  return sum
}

export const countHits = (hits: Hits) => Object.values(hits).reduce((sum, n) => sum + n, 0)

type Block = { type: string; [field: string]: unknown }

/**
 * Rewrites the blocks a row may change: text blocks, and a tool_result's
 * content, a string or text blocks. Every other block is left as it is.
 */
export function redactBlocks(content: readonly Block[], rules: Rule[], allow: ReadonlySet<string>): { content: Block[]; hits: Hits } {
  let hits: Hits = {}
  const redact = (text: string) => {
    const result = redactText(text, rules, allow)
    hits = addHits(hits, result.hits)
    return result.text
  }
  const redactInner = (inner: unknown): unknown => {
    if (typeof inner === 'string') return redact(inner)
    if (!Array.isArray(inner)) return inner
    return inner.map(part =>
      part !== null && typeof part === 'object' && (part as Block).type === 'text' && typeof (part as Block).text === 'string'
        ? { ...(part as Block), text: redact((part as Block).text as string) }
        : part,
    )
  }

  const next = content.map(block => {
    if (block.type === 'text' && typeof block.text === 'string') return { ...block, text: redact(block.text) }
    if (block.type === 'tool_result') return { ...block, content: redactInner(block.content) }
    return block
  })

  return { content: next, hits }
}
