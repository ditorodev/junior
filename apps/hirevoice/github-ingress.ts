import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { findActiveForPr } from "./db/subscriptions";

interface IssueCommentEvent {
  action: string;
  comment: { user: { login: string }; body: string };
  issue: { number: number; pull_request?: unknown };
  repository: { full_name: string };
  sender: { login: string };
}

interface DeploymentStatusEvent {
  deployment: { sha: string; environment: string };
  deployment_status: { state: string; environment_url?: string };
  repository: { full_name: string };
  pull_requests?: { number: number }[];
}

interface CheckRunEvent {
  action: string;
  check_run: {
    name: string;
    status: string;
    conclusion: string | null;
    head_sha: string;
    details_url?: string;
    output?: { title?: string; summary?: string };
    pull_requests?: { number: number }[];
  };
  repository: { full_name: string };
}

interface Normalized {
  repo: string;
  prNumber: number;
  previewUrl: string;
  sha: string | null;
}

const PREVIEW_URL_RE = /https:\/\/[^\s)\]]+\.vercel\.app[^\s)\]]*/;

/** Extract the first *.vercel.app URL from a string. */
function extractPreviewUrl(text: string): string | undefined {
  return text.match(PREVIEW_URL_RE)?.[0];
}

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

/** Map an inbound GitHub event into a normalized verify trigger, or null. */
function normalize(event: string, payload: unknown): Normalized | null {
  if (event === "deployment_status") {
    const p = payload as DeploymentStatusEvent;
    if (p.deployment_status.state !== "success") return null;
    const url = p.deployment_status.environment_url;
    if (!url || !url.includes(".vercel.app")) return null;
    const prNumber = p.pull_requests?.[0]?.number;
    if (!prNumber) return null;
    return {
      repo: p.repository.full_name,
      prNumber,
      previewUrl: url,
      sha: p.deployment.sha,
    };
  }

  if (event === "check_run") {
    const p = payload as CheckRunEvent;
    if (p.action !== "completed" || p.check_run.conclusion !== "success") {
      return null;
    }
    const detailsUrl = p.check_run.details_url ?? "";
    const summary = p.check_run.output?.summary ?? "";
    const url = extractPreviewUrl(detailsUrl) ?? extractPreviewUrl(summary);
    if (!url) return null;
    const prNumber = p.check_run.pull_requests?.[0]?.number;
    if (!prNumber) return null;
    return {
      repo: p.repository.full_name,
      prNumber,
      previewUrl: url,
      sha: p.check_run.head_sha,
    };
  }

  if (event === "issue_comment") {
    const p = payload as IssueCommentEvent;
    if (p.action !== "created") return null;
    if (!p.issue.pull_request) return null;
    const previewAuthor =
      process.env.HIREVOICE_PREVIEW_COMMENT_AUTHOR ?? "vercel[bot]";
    if (p.sender.login !== previewAuthor) return null;
    const url = extractPreviewUrl(p.comment.body);
    if (!url) return null;
    return {
      repo: p.repository.full_name,
      prNumber: p.issue.number,
      previewUrl: url,
      sha: null,
    };
  }

  return null;
}

async function postSlackThread(args: {
  token: string;
  channel: string;
  threadTs: string;
  text: string;
}): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({
      channel: args.channel,
      thread_ts: args.threadTs,
      text: args.text,
    }),
  });
  const payload = (await res.json()) as { ok: boolean; error?: string };
  if (!payload.ok) {
    throw new Error(`chat.postMessage failed: ${payload.error}`);
  }
}

/**
 * POST /api/webhooks/github.
 *
 * Verifies the GitHub HMAC, normalizes (issue_comment | deployment_status |
 * check_run) into a (repo, pr, preview_url, sha) tuple, looks up every active
 * subscription for that PR in libsql, dedupes by `last_verified_url`, and posts
 * a `<@junior> /verify-preview ...` mention into each subscribed Slack thread.
 * Junior's existing Slack ingress runs the skill in-thread per subscription.
 */
export async function handleGithubWebhook(c: Context): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const juniorUserId = process.env.HIREVOICE_JUNIOR_SLACK_USER_ID;

  if (!secret || !slackToken || !juniorUserId) {
    return c.text("github ingress not configured", 503);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? null;
  if (!verifyGithubSignature(rawBody, signature, secret)) {
    return c.text("bad signature", 401);
  }

  const event = c.req.header("x-github-event") ?? "";
  if (event === "ping") return c.text("pong", 200);

  const noContent = () => new Response(null, { status: 204 });

  const trigger = normalize(event, JSON.parse(rawBody));
  if (!trigger) return noContent();

  const subs = await findActiveForPr(trigger.repo, trigger.prNumber);
  if (subs.length === 0) return noContent();

  const targets = subs.filter((s) => s.lastVerifiedUrl !== trigger.previewUrl);
  if (targets.length === 0) return noContent();

  const shaTag = trigger.sha ? ` sha=${trigger.sha.slice(0, 7)}` : "";
  const text =
    `<@${juniorUserId}> /verify-preview ` +
    `pr=${trigger.repo}#${trigger.prNumber} ` +
    `url=${trigger.previewUrl}${shaTag} sub=<id-passed-per-target>`;

  await Promise.all(
    targets.map((sub) =>
      postSlackThread({
        token: slackToken,
        channel: sub.slackChannelId,
        threadTs: sub.slackThreadTs,
        text: text.replace("<id-passed-per-target>", String(sub.id)),
      }),
    ),
  );

  return c.json({ dispatched: targets.length }, 202);
}
