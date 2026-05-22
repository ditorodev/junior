import { createApp } from "@sentry/junior";
import { initSentry } from "@sentry/junior/instrumentation";
import { handleGithubWebhook } from "./github-ingress";
import { hirevoicePluginPackages } from "./plugin-packages";

initSentry();

const app = await createApp({
  plugins: {
    packages: hirevoicePluginPackages,
  },
});

// PR preview ingress: GitHub fires this when the Vercel bot posts its
// "Preview: <url>" comment; we relay into Slack so the verify-preview
// skill kicks off via Junior's existing ingress.
app.post("/api/webhooks/github", (c) => handleGithubWebhook(c));

export default app;
