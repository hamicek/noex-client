# Chat Application

Build a multi-room chat system that combines every major SDK feature: store for message persistence, rules for event-driven notifications, subscriptions for live delivery, transactions for atomic state changes, and reconnect recovery for a seamless user experience.

## What You'll Learn

- Using the rules engine to emit chat events and subscribe to room topics
- Persisting messages in a store bucket while broadcasting via rules
- Combining store subscriptions and rules subscriptions in a single client
- Atomic room operations with transactions
- Automatic subscription recovery after reconnect
- Correlation and causation IDs for message tracing

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          noex-server                             │
│                                                                  │
│  Store                              Rules                        │
│  ┌──────────────────┐               ┌──────────────────────┐    │
│  │ messages bucket   │               │ topic: chat:*         │    │
│  │ rooms bucket      │               │ topic: presence:*     │    │
│  └──────────────────┘               └──────────────────────┘    │
│                                                                  │
│  Queries                            Facts                        │
│  ┌──────────────────┐               ┌──────────────────────┐    │
│  │ room-messages     │               │ room:general:members  │    │
│  │   (by roomId)     │               │ user:alice:status     │    │
│  │ room-list         │               └──────────────────────┘    │
│  └──────────────────┘                                            │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│  │   Alice    │  │    Bob     │  │   Carol    │                │
│  │   emit()   │  │ subscribe  │  │ subscribe  │                │
│  │   insert() │  │  push ←    │  │  push ←    │                │
│  └────────────┘  └────────────┘  └────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

**Two push channels work together:**

| Channel | Trigger | Use |
|---------|---------|-----|
| `subscription` (store) | Data in a bucket changes | Message history, room list |
| `event` (rules) | `rules.emit()` is called | Live chat events, typing indicators, presence |

Store subscriptions deliver the current state (the full message list). Rules subscriptions deliver individual events as they happen (each new message, join, leave). A complete chat client uses both.

## Part 1: Server Setup

```typescript
// server.ts
import { Store } from '@hamicek/noex-store';
import { RulesEngine } from '@hamicek/noex-rules';
import { NoexServer } from '@hamicek/noex-server';
import type { AuthSession } from '@hamicek/noex-server';

async function main() {
  const store = await Store.start({ name: 'chat-app' });
  const rules = new RulesEngine();

  // ── Buckets ─────────────────────────────────────────────────────
  await store.defineBucket('messages', {
    key: 'id',
    schema: {
      id:     { type: 'string', generated: 'uuid' },
      roomId: { type: 'string', required: true },
      userId: { type: 'string', required: true },
      text:   { type: 'string', required: true },
    },
  });

  await store.defineBucket('rooms', {
    key: 'id',
    schema: {
      id:   { type: 'string', generated: 'uuid' },
      name: { type: 'string', required: true },
    },
  });

  // ── Queries ─────────────────────────────────────────────────────
  store.defineQuery(
    'room-messages',
    async (ctx, params: { roomId: string }) => {
      return ctx.bucket('messages').where({ roomId: params.roomId });
    },
  );

  store.defineQuery('room-list', async (ctx) => {
    return ctx.bucket('rooms').all();
  });

  // ── Auth ────────────────────────────────────────────────────────
  const users: Record<string, AuthSession> = {
    'alice-token': { userId: 'alice', roles: ['user'] },
    'bob-token':   { userId: 'bob', roles: ['user'] },
    'carol-token': { userId: 'carol', roles: ['user'] },
  };

  const server = await NoexServer.start({
    port: 8080,
    store,
    rules,
    auth: {
      validate: async (token) => users[token] ?? null,
    },
  });

  console.log(`Chat server listening on ws://localhost:${server.port}`);
}

main();
```

## Part 2: Sending Messages

A chat message involves two operations: **persist** the message in the store (so it's available in history) and **emit** a rules event (so all subscribed clients receive it immediately).

```typescript
import { NoexClient } from '@hamicek/noex-client';
import WebSocket from 'ws';

const alice = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'alice-token' },
});
await alice.connect();

const roomId = 'general';

