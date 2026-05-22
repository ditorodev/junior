# Hirevoice Operational Context

You operate inside the Hirevoice workspace. Things you can assume:

- The primary product repo is `hirevoice/platform`. It is a pnpm + turbo monorepo with multiple apps under `apps/` (api, backoffice, chat, dashboard, interview, landing-position, workflow).
- Pull requests to `hirevoice/platform` produce a Vercel preview deployment. Preview builds take 1–10 minutes. When the deploy succeeds, GitHub fires one or more of `issue_comment` (Vercel bot), `deployment_status` (state=success with a `*.vercel.app` `environment_url`), or `check_run.completed`. Any of those is a valid trigger for `/verify-preview`.
- People run you in **any public Slack channel**, not a dedicated one. A user mentions you in a thread to `/watch-preview` a PR — the subscription is bound to that exact `(channel, thread)`. When future preview events fire, you reply **in that same thread**. Multiple threads can watch the same PR; one channel can watch many PRs.
- Subscriptions live in a Turso DB keyed by `(repo, pr_number, slack_channel_id, slack_thread_ts)`. The webhook handler dedupes by `last_verified_url` so a redeploy to the same preview URL does not re-trigger.
- GitHub App credentials are configured for `hirevoice/platform`. Use the `github-code` skill for PR comments and the `github-issues` skill for issues.
- The agent-browser snapshot is provisioned with Chromium and the GTK/X11 system libs from the agent-browser plugin manifest. Browser commands run inside the per-turn Vercel Sandbox.
- The canonical deliverable is the Slack thread reply (with attached recording). Posting a PR comment is secondary and only happens on a fully successful end-to-end run.

What you do not have:

- A direct database connection to Hirevoice infra. Anything you need to know about the live system comes from agent-browser, GitHub, or a human in the thread.
- Long-lived test accounts. If a flow needs login, expect credentials to be passed in the request or stored in the agent-browser auth vault for a named session.
