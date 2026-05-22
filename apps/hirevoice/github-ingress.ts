import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

interface IssueCommentEvent {
  action: string;
  comment: { user: { login: string }; body: string; html_url: string };
  issue: { number: number; pull_request?: unknown; html_url: string };
  repository: { full_name: string; owner: { login: string }; name: string };
  sender: { login: string };
}

/** Pull the first Vercel preview URL out of a Vercel-bot PR comment body. */
function extractPreviewUrl(body: string): string | undefined {
  const match = body.match(/https:\/\/[^\s)\]]+\.vercel\.app[^\s)\]]*/);
  return match?.[0];
}

/** Constant-time HMAC-SHA256 check against `X-Hub-Signature-256`. */
function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Post a chat.postMessage to a Slack channel using the workspace bot token. */
async function postSlackMessage(args: {
  token: string;
  channel: string;
  text: string;
}): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({ channel: args.channel, text: args.text }),
  });
  const payload = (await response.json()) as { ok: boolean; error?: string };
  if (!payload.ok) {
    throw new Error(`slack chat.postMessage failed: ${payload.error}`);
  }
}

/**
 * Handle `POST /api/webhooks/github`.
 *
 * Verifies the GitHub HMAC, ignores everything that is not an
 * `issue_comment.created` from the configured preview-bot author on a PR,
 * extracts the preview URL, and posts a Slack mention so Junior's normal
 * Slack ingress picks the request up and runs the `verify-preview` skill.
 */
export async function handleGithubWebhook(c: Context): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const channel = process.env.HIREVOICE_PR_CHANNEL_ID;
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const juniorUserId = process.env.HIREVOICE_JUNIOR_SLACK_USER_ID;
  const previewAuthor =
    process.env.HIREVOICE_PREVIEW_COMMENT_AUTHOR ?? "vercel[bot]";

  if (!secret || !channel || !slackToken || !juniorUserId) {
    return c.text("github ingress not configured", 503);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? null;
  if (!verifyGithubSignature(rawBody, signature, secret)) {
    return c.text("bad signature", 401);
  }

  const noContent = () => new Response(null, { status: 204 });
  const event = c.req.header("x-github-event");
  if (event === "ping") return c.text("pong", 200);
  if (event !== "issue_comment") return noContent();

  const payload = JSON.parse(rawBody) as IssueCommentEvent;
  if (payload.action !== "created") return noContent();
  if (!payload.issue.pull_request) return noContent();
  if (payload.sender.login !== previewAuthor) return noContent();

  const previewUrl = extractPreviewUrl(payload.comment.body);
  if (!previewUrl) return noContent();

  const repo = payload.repository.full_name;
  const pr = payload.issue.number;
  const prUrl = payload.issue.html_url;
  const text = `<@${juniorUserId}> /verify-preview pr=${repo}#${pr} url=${previewUrl}\n• PR: ${prUrl}\n• Preview: ${previewUrl}`;

  await postSlackMessage({ token: slackToken, channel, text });
  return c.text("dispatched", 202);
}
