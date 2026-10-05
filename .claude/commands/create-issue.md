Create a GitHub issue for the claude-mods project following the project's established conventions.

## Issue format

**Title:** `"Area: short description"` — the area is the mod name or a repo area (`Setup`, `CI`, `Release`, `Dependabot`, `Docs`)

Examples:
- `guard: block git push --force to protected branches`
- `guard: rm with split -r -f flags is not matched`
- `CI: typecheck mods against the pinned Claude Code build`
- `Mod: context-bar — stacked context usage bar above the prompt`

**Body:** an optional one or two sentences of context (what is wrong or missing, with a source when it is about Claude Code behaviour), then a bullet list of deliverables. Each bullet covers one concrete deliverable. The last bullet says how it is verified.

Example body:
```
`rm -r -f /` is not matched: the rule only knows the joined `-rf` / `-fr` spellings.

- Match `rm` with `-r`/`-R`/`--recursive` and `-f`/`--force` in any order and spelling
- Unit tests for split, joined and long flags
- Live-verify through `claude -p --plugin-dir plugins/guard`
```

## Steps

1. Ask the user what the issue is about if not already clear from context.
2. Determine the area and short description.
3. Draft the body.
4. Choose labels (at least one):
   - `enhancement` — new feature or improvement
   - `bug` — something is broken
   - `new mod` — a new mod
   - `mod: <name>` — the mod it concerns (create the label for a new mod)
   - `documentation`, `ci/cd`, `chore`, `breaking`

5. Create the issue:

```sh
gh issue create \
  --title "Area: short description" \
  --label "enhancement" --label "mod: guard" \
  --assignee "StanislavKozachenko" \
  --body "$(cat <<'EOF'
- bullet 1 with `code`
- bullet 2
EOF
)"
```

**IMPORTANT — backtick escaping:** inside the `<<'EOF'` heredoc, never escape backticks. Write `` `code` ``, not `` \`code\` ``: the quoted EOF keeps the content literal, so a backslash reaches GitHub and breaks the Markdown.

6. Report the issue URL and number to the user.
