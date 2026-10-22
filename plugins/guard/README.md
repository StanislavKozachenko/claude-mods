# guard

Blocks destructive shell commands and access to secret files before they run.

Settings `permissions.deny` rules match command prefixes, so `cd app && rm -rf ~`, `rm -fr /`, `rm -r -f /` or `git push origin main -f` get past them. guard sees every tool call inside Claude Code, splits compound commands, normalizes flags and wrappers (`sudo`, `env`, `VAR=1`), and resolves symlinks before it lets a file through.

```text
/plugin install guard@claude-mods
```

## What it blocks

**Destructive commands** (Bash), anywhere in a compound command:

| Rule | Blocks | Lets through |
| --- | --- | --- |
| `rm-rf` | `rm` recursive + force on `/`, `~`, `$HOME`, `.`, `..`, `*`, `/usr`, `/home/me`, `C:/`, a bare `$VAR/` | `rm -rf node_modules`, `rm -rf ./dist`, `rm -rf "${OUT:?}/"` |
| `git-force-push` | `--force`, `-f`, `-fu`, `+refspec` | `--force-with-lease` |
| `git-reset-hard` | `git reset --hard` | `--soft`, `--mixed` |
| `git-clean` | `git clean -f…` | `git clean -n` |
| `chmod-777` | `chmod -R 777` | `chmod 755 file` |
| `disk-write` | `mkfs*`, `dd of=/dev/…` | `dd of=./disk.img` |
| `pipe-to-shell` | `curl … \| sh`, `wget … \| sudo bash` | `curl -o install.sh …` |
| `fork-bomb` | `:(){ :\|:& };:` | |

**Secret files**: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519` and friends, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.aws/credentials`, `.docker/config.json`, except `.env.example`, `.env.sample`, `.env.template`, `.env.dist` and `*.pub`.

They are blocked for `Read`, `Edit`, `Write`, `NotebookEdit` and `Grep`, on the path as given and on where it resolves (a symlink to `.env` is `.env`), and in shell commands that read, send or write them: `cat .env`, `grep KEY .env`, `curl -d @.env`, `echo X >> .env`, `cp .env /tmp`, `git add .env`. Commands that only name them pass: `cp .env.example .env`, `echo .env >> .gitignore`, `source .env`.

**PowerShell** (the `PowerShell` tool of Claude Code on Windows) gets the same rules and options, read in PowerShell's own syntax: cmdlets and their aliases, case-insensitive parameters that may be abbreviated (`-rec`, `-fo`), and `-Name:value`.

| Rule | Blocks | Lets through |
| --- | --- | --- |
| `rm-rf` | `Remove-Item -Recurse` (and `rm`, `del`, `rd`, `ri`, `cmd /c rd /s`) on `C:\`, `C:\Users\me`, `$env:USERPROFILE`, `$HOME`, `.`, `..`, a bare `$dir\`. PowerShell's `-Recurse` deletes without asking even without `-Force`, so `-Force` is not required for the block | `Remove-Item -Recurse -Force .\node_modules`, `rm -r dist` |
| `pipe-to-shell` | `iwr … \| iex`, `irm … \| Invoke-Expression`, `iex (New-Object Net.WebClient).DownloadString(…)` | `iwr … -OutFile install.ps1` |
| `disk-write` | `Format-Volume`, `Clear-Disk`, `Initialize-Disk`, `Remove-Partition`, `diskpart`, `format D:` | `Get-Volume` |
| `chmod-777` | `icacls … /grant Everyone:F /T` | `icacls … /grant me:R` |
| git rules | as for Bash | |

Secret files are blocked in `Get-Content`/`gc`/`type`, `Select-String`, `Copy-Item`/`Move-Item` sources, `Set-Content`/`Add-Content`/`Out-File` paths, redirections (`> .env`) and `Invoke-WebRequest -InFile`; `Copy-Item .env.example .env` and `Add-Content .gitignore ".env"` pass.

The model gets the rule and what to do instead, e.g.:

```text
guard blocked this (git-force-push): it force-pushes and can overwrite commits on the remote. Use --force-with-lease, or ask the user.
```

## `/guard`

- `/guard` lists the active rules and what was blocked this session
- `/guard off` pauses it for the session, `/guard on` resumes it. Only accepted from the person (the prompt, Remote Control, the SDK host), never from another agent, a peer session or a channel message

The status line shows `guard: N blocked` (or `guard: paused`).

## Options

Set them in `/config` or under `pluginConfigs.guard.options` in settings:

| Option | Default | |
| --- | --- | --- |
| `destructive` | `true` | Block destructive commands |
| `rmMode` | `dangerous` | `any` blocks every `rm -rf` |
| `secrets` | `true` | Protect secret files |
| `blockCommands` | `[]` | Extra regular expressions tested against every Bash command, e.g. `\bnpm publish\b` |
| `protectPaths` | `[]` | Extra gitignore-like globs no tool may read or write, e.g. `migrations/**` |
| `allowPaths` | `[]` | Globs exempt from the file rules, e.g. `test/fixtures/**` |

## Limits

guard is a safety net against accidents, not a sandbox. The command check is a heuristic, not a shell parser: `eval`, scripts the model writes and then runs, interpreters (`python -c`, `node -e`), PowerShell script blocks and `Start-Process` are not inspected. Use Claude Code's sandbox and permission modes for containment.
