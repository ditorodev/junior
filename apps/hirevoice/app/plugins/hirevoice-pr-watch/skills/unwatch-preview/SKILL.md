---
name: unwatch-preview
description: Stop verifying a PR preview in the current Slack thread or channel. Use when a user says "stop watching", "unwatch", "we're done with this PR", or names a specific PR to drop.
allowed-tools: bash
---

# Unwatch Preview

Mark one or more subscriptions as `abandoned` so the GitHub webhook no longer
fans verify runs into this thread.

## Steps

1. Resolve which subscription(s) to drop:
   - If the user named a PR (e.g. `hirevoice/platform#1234`), match it against
     the active subs returned by `list-watches` for this channel/thread.
   - If the user said "stop watching everything here", drop every active sub
     in the current thread.
   - If no match, reply with "Not watching that here" and stop.

2. Look up the active subs:

```bash
curl -sS "${JUNIOR_BASE_URL}/api/internal/subscriptions?channel=<channel-id>&thread=<thread-ts>" \
  -H "Authorization: Bearer ${JUNIOR_INTERNAL_TOKEN}"
```

3. For each matching subscription id, delete:

```bash
curl -sS -X DELETE "${JUNIOR_BASE_URL}/api/internal/subscriptions/<id>" \
  -H "Authorization: Bearer ${JUNIOR_INTERNAL_TOKEN}"
```

4. Reply once with what was dropped:

> Stopped watching hirevoice/platform#1234 here.

If you dropped multiple, list them as bullets. If zero, say nothing happened.

## Do not

- Confirm before dropping. The user already said so.
- Touch subscriptions in other threads or channels, even if the same PR is
  watched there.
