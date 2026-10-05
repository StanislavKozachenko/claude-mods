import { describe, expect, test } from 'claude-code/testing'

import { buildRules, redactBlocks, redactText } from '../hooks/rules'

const { rules, allow } = buildRules({})
const clean = (text: string) => redactText(text, rules, allow).text

describe('known formats', () => {
  test('are replaced wherever they appear', async () => {
    const cases: [string, string][] = [
      ['token ghp_FAKEfake0123456789abcdefghijABCDEFGHIJ here', 'token [redacted:github-token] here'],
      [`github_pat_${'A1b2'.repeat(20)}`, '[redacted:github-token]'],
      ['glpat-FAKEfake0123456789abcd', '[redacted:gitlab-token]'],
      ['key=AKIAFAKEFAKE12345678', 'key=[redacted:aws-access-key]'],
      [`aws_secret_access_key = ${'aB3/'.repeat(10)}`, 'aws_secret_access_key = [redacted:aws-secret-key]'],
      [`sk-ant-api03-${'x1Y2'.repeat(10)}`, '[redacted:anthropic-key]'],
      [`OPENAI_API_KEY: sk-proj-${'Ab9_'.repeat(10)}`, 'OPENAI_API_KEY: [redacted:openai-key]'],
      ['xoxb-1234567890-abcdefghij', '[redacted:slack-token]'],
      ['sk_live_FAKEfake0123456789', '[redacted:stripe-key]'],
      [`AIza${'B'.repeat(10)}c${'D'.repeat(24)}`, '[redacted:google-api-key]'],
      [`npm_${'a1B2'.repeat(9)}`, '[redacted:npm-token]'],
      ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl', '[redacted:jwt]'],
      ['postgres://app:SuperSecretPw9@db:5432/app', 'postgres://app:[redacted:url-password]@db:5432/app'],
      ['Authorization: Bearer abcDEF123456789xyz', 'Authorization: Bearer [redacted:auth-header]'],
    ]
    for (const [input, output] of cases) expect(clean(input)).toBe(output)
  })

  test('a private key block goes whole', async () => {
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nAAAA\n-----END OPENSSH PRIVATE KEY-----'
    expect(clean(`before\n${pem}\nafter`)).toBe('before\n[redacted:private-key]\nafter')
  })
})

describe('secret-named values', () => {
  test('.env, shell, JSON and YAML styles', async () => {
    expect(clean('DB_PASSWORD=hunter2-is-not-real')).toBe('DB_PASSWORD=[redacted:secret-value]')
    expect(clean('export STRIPE_SECRET="abc123def456"')).toBe('export STRIPE_SECRET="[redacted:secret-value]"')
    expect(clean('{ "apiKey": "abcdef123456" }')).toBe('{ "apiKey": "[redacted:secret-value]" }')
    expect(clean("password: 'correct-horse-battery'")).toBe("password: '[redacted:secret-value]'")
  })

  test('placeholders, numbers, types and references stay', async () => {
    for (const text of [
      'DB_PASSWORD=changeme',
      'API_KEY=<your-key>',
      'API_KEY=${API_KEY}',
      'SECRET_TOKEN=$SECRET',
      'MAX_TOKENS=100000',
      'TOKENIZERS_PARALLELISM=false',
      'PASSWORD=xxxxxxxx',
      'password: string',
      'const token = process.env.TOKEN',
      '"token": "your_token_here"',
      'LOG_LEVEL=debug',
      'PWD=/home/me/project',
      'https://example.com/path?a=1',
      'git@github.com:owner/repo.git',
    ]) {
      expect(clean(text)).toBe(text)
    }
  })

  test('generic: false keeps only known formats', async () => {
    const { rules: strict, allow: none } = buildRules({ generic: false })
    expect(redactText('DB_PASSWORD=hunter2-is-not-real', strict, none).text).toBe('DB_PASSWORD=hunter2-is-not-real')
  })
})

describe('options', () => {
  test('patterns and allow', async () => {
    const built = buildRules({ patterns: ['ACME-[0-9]{6}', '('], allow: ['sk_test_PUBLICsample000000'] })
    expect(built.problems).toEqual(['invalid pattern /(/'])
    expect(redactText('id ACME-123456', built.rules, built.allow).text).toBe('id [redacted:custom]')
    expect(redactText('sk_test_PUBLICsample000000', built.rules, built.allow).text).toBe('sk_test_PUBLICsample000000')
  })

  test('counts hits by kind, and a second pass finds nothing new', async () => {
    const once = redactText('ghp_FAKEfake0123456789abcdefghijABCDEFGHIJ\nDB_PASSWORD=hunter2-is-not-real', rules, allow)
    expect(once.hits).toEqual({ 'github-token': 1, 'secret-value': 1 })
    expect(redactText(once.text, rules, allow).hits).toEqual({})
  })
})

describe('redactBlocks', () => {
  test('text blocks and tool_result content, other blocks untouched', async () => {
    const tool = { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat .env' } }
    const { content, hits } = redactBlocks(
      [
        tool,
        { type: 'tool_result', tool_use_id: 't1', content: 'TOKEN=ghp_FAKEfake0123456789abcdefghijABCDEFGHIJ' },
        { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'DB_PASSWORD=hunter2-is-not-real' }] },
        { type: 'text', text: 'AKIAFAKEFAKE12345678' },
      ],
      rules,
      allow,
    )
    expect(content[0]).toBe(tool)
    expect(content[1]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: 'TOKEN=[redacted:github-token]' })
    expect(content[2]).toEqual({ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'DB_PASSWORD=[redacted:secret-value]' }] })
    expect(content[3]).toEqual({ type: 'text', text: '[redacted:aws-access-key]' })
    expect(hits).toEqual({ 'github-token': 1, 'secret-value': 1, 'aws-access-key': 1 })
  })
})
