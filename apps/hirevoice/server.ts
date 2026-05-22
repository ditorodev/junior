import { createApp } from "@sentry/junior";
import { initSentry } from "@sentry/junior/instrumentation";
import { handleGithubWebhook } from "./github-ingress";
import {
  deleteSubscription,
  getSubscriptions,
  patchSubscription,
  postSubscription,
} from "./internal-routes";
import { hirevoicePluginPackages } from "./plugin-packages";

initSentry();

const app = await createApp({
  plugins: {
    packages: hirevoicePluginPackages,
  },
});

// GitHub preview-event ingress (issue_comment, deployment_status, check_run).
// Looks up active subscriptions in libsql and fans out a verify-preview
// mention into each watching Slack thread.
app.post("/api/webhooks/github", (c) => handleGithubWebhook(c));

// Subscription CRUD called from the watch-preview / unwatch-preview /
// list-watches skills running inside the sandbox. Bearer-auth via
// JUNIOR_INTERNAL_TOKEN, which the local hirevoice-pr-watch plugin
// injects into the skill sandbox via command-env.
app.post("/api/internal/subscriptions", (c) => postSubscription(c));
app.get("/api/internal/subscriptions", (c) => getSubscriptions(c));
app.patch("/api/internal/subscriptions/:id", (c) => patchSubscription(c));
app.delete("/api/internal/subscriptions/:id", (c) => deleteSubscription(c));

export default app;
