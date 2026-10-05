# ci-budget

Keeps GitHub Actions spend in sight while Claude writes workflows and pushes, so an organisation's or an account's minutes do not run out by accident:

- **Budget** of whoever pays for the current repo's runs (its organisation or personal account): this month's minutes by runner, the share of the plan's included minutes, the cost, the repo's own share, and whether a GitHub budget stops usage at a limit
- **Workflow check**: when a `.github/workflows/*.yml` file is written or edited, the spend risks in it go back to the model and show as a toast
- **Run watch**: after `git push` or `gh workflow run`, the runs it started are followed; a job running too long is flagged with the command to cancel it
- **Storage**: the repo's Actions cache (10 GB limit) and artifacts
- **Block**: from `blockAt` (100% by default) `gh workflow run` is denied until you allow it

```text
/plugin install ci-budget@claude-mods
```

The status line reads `Actions 62% · acme`, `Actions ~140 min (estimate) · acme/app` or adds `CI 2 running` / `CI ✓` / `CI ✗ 1 failed` while runs are watched. `/ci-budget` prints the full report, including what to set up for exact numbers.

## What you need

The mod reads GitHub through the **GitHub CLI you are logged into**: it stores no token and asks for nothing more than your `gh` login allows. It works for anyone who installs it; how exact the numbers are depends on that access:

| Your access | What you get |
| --- | --- |
| **Owner or billing manager of the organisation** | Exact usage from GitHub billing: minutes by runner, cost, % of included minutes, every repo's share, the Actions budget |
| **Your own account** with the `user` scope | The same for your personal repos |
| **Member or collaborator** (no billing access) | An **estimate** for the current repo: its finished jobs this month, rounded up to the minute and weighed by runner (Linux ×1, Windows ×2, macOS ×10, self-hosted free). Other repos of the owner are not counted. Marked as an estimate everywhere |
| **Public repo** | Its runs on GitHub-hosted runners are free; the report says so |
| **No access to the repo's Actions** | Workflow check and nothing else, with a hint |

Without billing access nothing breaks: the mod falls back to the estimate and says which access would give exact numbers.

## Setup

**1. GitHub CLI**, logged in:

```bash
# https://cli.github.com
gh auth login
gh auth status        # shows the scopes your token has
```

The default `gh auth login` scopes (`repo`, `read:org`, `workflow`) are enough for the repo level: runs, jobs, cache, artifacts, run watch.

**2. Billing of an organisation** (exact numbers): you must be an **owner** or **billing manager** of it. In testing, an owner's default `read:org` scope was enough. If the report says billing was refused although you are an owner or billing manager, add the scope:

```bash
gh auth refresh -h github.com -s admin:org
```

Members cannot read an organisation's billing; ask an owner, or rely on the estimate.

**3. Billing of your personal account**:

```bash
gh auth refresh -h github.com -s user
```

**4. A GitHub budget that stops usage** — the actual hard limit. ci-budget warns and can block `gh workflow run` inside Claude Code, but only GitHub can stop runs, including the ones a push starts. Create one once per organisation or account:

- organisation: **Settings → Billing and licensing → Budgets and alerts → New budget**
- personal account: **Settings → Billing and licensing → Budgets and alerts → New budget**

Pick the **Actions** product, set the amount (`$0` allows the included minutes only) and turn on **stop usage when the budget limit is reached**. `/ci-budget` shows whether such a budget exists and warns when Actions has none.

Run `/ci-budget refresh` after changing access.

## The workflow check

Flags, with how to fix each:

- jobs without `timeout-minutes` (a stuck job runs up to 6 hours)
- a matrix of 6 or more jobs per run
- macOS (×10) and Windows (×2) runners in a private repo
- pull request workflows without `concurrency` + `cancel-in-progress`
- `push` to every branch together with `pull_request` (each PR push runs twice)
- schedules that fire 24 or more times a day
- `workflow_run` on the workflow's own name (each run starts another)

The check reads the YAML text (a mod has no YAML parser), so it can miss an unusual layout; it never blocks a write.

## Options

| Option | Default | |
| --- | --- | --- |
| `warnAt` | `80` | Toast when usage crosses each of these percentages of the included minutes |
| `blockAt` | `100` | Deny `gh workflow run` from this percentage (billing data only); `0` never blocks |
| `includedMinutes` | `0` | Included minutes per month; `0` takes them from the plan (Free 2 000, Pro and Team 3 000, Enterprise 50 000) |
| `stuckMinutes` | `30` | A watched job running longer than this is flagged |
| `refreshMinutes` | `15` | How often usage is read again |
| `lint` | `true` | Check workflows as they are written |
| `watch` | `true` | Follow the runs a push or a dispatch starts |

`/ci-budget off` pauses the block for the session and `/ci-budget on` restores it; both are accepted only from you at the prompt, never from another agent or a channel.

## Limits

- GitHub's billing data is not real time; the run watch reads the runs themselves.
- Larger runners are always billed and never count toward the included minutes; they show in the minutes and the cost.
- Only github.com; GitHub Enterprise Server is not supported.
- A fine-grained token in `GH_TOKEN` works if it grants the same access; the mod reports whatever it is refused.
- The estimate counts finished runs of the current month in the current repo, up to 300 runs; a busy repo is filled in over a few refreshes.
