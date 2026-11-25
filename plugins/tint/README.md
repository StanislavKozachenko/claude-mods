# tint

Tints the backdrop of the Claude Code desktop app by where the session works, so with several sessions open you see at a glance which project each one is in, and which ones are on a branch to be careful with.

```text
/plugin install tint@claude-mods
```

- Each repository gets a calm hue of its own at the edges of the window, the same on every machine: it is worked out from the remote's repository name (`org/shop.git` → `shop`), or from the folder's name outside a repository. Worktrees and clones of one repository share it
- A warning glow, in the app's own warning colour, replaces it on the repository's default branch, on branches matching `riskyBranches` (`main`, `master`, `release/*`, `hotfix/*`, `prod*`, `production`) and in working copies under a folder matching `riskyPaths` (`prod`, `production`, `deploy`)
- Calm hues stay out of the reds, oranges and ambers, so a calm project never looks like a warning
- The middle of the window keeps the app's own surface, where the conversation is: only the edges are tinted, in light and dark mode alike
- The tint is chosen when the session starts and checked again after every turn, so a `git switch main` in the session turns it to a warning when the turn ends

The backdrop is drawn by the desktop and mobile apps only. In the terminal and in editors the mod does nothing visible.

## `/tint`

Says why the backdrop has the tint it has (`shop on release/2.0: warning tint, branch release/2.0 matches release/*.`) and sets it again, for when another mod's theme replaced it.

## Options

| Option | Default | |
| --- | --- | --- |
| `riskyBranches` | `main`, `master`, `release/*`, `hotfix/*`, `prod*`, `production` | Globs of branch names that get the warning tint; `*` is any run of characters, case is ignored |
| `defaultBranch` | `true` | The repository's default branch gets the warning tint whatever its name |
| `riskyPaths` | `prod`, `production`, `deploy` | Globs of folder names; a working copy under one gets the warning tint |

## With other themes

A session has one theme, whichever mod set it last. The mod sets the backdrop alone, so it replaces a theme another mod set at session start (its colours too), and that mod's theme replaces this one if it sets one later. Keep one theme mod enabled, or run `/tint` to put the tint back.
