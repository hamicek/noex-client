# Learning noex-client

A guide for Node.js and browser developers who want to build real-time applications with the noex-client SDK. Learn how to connect to a noex-server, manage data, subscribe to live updates, and handle reconnection — all with type-safe TypeScript.

## Who Is This For?

- Node.js / TypeScript developers (intermediate+)
- You know async/await and basic WebSocket concepts
- You don't need prior noex experience
- You want a structured client SDK instead of hand-rolling WebSocket messages

## Learning Path

### Part 1: Introduction

Understand why a client SDK exists and how its layers fit together.

| Chapter | Description |
|---------|-------------|
| [1.1 Why a Client SDK?](./01-introduction/01-why-client-sdk.md) | Problems with raw WebSocket communication and how the SDK solves them |
| [1.2 Key Concepts](./01-introduction/02-key-concepts.md) | Layered architecture (transport → protocol → API), connection lifecycle, glossary |

### Part 2: Getting Started

Install the SDK and make your first connection.

| Chapter | Description |
|---------|-------------|
| [2.1 Installation](./02-getting-started/01-installation.md) | npm install, Node.js vs browser setup, the `ws` package |
| [2.2 First Connection](./02-getting-started/02-first-connection.md) | NoexClient.connect(), welcome info, disconnect, lifecycle events |
| [2.3 Configuration](./02-getting-started/03-configuration.md) | All ClientOptions and ReconnectOptions fields with defaults |

### Part 3: Store Operations

Read and write data through typed bucket handles.

| Chapter | Description |
|---------|-------------|
| [3.1 Basic CRUD](./03-store-operations/01-basic-crud.md) | bucket(), insert, get, update, delete |
| [3.2 Queries](./03-store-operations/02-queries.md) | all, where, findOne, count |
| [3.3 Aggregations & Pagination](./03-store-operations/03-aggregations-pagination.md) | first, last, paginate, sum, avg, min, max |
| [3.4 Typed Buckets](./03-store-operations/04-typed-buckets.md) | BucketAPI\<T\> generics, RecordMeta, type safety |

### Part 4: Reactive Subscriptions

Subscribe to server-side queries and receive push updates.

| Chapter | Description |
|---------|-------------|
| [4.1 Subscribing to Queries](./04-subscriptions/01-subscribing.md) | store.subscribe, initial data, push updates |
| [4.2 Parameterized Queries](./04-subscriptions/02-parameterized-queries.md) | Subscribe with params, dynamic queries |
| [4.3 Managing Subscriptions](./04-subscriptions/03-managing-subscriptions.md) | Unsubscribe, cleanup patterns, best practices |

### Part 5: Transactions

Execute multiple store operations atomically.

| Chapter | Description |
|---------|-------------|
| [5.1 Atomic Operations](./05-transactions/01-atomic-operations.md) | store.transaction, operations array, supported operation types |
| [5.2 Transaction Patterns](./05-transactions/02-patterns.md) | Cross-bucket operations, read-modify-write, error handling |

### Part 6: Rules Integration

Emit events, manage facts, and subscribe to rule matches.

| Chapter | Description |
|---------|-------------|
| [6.1 Events](./06-rules/01-events.md) | rules.emit, topic, data, correlationId, causationId |
| [6.2 Facts](./06-rules/02-facts.md) | setFact, getFact, deleteFact, queryFacts, getAllFacts |
| [6.3 Rules Subscriptions](./06-rules/03-rules-subscriptions.md) | rules.subscribe with pattern, event push channel, unsubscribe |

### Part 7: Authentication

Authenticate with token-based login and automatic session recovery.

| Chapter | Description |
|---------|-------------|
| [7.1 Login & Logout](./07-authentication/01-login-logout.md) | auth.login, auth.whoami, auth.logout, AuthSession |
| [7.2 Auto Login](./07-authentication/02-auto-login.md) | ClientOptions.auth, auto-login on connect and reconnect |

### Part 8: Reconnection & Resilience

Handle network failures with automatic reconnect and subscription recovery.

| Chapter | Description |
|---------|-------------|
| [8.1 Automatic Reconnect](./08-reconnection/01-automatic-reconnect.md) | ReconnectOptions, exponential backoff, jitter, maxRetries |
| [8.2 Subscription Recovery](./08-reconnection/02-subscription-recovery.md) | Resubscribe after reconnect, ID updates, fresh data delivery |
| [8.3 Heartbeat](./08-reconnection/03-heartbeat.md) | Ping/pong, automatic pong response, dead connection detection |

### Part 9: Error Handling

Understand error classes, codes, and recovery strategies.

| Chapter | Description |
|---------|-------------|
| [9.1 Error Types](./09-error-handling/01-error-types.md) | NoexClientError, TimeoutError, DisconnectedError, error codes |
| [9.2 Recovery Strategies](./09-error-handling/02-recovery-strategies.md) | Server error codes, retry patterns, graceful degradation |

### Part 10: Testing

Set up tests and verify real-time behavior.

| Chapter | Description |
|---------|-------------|
| [10.1 Test Setup](./10-testing/01-test-setup.md) | Vitest, test server, port: 0, cleanup |
| [10.2 Testing Patterns](./10-testing/02-testing-patterns.md) | Testing subscriptions, reconnect, auth, edge cases |

### Part 12: Logic Integration

Use the logic engine for computed fields, views, constraints, and expressions.

| Chapter | Description |
|---------|-------------|
| [12.1 Setup](./12-logic/01-setup.md) | `client.logic` namespace, `expr` helper, server requirements |
| [12.2 Computed Fields](./12-logic/02-computed-fields.md) | defineComputed, dropComputed, listComputed, store integration |
| [12.3 Views and Constraints](./12-logic/03-views-and-constraints.md) | defineView, queryView, defineConstraint, constraint violations |
| [12.4 View Subscriptions](./12-logic/04-view-subscriptions.md) | subscribeView, evaluateExpr, expr helper, reconnect recovery |

### Part 11: Projects

Apply everything in real-world projects.

| Chapter | Description |
|---------|-------------|
| [11.1 Todo App](./11-projects/01-todo-app.md) | CRUD + subscriptions, real-time updates |
| [11.2 Realtime Dashboard](./11-projects/02-realtime-dashboard.md) | Reactive queries, auth, multi-client, aggregations |
| [11.3 Chat Application](./11-projects/03-chat-application.md) | Rules + subscriptions, reconnect recovery, transactions |

## Chapter Format

Each chapter includes:

1. **Introduction** - What you'll learn and why it matters
2. **Theory** - Concept explanation with diagrams and comparison tables
3. **Example** - Complete runnable code with progressive steps
4. **Exercise** - Practical task with solution
5. **Summary** - Key takeaways
6. **Next Steps** - Link to next chapter

## Getting Help

- [API Reference](../reference/index.md) - Complete API documentation

---

Ready to start? Begin with [Why a Client SDK?](./01-introduction/01-why-client-sdk.md)
