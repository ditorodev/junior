import type { Context } from "hono";
import {
  abandonSubscription,
  createSubscription,
  listForChannel,
  markVerified,
} from "./db/subscriptions";

/** Validate `Authorization: Bearer <JUNIOR_INTERNAL_TOKEN>`. */
function authorize(c: Context): Response | null {
  const expected = process.env.JUNIOR_INTERNAL_TOKEN;
  if (!expected) return c.text("internal endpoints disabled", 503);
  const header = c.req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return c.text("unauthorized", 401);
  if (header.slice("Bearer ".length) !== expected) {
    return c.text("unauthorized", 401);
  }
  return null;
}

interface CreateBody {
  repo: string;
  pr_number: number;
  slack_channel_id: string;
  slack_thread_ts: string;
  created_by_user: string;
}

/** POST /api/internal/subscriptions — register a watch. */
export async function postSubscription(c: Context): Promise<Response> {
  const denied = authorize(c);
  if (denied) return denied;

  const body = (await c.req.json()) as CreateBody;
  if (
    !body.repo ||
    !body.pr_number ||
    !body.slack_channel_id ||
    !body.slack_thread_ts ||
    !body.created_by_user
  ) {
    return c.text("missing fields", 400);
  }

  const sub = await createSubscription({
    repo: body.repo,
    prNumber: body.pr_number,
    slackChannelId: body.slack_channel_id,
    slackThreadTs: body.slack_thread_ts,
    createdByUser: body.created_by_user,
  });
  return c.json(sub, 201);
}

/** GET /api/internal/subscriptions?channel=…&thread=… — list active. */
export async function getSubscriptions(c: Context): Promise<Response> {
  const denied = authorize(c);
  if (denied) return denied;

  const channel = c.req.query("channel");
  const thread = c.req.query("thread");
  if (!channel) return c.text("channel is required", 400);

  const subs = await listForChannel({
    slackChannelId: channel,
    slackThreadTs: thread,
  });
  return c.json(subs);
}

interface PatchBody {
  last_verified_url: string;
  last_verified_sha?: string | null;
}

/** PATCH /api/internal/subscriptions/:id — mark verified for a preview URL. */
export async function patchSubscription(c: Context): Promise<Response> {
  const denied = authorize(c);
  if (denied) return denied;

  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.text("bad id", 400);

  const body = (await c.req.json()) as PatchBody;
  if (!body.last_verified_url) return c.text("missing last_verified_url", 400);

  await markVerified({
    id,
    url: body.last_verified_url,
    sha: body.last_verified_sha ?? null,
  });
  return c.text("ok", 200);
}

/** DELETE /api/internal/subscriptions/:id — flip to abandoned. */
export async function deleteSubscription(c: Context): Promise<Response> {
  const denied = authorize(c);
  if (denied) return denied;

  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.text("bad id", 400);

  await abandonSubscription(id);
  return c.text("ok", 200);
}
