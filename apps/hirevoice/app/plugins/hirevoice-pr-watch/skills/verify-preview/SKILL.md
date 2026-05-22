---
name: verify-preview
description: Drive a Hirevoice PR's Vercel preview in agent-browser, record the run, and post a verification report into the originating Slack thread. Use when GitHub fanout posts a /verify-preview mention in a thread with pr, url, optional sha and sub fields, OR when a user asks to "verify this preview" or "re-run" with a PR and preview URL in scope.
allowed-tools: bash attachFile
---

# Verify Preview

Trigger shape (what arrives in the Slack mention):

```
/verify-preview pr=<owner/repo>#<number> url=<preview-url> [sha=<short-sha>] [sub=<subscription-id>]
```

- `pr`, `url` — required.
- `sha` — optional short head SHA. Used in the report; if missing, look it up.
- `sub` — optional subscription id. Used to PATCH the row as verified at the
  end. Missing means this is a user-initiated re-run (no DB update).

## 1. Acknowledge in-thread

Post one short line so the user sees the run started:

> Verifying hirevoice/platform#1234 at `a4f9c12` against `https://preview-….vercel.app` …

## 2. Probe the preview

```bash
curl -sI -o /dev/null -w "%{http_code}\n" "<preview-url>"
```

If non-2xx, wait 10s and retry once. On second failure, post the status code
in-thread and stop. Do not loop further — the GitHub webhook will fire again
on the next deploy.

## 3. Read the PR

```bash
gh pr view "<repo>#<pr>" --repo "<repo>" --json title,body,headRefOid,files
```

Use the body + changed-file list to choose what to exercise. If the PR body
includes a `Verify:` or `Test plan:` section, follow it literally. If only
API/server-only files changed, post "no UI changes to verify at `<short-sha>`"
and skip to step 5 with no recording.

## 4. Drive it in agent-browser

```bash
SESSION="pr-<number>"
SHORT_SHA="$(echo <head-sha> | cut -c1-7)"
RECORDING="/tmp/${SESSION}-${SHORT_SHA}.webm"

agent-browser --session "$SESSION" record start "$RECORDING"
agent-browser --session "$SESSION" open "<preview-url>"
agent-browser --session "$SESSION" wait --load networkidle
agent-browser --session "$SESSION" snapshot -i
# ... PR-derived interactions ...
agent-browser --session "$SESSION" screenshot --annotate "/tmp/${SESSION}-${SHORT_SHA}.png"
agent-browser --session "$SESSION" record stop
```

Re-`snapshot -i` after any navigation or DOM change before using `@e*` refs.

## 5. Post the report

In-thread, reply once with the summary + recording. Include the short SHA so
the reader knows which commit was tested:

> **Preview check — `a4f9c12`**
>
> - Probed: `https://preview-….vercel.app` (200)
> - Exercised: <one bullet per concrete step>
> - Result: pass | fail — one sentence
>
> Recording attached.

Then run `attachFile` on the `.webm` and the final `.png`. Do not claim files
were attached unless `attachFile` returned `attached: true`.

Optionally also post the report as a PR comment via `github-code`:

```bash
gh pr comment "<repo>#<pr>" --repo "<repo>" --body "<same body, mrkdwn → GFM>"
```

Only post the PR comment when the run completed end-to-end. Skip PR comments
for the "no UI changes" case.

## 6. Record the run as verified

If `sub=<id>` was in the trigger, mark the subscription so the webhook
deduplicates on future events for the same preview URL:

```bash
curl -sS -X PATCH "${JUNIOR_BASE_URL}/api/internal/subscriptions/<id>" \
  -H "Authorization: Bearer ${JUNIOR_INTERNAL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg url "<preview-url>" --arg sha "<head-sha>" \
                 '{last_verified_url: $url, last_verified_sha: $sha}')"
```

If `sub` was missing (user re-run), skip this step.

## On failure

- Browser launch error: post the error verbatim and the recording path, stop.
  Do not retry — the snapshot needs an operator rebuild.
- Login-gated UI with no credentials in the request: stop and ask once in the
  thread for credentials or a named auth-vault session.
- 5xx from the preview after the one retry: post the status code and stop.

## What this skill does not do

- Code review on the diff (`/code-review`).
- Re-triggering Vercel builds.
- Running unit/E2E suites — only live browser interaction against the preview.
- Subscription management — that's `/watch-preview`, `/list-watches`,
  `/unwatch-preview`.
