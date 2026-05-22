import { getDb } from "./client";

export interface PreviewSubscription {
  id: number;
  repo: string;
  prNumber: number;
  slackChannelId: string;
  slackThreadTs: string;
  createdByUser: string;
  createdAt: number;
  status: "active" | "done" | "abandoned";
  lastVerifiedUrl: string | null;
  lastVerifiedSha: string | null;
  lastVerifiedAt: number | null;
}

interface Row {
  id: number;
  repo: string;
  pr_number: number;
  slack_channel_id: string;
  slack_thread_ts: string;
  created_by_user: string;
  created_at: number;
  status: string;
  last_verified_url: string | null;
  last_verified_sha: string | null;
  last_verified_at: number | null;
}

function fromRow(row: Row): PreviewSubscription {
  return {
    id: row.id,
    repo: row.repo,
    prNumber: row.pr_number,
    slackChannelId: row.slack_channel_id,
    slackThreadTs: row.slack_thread_ts,
    createdByUser: row.created_by_user,
    createdAt: row.created_at,
    status: row.status as PreviewSubscription["status"],
    lastVerifiedUrl: row.last_verified_url,
    lastVerifiedSha: row.last_verified_sha,
    lastVerifiedAt: row.last_verified_at,
  };
}

/**
 * Insert a new watch row, or no-op if (repo, pr, channel, thread) already
 * has an active sub. Returns the existing or newly-inserted row.
 */
export async function createSubscription(args: {
  repo: string;
  prNumber: number;
  slackChannelId: string;
  slackThreadTs: string;
  createdByUser: string;
}): Promise<PreviewSubscription> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: `INSERT OR IGNORE INTO preview_subscriptions
            (repo, pr_number, slack_channel_id, slack_thread_ts,
             created_by_user, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      args.repo,
      args.prNumber,
      args.slackChannelId,
      args.slackThreadTs,
      args.createdByUser,
      now,
    ],
  });
  const result = await db.execute({
    sql: `SELECT * FROM preview_subscriptions
          WHERE repo = ? AND pr_number = ?
            AND slack_channel_id = ? AND slack_thread_ts = ?`,
    args: [args.repo, args.prNumber, args.slackChannelId, args.slackThreadTs],
  });
  return fromRow(result.rows[0] as unknown as Row);
}

/** Active subs for a PR; the GitHub webhook handler fans out to each. */
export async function findActiveForPr(
  repo: string,
  prNumber: number,
): Promise<PreviewSubscription[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT * FROM preview_subscriptions
          WHERE repo = ? AND pr_number = ? AND status = 'active'`,
    args: [repo, prNumber],
  });
  return (result.rows as unknown as Row[]).map(fromRow);
}

/** Active subs in a channel; optionally limited to a single thread. */
export async function listForChannel(args: {
  slackChannelId: string;
  slackThreadTs?: string;
}): Promise<PreviewSubscription[]> {
  const db = getDb();
  if (args.slackThreadTs) {
    const r = await db.execute({
      sql: `SELECT * FROM preview_subscriptions
            WHERE slack_channel_id = ? AND slack_thread_ts = ?
              AND status = 'active'
            ORDER BY created_at DESC`,
      args: [args.slackChannelId, args.slackThreadTs],
    });
    return (r.rows as unknown as Row[]).map(fromRow);
  }
  const r = await db.execute({
    sql: `SELECT * FROM preview_subscriptions
          WHERE slack_channel_id = ? AND status = 'active'
          ORDER BY created_at DESC`,
    args: [args.slackChannelId],
  });
  return (r.rows as unknown as Row[]).map(fromRow);
}

/** Mark a verify run complete for a specific subscription + preview URL. */
export async function markVerified(args: {
  id: number;
  url: string;
  sha: string | null;
}): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: `UPDATE preview_subscriptions
          SET last_verified_url = ?, last_verified_sha = ?, last_verified_at = ?
          WHERE id = ?`,
    args: [args.url, args.sha, now, args.id],
  });
}

/** Flip status to 'abandoned'. Used by /unwatch. */
export async function abandonSubscription(id: number): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE preview_subscriptions SET status = 'abandoned' WHERE id = ?`,
    args: [id],
  });
}
