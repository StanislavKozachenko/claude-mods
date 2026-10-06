# claude-mods

[![CI](https://img.shields.io/github/actions/workflow/status/StanislavKozachenko/claude-mods/ci.yml?branch=main&label=CI)](https://github.com/StanislavKozachenko/claude-mods/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/StanislavKozachenko/claude-mods/blob/main/LICENSE)

A collection of [Claude Code](https://code.claude.com) mods, shipped as plugins.

A mod is a small TypeScript function in a plugin that hooks into Claude Code itself: it can hold or rewrite a tool call, draw UI, add a command, or replace a built-in feature. Mods run inside the Claude Code process, so there is no subprocess per event, no `jq` and no exit codes.

## Install

Add the marketplace once, then install the mods you want:

```text
/plugin marketplace add StanislavKozachenko/claude-mods
/plugin install <mod>@claude-mods
```

The short form clones over SSH. Without a GitHub SSH key (the add fails with `Host key verification failed`), use the HTTPS URL instead:

```text
/plugin marketplace add https://github.com/StanislavKozachenko/claude-mods.git
```

## Updates

Claude Code does not update mods from this marketplace by itself: auto-update is on by default only for Anthropic's own marketplaces. To turn it on, open `/plugin`, go to **Marketplaces**, select **claude-mods** and enable auto-update. Claude Code then checks after the first message of a session, within about ten minutes, and installs new releases; a restart applies them.

By hand:

```text
/plugin marketplace update claude-mods
/plugin update <mod>@claude-mods
```

An update arrives with a release, when the mod's version changes, not with every commit to the repository. Each mod's releases and what changed are on the [releases page](https://github.com/StanislavKozachenko/claude-mods/releases) and in [CHANGELOG.md](CHANGELOG.md).

## Mods

| Mod | What it does |
| --- | --- |
| [ci-budget](plugins/ci-budget) | Keeps GitHub Actions spend in sight: this month's minutes and cost for the repo's organisation or account, GitHub budgets, risky workflows as they are written, and runs that hang |
| [context-bar](plugins/context-bar) | Shows the context window as a stacked bar above the prompt, one colour per `/context` category; `/context-bar` toggles it |
| [guard](plugins/guard) | Blocks destructive shell commands and access to secret files before they run, anywhere in a compound command |
| [log-trim](plugins/log-trim) | Condenses noisy command output (installs, builds, tests, containers, CI logs) before the model reads it: progress and repeats out, every error kept, the full log one read away |
| [notify](plugins/notify) | Notifications that say what happened: a long turn finished, a permission prompt or a question waiting, an Actions budget running low; on the desktop and, through Claude Code push, on your phone |
| [redact](plugins/redact) | Keeps secrets that tools print (keys, tokens, passwords, private keys) out of what the model reads and the next request sends |
| [turn-stats](plugins/turn-stats) | Adds what a turn did to its 'Worked for' line: tool calls by tool, failures, files changed and cost |

## Develop

Each mod lives in `plugins/<name>/` and is a regular Claude Code plugin whose `hooks/hooks.json` names a TypeScript hooks module.

```bash
npm ci                                    # pins the Claude Code version CI checks against
npx claude --plugin-dir plugins/<name>    # load a mod from disk; saving a file hot-reloads it
npm run check -- <name>                   # validate, typecheck and test one mod
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

> Mods are an early-access Claude Code API and may change between releases. CI checks every mod against the pinned Claude Code version, and Dependabot bumps that pin.

## License

[MIT](LICENSE)
