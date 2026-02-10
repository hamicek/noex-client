# Part 8: Reconnection & Resilience

Handle network failures gracefully with automatic reconnect, subscription recovery, and heartbeat.

## Chapters

### [8.1 Automatic Reconnect](./01-automatic-reconnect.md)

Configure and understand the reconnect behavior:
- `ReconnectOptions` — maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier, jitter
- Exponential backoff with random jitter to avoid thundering herd
- Lifecycle events: `reconnecting`, `reconnected`, `disconnected`

### [8.2 Subscription Recovery](./02-subscription-recovery.md)

Understand what happens to subscriptions after a reconnect:
- Automatic resubscription with fresh data delivery
- Server-assigned subscription ID updates
- No manual intervention needed — callbacks keep firing

### [8.3 Heartbeat](./03-heartbeat.md)

Keep connections alive and detect dead peers:
- Server sends ping, client responds with pong automatically
- `heartbeat` option (enabled by default)
- Dead connection detection when pings stop arriving

## What You'll Learn

By the end of this section, you'll understand:
- How exponential backoff with jitter works
- What happens to pending requests and subscriptions during reconnect
- How heartbeat keeps the connection healthy

---

Start with: [Automatic Reconnect](./01-automatic-reconnect.md)