// Persist the message
const msg = await alice.store.bucket('messages').insert({
  roomId,
  userId: 'alice',
  text: 'Hello everyone!',
});

// Broadcast via rules — all clients subscribed to chat:general receive this
await alice.rules.emit(`chat:${roomId}`, {
  messageId: msg.id,
  userId: 'alice',
  text: 'Hello everyone!',
});
```

### Correlation IDs for Tracing

Use `correlationId` to link related events in a conversation:

```typescript
const correlationId = `conv-${Date.now()}`;

await alice.rules.emit(
  `chat:${roomId}`,
  { userId: 'alice', text: 'Anyone here?' },
  correlationId,
);

// Bob replies in the same conversation thread
await bob.rules.emit(
  `chat:${roomId}`,
  { userId: 'bob', text: 'I am!' },
  correlationId,
  msg.id, // causationId — this message was caused by Alice's message
);
```

## Part 3: Receiving Messages — Rules Subscriptions

Rules subscriptions use topic patterns with `:` segment separators. The `*` wildcard matches a single segment:

```typescript
const bob = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'bob-token' },
});
await bob.connect();

// Subscribe to all chat events in the "general" room
const unsubChat = await bob.rules.subscribe(`chat:general`, (event, topic) => {
  console.log(`[${topic}] ${event.data['userId']}: ${event.data['text']}`);
});

// Subscribe to ALL rooms at once
const unsubAll = await bob.rules.subscribe('chat:*', (event, topic) => {
  const roomId = topic.split(':')[1];
  console.log(`[Room ${roomId}] ${event.data['userId']}: ${event.data['text']}`);
});
```

When Alice emits `chat:general`, Bob's callback fires with the event object containing `id`, `topic`, `data`, `timestamp`, and optional `correlationId`/`causationId`.

## Part 4: Message History — Store Subscriptions

Rules events are ephemeral — they arrive only if you're subscribed when they happen. For message history, subscribe to the store query:

```typescript
// Bob wants the full message history for "general" room
const messageHistory: Record<string, unknown>[] = [];

const unsubHistory = await bob.store.subscribe(
  'room-messages',
  { roomId: 'general' },
  (data) => {
    messageHistory.length = 0;
    for (const m of data as Record<string, unknown>[]) {
      messageHistory.push(m);
    }
    console.log(`History: ${messageHistory.length} messages`);
  },
);

// Initial data: all existing messages in #general
// Push updates: whenever a new message is inserted into #general
```

**Why both?** Rules subscriptions give instant delivery of individual events (low latency). Store subscriptions give the complete current state (reliable, survives reconnect). Use rules for the real-time "new message" indicator and store for rendering the full message list.

## Part 5: Room Management with Transactions

Create a room and record the first member atomically:

```typescript
// Create room + initial message in one atomic operation
const result = await alice.store.transaction([
  {
    op: 'insert',
    bucket: 'rooms',
    data: { name: 'project-x' },
  },
  {
    op: 'insert',
    bucket: 'messages',
    data: {
      roomId: 'project-x',
      userId: 'system',
      text: 'Room created by alice',
    },
  },
]);

const room = result.results[0]!.data as Record<string, unknown>;
const systemMsg = result.results[1]!.data as Record<string, unknown>;

console.log(`Created room: ${room['name']} (${room['id']})`);
console.log(`System message: ${systemMsg['id']}`);

// Notify via rules
await alice.rules.emit(`presence:${room['id']}`, {
  userId: 'alice',
  action: 'created_room',
});
```

### Presence Tracking with Facts

Use rules facts to track who is in each room:

```typescript
// Alice joins "general"
await alice.rules.setFact('room:general:members:alice', { joinedAt: Date.now() });

// Query all members of "general"
const members = await alice.rules.queryFacts('room:general:members:*');
console.log(`Members: ${members.map((f) => f.key.split(':')[3]).join(', ')}`);

