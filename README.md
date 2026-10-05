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

## Mods

| Mod | What it does |
| --- | --- |
| [context-bar](plugins/context-bar) | Shows the context window as a stacked bar above the prompt, one colour per `/context` category; `/context-bar` toggles it |
| [guard](plugins/guard) | Blocks destructive shell commands and access to secret files before they run, anywhere in a compound command |

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
