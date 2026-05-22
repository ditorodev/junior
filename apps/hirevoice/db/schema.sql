-- preview_subscriptions: a Slack thread is watching a PR for verify-preview runs.
--
-- One row per (channel, thread) <-> (repo, pr) tuple. A channel/thread may watch
-- many PRs; a PR may be watched by many channels/threads. Verification dedups
-- by `last_verified_url` so that re-deploys to the same preview URL don't
-- re-trigger.
CREATE TABLE IF NOT EXISTS preview_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  slack_channel_id TEXT NOT NULL,
  slack_thread_ts TEXT NOT NULL,
  created_by_user TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_verified_url TEXT,
  last_verified_sha TEXT,
  last_verified_at INTEGER,
  UNIQUE (repo, pr_number, slack_channel_id, slack_thread_ts)
);

CREATE INDEX IF NOT EXISTS idx_preview_subs_pr
  ON preview_subscriptions (repo, pr_number, status);

CREATE INDEX IF NOT EXISTS idx_preview_subs_thread
  ON preview_subscriptions (slack_channel_id, slack_thread_ts, status);
