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

- Start at version `0.0.0`; the first release makes it `0.1.0`
- Add the mod to `.claude-plugin/marketplace.json` with its name, `"version": "0.0.0"` and `"source": "./plugins/<name>"`, and to the `mod` options in `.github/workflows/release.yml` (`npm run check` fails until both are there). The first release moves its source to its release tag
- Mods run on Linux, Windows and macOS, whose builds have different built-in tools (Linux has no `Grep`): match a tool that is not on every build by name, not by its types. CI checks each mod on all three
- Load it from disk with `npx claude --plugin-dir plugins/<name>`; saving a file reloads it. Loading writes the API's types for that Claude Code build to `plugins/<name>/.claude-plugin/types/` (git-ignored), which your editor and `tsc` read
- `npm run check -- <name>` runs `claude plugin validate --strict`, `tsc` and `claude plugin test` for that mod; without a name it checks every mod
- The `.d.ts` Claude Code writes is the API reference; inside Claude Code, the `plugin-authoring` skill explains it

## Releases

Each mod is versioned on its own. The maintainer runs the **Release** workflow (Actions → Release → Run workflow, or `gh workflow run Release -f mod=<mod> -f bump=auto`) and picks the mod and a bump. `auto` derives it from the mod's commits since its last tag: a breaking change → major (minor while 0.x), `feat` → minor, otherwise patch. `node scripts/release.mjs <mod> --dry-run` previews it locally.

The workflow checks the mod, bumps the version in `plugin.json` and `marketplace.json`, adds a `CHANGELOG.md` entry from the mod's commits, commits that to `main` through the GitHub API (so the commit is signed and Verified), and publishes a `<mod>--v<version>` GitHub release on it. Installed copies pick the new version up with `/plugin update` or auto-update.

A released mod is installed from its release tag, not from `main`: its marketplace entry is a `git-subdir` source whose `ref` is `<mod>--v<version>`, which the Release workflow rewrites on every release (`scripts/market-source.mjs`). So a change merged into `main` reaches nobody until it is released, and `npm run check` fails if an entry points anywhere else.

The release commit is the only commit that lands on `main` without a PR. It needs a `RELEASE_TOKEN` secret: a token of the repo admin with contents write access, the one actor the `main` ruleset lets past the PR requirement.

## Dependencies

Dependabot keeps the pinned Claude Code version, the dev tools and the GitHub Actions current. Patch and minor updates merge on their own once `CI ok` is green, which for a Claude Code update means every mod passed on all three platforms against the new build. Major updates are labelled `breaking` and wait for a maintainer.