// Alice leaves
await alice.rules.deleteFact('room:general:members:alice');
```

## Part 6: Reconnect Recovery

When the network drops and the client reconnects, the SDK automatically restores all active subscriptions. Both store and rules subscriptions are recovered:

```typescript
const carol = new NoexClient('ws://localhost:8080', {
  WebSocket,
  auth: { token: 'carol-token' },
  reconnect: {
    initialDelayMs: 500,
    maxDelayMs: 5000,
    maxRetries: 10,
  },
});

await carol.connect();

// Subscribe to rules events and store queries
const chatMessages: unknown[] = [];
const unsubRules = await carol.rules.subscribe('chat:general', (event) => {
  chatMessages.push(event);
});

const storeMessages: unknown[] = [];
const unsubStore = await carol.store.subscribe(
  'room-messages',
  { roomId: 'general' },
  (data) => {
    storeMessages.push(data);
  },
);

// Monitor connection state
carol.on('reconnecting', (attempt) => {
  console.log(`Reconnecting... attempt ${attempt}`);
});

carol.on('reconnected', () => {
  console.log('Reconnected — subscriptions restored');
  // Both chatMessages rules sub and storeMessages store sub
  // are automatically resubscribed.
  // Store subscription callback fires with fresh current data.
});

carol.on('disconnected', (reason) => {
  console.log(`Disconnected: ${reason}`);
});
```

```
    Carol                      Server
      │                          │
      │  ── connected ──         │
      │  rules.subscribe         │
      │  store.subscribe         │
      │                          │
      │  ✕ network drops ✕       │
      │                          │
      │  reconnecting (1)        │
      │  ... delay ...           │
      │  reconnecting (2)        │
      │  ... delay ...           │
      │                          │
      │  ── reconnected ──       │
      │  auto-login              │
      │  rules.subscribe (new)   │
      │  store.subscribe (new)   │← fresh initial data
      │                          │
      │  ── normal operation ──  │
```

After reconnect:
- **Auth** is restored automatically (auto-login with the saved token)
- **Store subscriptions** are re-created; the callback fires with fresh current data
- **Rules subscriptions** are re-created with a new subscription ID
- Messages sent during the disconnect are **not replayed** — use the store subscription's fresh data to catch up

## Complete Working Example

```typescript
import { Store } from '@hamicek/noex-store';
import { RulesEngine } from '@hamicek/noex-rules';
import { NoexServer } from '@hamicek/noex-server';
import { NoexClient } from '@hamicek/noex-client';
import type { AuthSession } from '@hamicek/noex-server';
import WebSocket from 'ws';

async function main() {
  // ── Server ──────────────────────────────────────────────────────
  const store = await Store.start({ name: 'chat-demo' });
  const rules = new RulesEngine();

  await store.defineBucket('messages', {
    key: 'id',
    schema: {
      id:     { type: 'string', generated: 'uuid' },
      roomId: { type: 'string', required: true },
      userId: { type: 'string', required: true },
      text:   { type: 'string', required: true },
    },
  });

  store.defineQuery('room-messages', async (ctx, params: { roomId: string }) => {
    return ctx.bucket('messages').where({ roomId: params.roomId });
  });

  const users: Record<string, AuthSession> = {
    'alice-token': { userId: 'alice', roles: ['user'] },
    'bob-token':   { userId: 'bob', roles: ['user'] },
  };

  const server = await NoexServer.start({
    port: 0,
    host: '127.0.0.1',
    store,
    rules,
    auth: { validate: async (token) => users[token] ?? null },
  });

  const url = `ws://127.0.0.1:${server.port}`;

  // ── Alice ───────────────────────────────────────────────────────
  const alice = new NoexClient(url, {
    WebSocket: WebSocket as never,
    auth: { token: 'alice-token' },
  });
  await alice.connect();

  // ── Bob ─────────────────────────────────────────────────────────
  const bob = new NoexClient(url, {
    WebSocket: WebSocket as never,
    auth: { token: 'bob-token' },
  });
  await bob.connect();

  // Bob subscribes to live events in #general
  const liveEvents: string[] = [];
  const unsubRules = await bob.rules.subscribe('chat:general', (event) => {
    liveEvents.push(`${event.data['userId']}: ${event.data['text']}`);
    console.log(`[Live] ${event.data['userId']}: ${event.data['text']}`);
  });

  // Bob subscribes to message history in #general
  let history: Record<string, unknown>[] = [];
  const unsubStore = await bob.store.subscribe(
    'room-messages',
    { roomId: 'general' },
    (data) => {
      history = data as Record<string, unknown>[];
      console.log(`[History] ${history.length} messages`);
    },
  );

  // Alice sends a message
  const msg = await alice.store.bucket('messages').insert({
    roomId: 'general',
    userId: 'alice',
    text: 'Hello Bob!',
  });
  await alice.rules.emit('chat:general', {
    messageId: msg.id,
    userId: 'alice',
    text: 'Hello Bob!',
  });
  await store.settle();

  // Bob sends a reply
  const reply = await bob.store.bucket('messages').insert({
    roomId: 'general',
    userId: 'bob',
    text: 'Hey Alice!',
  });
  await bob.rules.emit('chat:general', {
    messageId: reply.id,
    userId: 'bob',
    text: 'Hey Alice!',
  });
  await store.settle();

  // Allow time for pushes to arrive
  await new Promise((r) => setTimeout(r, 200));

  console.log(`\nLive events received: ${liveEvents.length}`);
  console.log(`Message history: ${history.length}`);

  // ── Cleanup ─────────────────────────────────────────────────────
  unsubRules();
  unsubStore();
  await alice.disconnect();
  await bob.disconnect();
  await server.stop();
  await store.stop();

  console.log('Done.');
}

