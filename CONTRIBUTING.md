# Contributing

## Reporting bugs

Open an issue with the mod name, your Claude Code version (`claude --version`), what you did, and what happened instead. A failing hook is reported in the transcript as a dim line naming the mod: include it.

## Proposing a mod

Open a **New mod** issue: what it does, which events it hooks, and why it belongs in a shared collection rather than in your own settings.

## Submitting changes

Nothing is pushed to `main` directly. Every change goes through an issue and a pull request:

1. Open (or pick) an issue
2. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `ci/…`, `chore/…`
3. Make the change, add or update tests
4. Run `npm run check` — it must pass
5. Open a pull request with `Closes #N` in the body; CI runs automatically
6. A maintainer squash-merges it once the `CI ok` check is green

One change per branch, issue and PR.

## Commit and PR titles

PRs are squash-merged and the PR title becomes the commit on `main`, so it is a single [Conventional Commits](https://www.conventionalcommits.org/) line:

```text
feat(guard): block git push --force to protected branches
fix(guard): match rm with split -r -f flags
docs: describe local development
ci: cache npm in the mods job
```

- The scope is the mod name when the change is inside `plugins/<name>/`
- `feat` → minor, `fix` / `perf` / `refactor` → patch, `!` after the type (`feat(guard)!:`) → major
- No `Closes #N` in commit messages, only in the PR body; no co-author trailers

CI checks the PR title.

## Developing a mod

```text
plugins/<name>/
  .claude-plugin/plugin.json   # name, version, description, userConfig
  hooks/hooks.json             # { "modules": ["./register.ts"] }
  hooks/register.ts            # export const register: Register = (on, options) => { ... }
  hooks/*.test.ts              # tests run by `claude plugin test`
  types/index.d.ts             # only if the mod keeps values in $.state
  tsconfig.json                # extends the types Claude Code writes on load
  README.md
```

- Add the mod to `.claude-plugin/marketplace.json` with the same name and version
- Load it from disk with `npx claude --plugin-dir plugins/<name>`; saving a file reloads it. Loading writes the API's types for that Claude Code build to `plugins/<name>/.claude-plugin/types/` (git-ignored), which your editor and `tsc` read
- `npm run check -- <name>` runs `claude plugin validate --strict`, `tsc` and `claude plugin test` for that mod; without a name it checks every mod
- The `.d.ts` Claude Code writes is the API reference; inside Claude Code, the `plugin-authoring` skill explains it

## Releases

Each mod is versioned on its own. The maintainer runs the **Release** workflow (Actions → Release → Run workflow) and picks the mod and a bump (`auto` derives it from the mod's commits). The workflow bumps the version in `plugin.json` and `marketplace.json`, adds a `CHANGELOG.md` entry from the mod's commits, commits that to `main`, tags `<mod>--v<version>` and publishes a GitHub release.

The release commit is the only commit that lands on `main` without a PR.
