# @hirevoice/junior-bot

Deployable Junior app for the Hirevoice Slack workspace.

## What's wired

- **Slack** ingress: `/api/webhooks/slack` (built into `@sentry/junior`).
- **Browser automation**: `@sentry/junior-agent-browser` plugin — Chromium + system libs are baked into the Vercel Sandbox snapshot at build time.
- **GitHub**: `@sentry/junior-github` plugin — PR/issue operations via `gh` CLI, auth via GitHub App.
- **Preview-comment ingress**: a custom `POST /api/webhooks/github` route in `server.ts` that fires when the Vercel bot comments a preview URL on a PR. It posts a `/verify-preview` mention into the configured Slack channel so the normal Junior ingress runs the `verify-preview` skill.

## Run locally

```bash
pnpm install
pnpm --filter @hirevoice/junior-bot dev
```

Tunnel `:3000` (cloudflared/ngrok) and point Slack Event Subscriptions and
the GitHub repo webhook at the tunnel URL.

## Required env

Copy `.env.example` and fill in:

| Var                              | Why                                                  |
| -------------------------------- | ---------------------------------------------------- |
| `SLACK_BOT_TOKEN`                | Junior posts in Slack as this bot.                   |
| `SLACK_SIGNING_SECRET`           | Verify inbound Slack webhooks.                       |
| `REDIS_URL`                      | Queue backend for agent turns.                       |
| `AI_MODEL` and siblings          | Model selection for Junior turns.                    |
| `GITHUB_APP_*`                   | GitHub App credentials (see below).                  |
| `GITHUB_WEBHOOK_SECRET`          | Shared secret on the `hirevoice/platform` webhook.   |
| `HIREVOICE_PR_CHANNEL_ID`        | Slack channel that receives `/verify-preview` calls. |
| `HIREVOICE_JUNIOR_SLACK_USER_ID` | Junior's Slack user id (`U...`) for the @mention.    |

`HIREVOICE_PREVIEW_COMMENT_AUTHOR` defaults to `vercel[bot]`. Override if your
preview comment comes from a different actor.

## GitHub webhook setup

On `hirevoice/platform` → Settings → Webhooks → Add webhook:

- Payload URL: `https://<deploy>/api/webhooks/github`
- Content type: `application/json`
- Secret: same value as `GITHUB_WEBHOOK_SECRET`
- Events: **Issue comments** only
- Active: yes

The route only acts on `issue_comment.created` from the configured preview-bot
author on a PR (not a plain issue). Everything else returns 204.

## GitHub App setup

Per `extend/github-plugin.md`:

1. Create a GitHub App. Permissions: `Actions: r/w`, `Issues: r/w`, `Contents: r/w`, `Pull requests: r/w`, `Metadata: r`.
2. Install it on `hirevoice/platform`.
3. Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `GITHUB_APP_BOT_NAME`, `GITHUB_APP_BOT_EMAIL`.

## Verify the flow

1. `GET /health` returns ok.
2. Mention Junior in any Slack channel — replies in-thread.
3. Open a PR on `hirevoice/platform`. When the Vercel preview is ready and the
   bot comments, watch `HIREVOICE_PR_CHANNEL_ID` for the `/verify-preview` mention.
4. The `verify-preview` skill runs; the PR gets a Junior comment with the result.

## Customizing behavior

- `app/SOUL.md` — Junior's voice/persona for this workspace.
- `app/WORLD.md` — operational facts about Hirevoice's setup.
- `app/DESCRIPTION.md` — user-facing one-liner.
- `app/skills/verify-preview/SKILL.md` — the verification recipe. Update the
  "interaction steps" section as the product changes.
