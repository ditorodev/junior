---
name: watch-preview
description: Subscribe the current Slack thread to verify-preview runs for a Hirevoice PR. Use when a user says "watch this PR", "verify when ready", "qa when preview lands", or any variant mentioning a PR ref. The thread is then notified in-thread every time a new Vercel preview deploys.
allowed-tools: bash
---

# Watch Preview

Register a subscription so that when GitHub fires a preview-related event for
the given PR, Junior runs `/verify-preview` here, in this thread, with the new
preview URL.

## Inputs

Extract from the user message:

- `repo` — `owner/repo`, e.g. `hirevoice/platform`. If only a number is given
  and the user has not configured a default repo for this channel, ask once.
- `pr` — the PR number (integer).

The Slack context (channel id, thread ts, requesting user id) is taken from
the thread metadata available to the skill — do not ask the user for it.

## Steps

1. Resolve `repo` and `pr` from the request. If either is missing, ask once
   and stop.

2. Verify the PR exists and is open:

```bash
gh pr view "<repo>#<pr>" --repo "<repo>" --json number,state,title,headRefOid
```

If `state` is not `OPEN`, reply that the PR is already closed/merged and
do not subscribe.

3. Register the subscription against the internal endpoint:

```bash
curl -sS -X POST "${JUNIOR_BASE_URL}/api/internal/subscriptions" \
  -H "Authorization: Bearer ${JUNIOR_INTERNAL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg repo "<repo>" \
                 --argjson pr <pr> \
                 --arg channel "<channel-id>" \
                 --arg thread "<thread-ts>" \
                 --arg user "<requesting-user-id>" \
                 '{repo: $repo, pr_number: $pr, slack_channel_id: $channel, slack_thread_ts: $thread, created_by_user: $user}')"
```

Junior already has the channel id, thread ts, and requesting user id from the
turn context. Use those values literally — do not invent placeholders.

4. Reply in-thread with a single line confirming the watch, including the PR
   title and the current head SHA from step 2 so the user can sanity-check.
   No extra prose.

Example reply:

> Watching hirevoice/platform#1234 ("Add interview ratings") at `a4f9c12`. I'll
> run `/verify-preview` here whenever a new Vercel preview deploys.

## When NOT to subscribe

- PR is closed or merged: reply once, do not subscribe.
- Repo is outside the GitHub App installation: reply with the missing-install
  error and do not subscribe.
- The same `(repo, pr, channel, thread)` already exists as active: the
  endpoint is idempotent. Confirm the existing watch instead of erroring.

## Re-running verification on demand

The user can ask "verify again" or "re-run" in the thread at any time. That is
not this skill — it routes to `/verify-preview` directly with the latest
preview URL. Do not handle re-runs here.
