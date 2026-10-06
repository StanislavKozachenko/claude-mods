# log-trim

Condenses noisy command output before the model reads it. Installs, builds, test runs, `docker build` and CI logs put thousands of lines of progress bars, colour codes and repeats into the context, and into every later request; log-trim keeps what matters.

A real `npm run build` of 401 lines, as the model gets it:

```text
[log-trim: 401 → 19 lines; full output: /tmp/claude-log-trim/toolu_01Cc7y4D….log]
> app@1.0.0 build
✓ compiled src/modules/module-1.ts in 11ms
… 298 similar lines
✓ compiled src/modules/module-300.ts in 40ms
warning src/legacy.ts: "moment" is deprecated, use date-fns
  asset chunk-1.js 3.7 KiB
… 38 similar lines
  asset chunk-40.js 148.0 KiB
ERROR in src/api/client.ts:42:7
TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
    at checkCall (node_modules/typescript/lib/tsc.js:1200:5)
    at Object.check (node_modules/typescript/lib/tsc.js:1300:9)
  cleanup step 1 done
… 28 similar lines
  cleanup step 30 done
build failed with 1 error
```

```text
/plugin install log-trim@claude-mods
```

## What it does

- strips colour codes, and of a line redrawn with `\r` keeps only its last state
- drops lines that only draw progress: bars, spinners, percentages, download counters
- collapses runs of lines that differ only in numbers or hashes into the first, the last and a count
- above `maxLines` (150) keeps the head, **every error and warning line with its stack**, and the tail
- puts the full output in a temp file and names it in the first line, so the model can read what was left out

**Very long output.** Past about 30 KB Claude Code saves the output to a file and gives the model only its first ~2 KB: the errors at the end of a long build are not in it. log-trim reads that file and gives the model the digest of the whole output instead, with the same path. In a live run of a 3 100-line build the model reported the error from line ~3 090, which the preview did not contain.

## Which commands

Bash and PowerShell results of commands that are mostly noise: package managers (`npm`, `pnpm`, `yarn`, `bun`, `pip`, `poetry`, `uv`, `cargo`, `go`, `mvn`, `gradle`, `dotnet`, `composer`, `bundle`), builds and tests (`make`, `tsc`, `jest`, `vitest`, `pytest`, `webpack`, `vite`, `next`, `turbo`, `nx`, …), containers and infrastructure (`docker`, `kubectl`, `helm`, `terraform`), and `gh run view --log`. Add your own with `commands`.

Never touched: commands that show files or diffs, whose exact text matters (`cat`, `head`, `tail`, `grep`, `sed`, `ls`, `git diff`, `git log`, `git show`, …), output that would not get at least 20% shorter, and every other tool.

## `/log-trim`

`/log-trim` shows how many outputs were condensed this session and about how many tokens stayed out of the context. `/log-trim off` lets output through untouched for the session, `/log-trim on` resumes; both only from the person at the prompt.

## Options

| Option | Default | |
| --- | --- | --- |
| `maxLines` | `150` | After cleaning, a longer output keeps its head, errors with their stacks, and its tail |
| `commands` | `[]` | Extra regular expressions matched against the command |
