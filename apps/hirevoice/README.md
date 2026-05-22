# @hirevoice/junior-bot

Deployable Junior app for the Hirevoice Slack workspace.

## What's wired

- **Slack** ingress: `/api/webhooks/slack` (built into `@sentry/junior`). Junior responds to mentions in any public channel or thread.
- **Browser automation**: `@sentry/junior-agent-browser` — Chromium + system libs are baked into the Vercel Sandbox snapshot at build time.
- **GitHub**: `@sentry/junior-github` — PR/issue ops via `gh`, auth via GitHub App.
- **PR-preview subscriptions** (`app/plugins/hirevoice-pr-watch`):
  - `/watch-preview` — subscribe the current thread to a PR's preview deploys.
  - `/verify-preview` — drive the preview in agent-browser, post the report in-thread, mark the sub verified.
  - `/list-watches` — show what this thread/channel is watching.
  - `/unwatch-preview` — stop watching.
- **GitHub preview-event ingress**: `POST /api/webhooks/github` accepts `issue_comment`, `deployment_status`, and `check_run` events, normalizes to `(repo, pr, preview_url, sha)`, looks up every active subscription for that PR in Turso, dedupes by `last_verified_url`, and posts a `/verify-preview` mention into each subscribed Slack thread.
- **Subscription store**: Turso (libsql). Schema in `db/schema.sql`. Subscriptions are keyed by `(repo, pr_number, slack_channel_id, slack_thread_ts)`.

## End-to-end flow

```
User in any Slack channel/thread:
  @junior watch hirevoice/platform#1234
        ↓
  /watch-preview skill → POST /api/internal/subscriptions → row inserted
        ↓
  Junior replies in-thread: "Watching #1234 at <sha>"

Time passes. New commit pushes; Vercel deploys a fresh preview.

GitHub webhook fires (issue_comment | deployment_status | check_run):
        ↓
  /api/webhooks/github normalizes → looks up subs → dedupe by URL
        ↓
  chat.postMessage(channel, thread_ts, "<@junior> /verify-preview pr=… url=… sha=… sub=…")
        ↓
  Junior's normal Slack ingress runs /verify-preview IN THAT THREAD
        ↓
  Browser flow, recording, PR comment, sub PATCHed as verified at URL
```

## Run locally

```bash
pnpm install
pnpm --filter @hirevoice/junior-bot migrate     # one-time schema apply
pnpm --filter @hirevoice/junior-bot dev
```

Tunnel `:3000` (cloudflared/ngrok). Point Slack Event Subscriptions and the
`hirevoice/platform` GitHub webhook at the tunnel URL.

## Required env

Copy `.env.example` and fill:

| Var                                       | Why                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Junior's Slack identity + inbound verification.                                                    |
| `REDIS_URL`                               | Junior's queue backend (agent turns).                                                              |
| `AI_MODEL` (+ siblings)                   | Model selection.                                                                                   |
| `GITHUB_APP_*`                            | GitHub App for PR/issue ops. See `extend/github-plugin.md`.                                        |
| `GITHUB_WEBHOOK_SECRET`                   | Shared secret on the `hirevoice/platform` repo webhook.                                            |
| `HIREVOICE_JUNIOR_SLACK_USER_ID`          | Junior's Slack user id (`U…`) used in the @mention text the webhook posts.                         |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`  | Subscription store.                                                                                |
| `JUNIOR_INTERNAL_TOKEN`                   | Bearer the skills use to call `/api/internal/subscriptions`. Generate with `openssl rand -hex 32`. |
| `JUNIOR_BASE_URL`                         | The bot's own deploy URL. Skills curl this for subscription ops.                                   |

`HIREVOICE_PREVIEW_COMMENT_AUTHOR` defaults to `vercel[bot]`; override if your
preview comment comes from a different actor.

## GitHub repo webhook setup

On `hirevoice/platform` → Settings → Webhooks → Add webhook:

- Payload URL: `https://<deploy>/api/webhooks/github`
- Content type: `application/json`
- Secret: same as `GITHUB_WEBHOOK_SECRET`
- Events: **Issue comments**, **Deployment statuses**, **Check runs**
- Active: yes

The handler only acts on events that resolve to a `(repo, pr, preview_url)`
triple matching an active subscription. Everything else returns 204.

## Turso setup

```bash
turso db create hirevoice-junior
turso db tokens create hirevoice-junior --expiration none
turso db show hirevoice-junior --url
```

Drop the URL into `TURSO_DATABASE_URL` and the token into `TURSO_AUTH_TOKEN`.
Then:

```bash
pnpm --filter @hirevoice/junior-bot migrate
```

## Customizing behavior

- `app/SOUL.md` — Junior's voice/persona for this workspace.
- `app/WORLD.md` — operational facts about Hirevoice's setup.
- `app/DESCRIPTION.md` — user-facing one-liner.
- `app/plugins/hirevoice-pr-watch/skills/verify-preview/SKILL.md` — the
  verification recipe. Update the "PR-derived interactions" section as the
  product changes.

## Re-running verification on demand

Mention Junior in the watched thread: `@junior re-verify this`. That routes
directly to `/verify-preview` against the current `headRefOid` and preview
URL — no DB write, no dedupe. Useful when a GitHub Action redeploys without a
new Vercel-bot comment.
