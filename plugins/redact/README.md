# redact

Keeps secrets that tools print out of what the model reads. A `cat .env`, `env`, a config file or a failing `curl -v` puts keys and passwords into a tool result, and from there into every later request; redact replaces them before the row is stored.

```text
GITHUB_TOKEN=[redacted:github-token]
AWS_ACCESS_KEY_ID=[redacted:aws-access-key]
DB_PASSWORD=[redacted:secret-value]
DATABASE_URL=postgres://app:[redacted:url-password]@db.local:5432/app
LOG_LEVEL=debug
```

That block is what the model answered in a live run after `cat creds.txt` on a file of fake keys: it never saw the values.

```text
/plugin install redact@claude-mods
```

## What it hides

**Known formats**, wherever they appear: private key blocks, AWS access and secret keys, GitHub and GitLab tokens, Anthropic, OpenAI, Slack, Stripe, Google, npm and PyPI keys, JWTs, the password in a connection string, and `Authorization: Bearer|Basic|Token` values.

**Secret-named values** (`generic`): `.env` and shell lines (`DB_PASSWORD=…`, `export API_KEY="…"`) and quoted JSON/YAML/code values (`"apiKey": "…"`, `password: '…'`) whose name contains secret, token, password, passphrase, api key, private key, access key, auth key, client secret or credentials. Placeholders stay: `changeme`, `<your-key>`, `${API_KEY}`, `$TOKEN`, `xxxx`, numbers, booleans, `process.env.X`, and anything shorter than six characters.

Each secret becomes `[redacted:<kind>]`, so the model knows a value was there and asks for it, or reads it through an environment variable, instead of guessing.

## Where

Rows from the outside world: tool results, rows tools hand over, attachments (`@file`), settings-hook context and messages from other agents. Your own prompts pass untouched unless `prompts` is on: a key you paste on purpose is one you meant to give.

## What it does not change

The model and the API never receive the value. Two things keep it, as Claude Code stores them and no plugin can change them:

- **your screen**: a tool's row draws from its own record, so you still see what the tool printed
- **the local transcript file**: next to each tool result Claude Code keeps that record (`toolUseResult`) as the tool made it

So redact protects what leaves your machine and what the model can repeat, not the transcript on disk.

## `/redact`

`/redact` shows what was hidden this session by kind; the status line shows the count. `/redact off` lets secrets through for the session, `/redact on` resumes; both only from the person at the prompt, never from another agent or a channel.

## Options

| Option | Default | |
| --- | --- | --- |
| `prompts` | `false` | Redact your prompts too |
| `generic` | `true` | Hide secret-named values, not only known formats |
| `patterns` | `[]` | Extra regular expressions, hidden as `[redacted:custom]` |
| `allow` | `[]` | Exact values that are not secrets (a public test key) |