main();
```

## Exercise

Extend the chat application with:

1. A typing indicator: when a user starts typing, emit a `typing:general` rules event with `{ userId, isTyping: true }`. When they stop, emit with `isTyping: false`.
2. Subscribe to `typing:*` to show "X is typing..." in all rooms.
3. Use a transaction to create a new room and post the first "welcome" message atomically.
4. Track user presence with facts: `setFact('online:alice', true)` on connect, `deleteFact('online:alice')` on disconnect. Query all online users with `queryFacts('online:*')`.

<details>
<summary>Solution</summary>

**Typing indicator:**

```typescript
// Alice starts typing
await alice.rules.emit('typing:general', { userId: 'alice', isTyping: true });

// Alice stops typing (sent a message or paused)
await alice.rules.emit('typing:general', { userId: 'alice', isTyping: false });

// Bob subscribes to typing events in all rooms
await bob.rules.subscribe('typing:*', (event, topic) => {
  const roomId = topic.split(':')[1];
  if (event.data['isTyping']) {
    console.log(`[${roomId}] ${event.data['userId']} is typing...`);
  }
});
```

**Atomic room creation:**

```typescript
const result = await alice.store.transaction([
  { op: 'insert', bucket: 'rooms', data: { name: 'new-room' } },
  {
    op: 'insert',
    bucket: 'messages',
    data: { roomId: 'new-room', userId: 'system', text: 'Welcome to new-room!' },
  },
]);
```

**Presence tracking:**

```typescript
// On connect
await alice.rules.setFact('online:alice', true);

// On disconnect (before client.disconnect())
await alice.rules.deleteFact('online:alice');

// Query who is online
const onlineFacts = await bob.rules.queryFacts('online:*');
const onlineUsers = onlineFacts.map((f) => f.key.split(':')[1]);
console.log('Online:', onlineUsers.join(', '));
```

</details>

## Summary

- **Dual push channels** — store subscriptions deliver complete state (message history), rules subscriptions deliver individual events (live notifications)
- **Persist + broadcast** — insert into the store for durability, emit via rules for instant delivery
- **Correlation IDs** — `correlationId` and `causationId` parameters let you trace conversation threads
- **Topic patterns** — `chat:*` matches all rooms, `chat:general` matches one room; patterns use `:` as segment separator
- **Facts for presence** — `setFact`/`deleteFact`/`queryFacts` track ephemeral state like online users
- **Transactions** — atomic room creation ensures the room and its welcome message are created together or not at all
- **Reconnect recovery** — both store and rules subscriptions are automatically restored; store delivers fresh data, rules resumes listening from the reconnect point

---

Back to: [Learning Guide](../index.md)
