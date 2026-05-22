---
name: verify-preview
description: Drive a Hirevoice PR's Vercel preview in agent-browser, record the run, and post the result as a PR comment. Use when asked to "verify preview", "qa this PR", or when a `/verify-preview` mention arrives with a PR ref and preview URL.
allowed-tools: bash attachFile
---

# Verify Preview

Trigger shape (what arrives in the Slack mention or DM):

```
/verify-preview pr=<owner/repo>#<number> url=<preview-url>
```

Inputs to extract:

- `pr` → repo (e.g. `hirevoice/platform`) and PR number
- `url` → the live Vercel preview URL from the Vercel-bot comment

If either is missing, ask once for the missing piece and stop.

## 1. Confirm the preview is actually live

The preview URL arrives the moment the Vercel bot edits its comment, but the
deployment can still be propagating. Hit it before driving the browser:

```bash
curl -sI -o /dev/null -w "%{http_code}\n" "<preview-url>"
```

If non-2xx after one retry (10s pause), post a single Slack reply with the
status code and stop. Do not loop further — the GitHub-comment trigger will
fire again on the next edit.

## 2. Read the PR for what changed

```bash
gh pr view <owner/repo>#<number> --repo <owner/repo> --json title,body,files
```

Use the body and changed-file list to pick what to exercise. If the PR body
includes a "Verify:" or "Test plan:" section, follow it literally. Otherwise:

- Public landing/dashboard route changes → open the route, snapshot, screenshot.
- API/server-only changes → state that there is nothing visual to verify and
  stop here. Do not invent a UI check.

## 3. Drive it in agent-browser, with a recording

Use one named session so cookies persist across steps:

```bash
SESSION="pr-<number>"
RECORDING="/tmp/${SESSION}-$(date +%s).webm"

agent-browser --session "$SESSION" record start "$RECORDING"
agent-browser --session "$SESSION" open "<preview-url>"
agent-browser --session "$SESSION" wait --load networkidle
agent-browser --session "$SESSION" snapshot -i
# ... interaction steps derived from the PR body ...
agent-browser --session "$SESSION" screenshot --annotate "/tmp/${SESSION}-result.png"
agent-browser --session "$SESSION" record stop
```

Re-`snapshot -i` after any navigation or DOM change before using `@e*` refs.

## 4. Post the deliverable to GitHub

The PR comment is the canonical output. Slack is just a status surface.

```bash
gh pr comment <owner/repo>#<number> --repo <owner/repo> --body "$(cat <<EOF
**Junior preview check** — \`<preview-url>\`

What I exercised:
- <one bullet per concrete step you ran>

Result: <pass | fail — one sentence>

Recording: <attached in the Slack thread>
EOF
)"
```

Then in the Slack thread, `attachFile` the recording webm and the final
screenshot so the thread has the artifacts. Do not claim the file was
attached unless `attachFile` returned `attached: true`.

## 5. On failure

- Browser launch error: state the failure and the recording path, then stop.
  Do not retry — the sandbox snapshot needs a rebuild and that is operator work.
- Login-gated UI with no credentials in the request: stop and ask once in the
  Slack thread for credentials or an auth-vault session name.
- 5xx from the preview: stop, post the status code as a PR comment, do not retry.

## What this skill does not do

- Code review on the diff. That is `/code-review` territory.
- Re-triggering Vercel builds.
- Running E2E or unit test suites — only live browser interaction against the
  preview URL.
