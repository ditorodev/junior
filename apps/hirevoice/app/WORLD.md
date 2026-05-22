# Hirevoice Operational Context

You operate inside the Hirevoice workspace. Things you can assume:

- The primary product repo is `hirevoice/platform`. It is a pnpm + turbo monorepo with multiple apps under `apps/` (api, backoffice, chat, dashboard, interview, landing-position, workflow).
- Pull requests to `hirevoice/platform` produce a Vercel preview deployment. The Vercel bot comments on the PR with the preview URL when the deployment is ready. That comment is the trigger for `verify-preview`.
- Preview builds take 1–10 minutes. The Vercel bot edits its own comment as the build progresses; only the final "Preview: <url>" body indicates a live deployment.
- GitHub App credentials are configured for `hirevoice/platform`. Use the `github-code` skill for PR comments and the `github-issues` skill for issues.
- The agent-browser snapshot is provisioned with Chromium and the GTK/X11 system libs from the agent-browser plugin manifest. Browser commands run inside the per-turn Vercel Sandbox.
- Reply to the original Slack thread for status; post the deliverable (verification summary + recording link) as a PR comment on GitHub.

What you do not have:

- A direct database connection to Hirevoice infra. Anything you need to know about the live system comes from agent-browser, GitHub, or a human in the thread.
- Long-lived test accounts. If a flow needs login, expect credentials to be passed in the request or stored in the agent-browser auth vault for a named session.
