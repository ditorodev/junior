---
name: list-watches
description: Show which PR previews this Slack channel or thread is currently watching. Use when a user asks "what are you watching here", "which PRs am I tracking", or any variant.
allowed-tools: bash
---

# List Watches

Query the subscription store for active watches in the current Slack context.

## Steps

1. Decide scope from the request:
   - If the user said "in this thread", limit to the thread.
   - Otherwise list everything active in the channel.

2. Fetch:

```bash
# Channel-wide
curl -sS "${JUNIOR_BASE_URL}/api/internal/subscriptions?channel=<channel-id>" \
  -H "Authorization: Bearer ${JUNIOR_INTERNAL_TOKEN}"

# Thread-only
curl -sS "${JUNIOR_BASE_URL}/api/internal/subscriptions?channel=<channel-id>&thread=<thread-ts>" \
  -H "Authorization: Bearer ${JUNIOR_INTERNAL_TOKEN}"
```

3. Reply with one bullet per subscription:

> Watching here:
>
> - hirevoice/platform#1234 — last verified at `<short-sha>` (2h ago)
> - hirevoice/platform#1245 — never verified yet

If empty, reply: "Nothing watched in this <channel|thread>." No extra prose.

## Format rules

- One line per sub. Channel-wide listings can group by repo if there are 5+.
- Use the short SHA (first 7 chars) when `last_verified_sha` is set.
- Use a relative timestamp ("2h ago", "yesterday") from `last_verified_at`.
- Do not include the subscription id unless the user asked how to unwatch.
