# Part 4: Reactive Subscriptions

Subscribe to server-side queries and receive live push updates whenever data changes.

## Chapters

### [4.1 Subscribing to Queries](./01-subscribing.md)

Set up your first reactive subscription:
- `store.subscribe(query, callback)` — register a query and receive updates
- Initial data delivered immediately via the callback
- Push updates arrive automatically when the query result changes on the server

### [4.2 Parameterized Queries](./02-parameterized-queries.md)

Pass dynamic parameters to server-side queries:
- `store.subscribe(query, params, callback)` — subscribe with parameters
- Use cases: filtering by user, role, status, or any dynamic value

### [4.3 Managing Subscriptions](./03-managing-subscriptions.md)

Clean up subscriptions properly:
- The unsubscribe function returned by `store.subscribe`
- Cleanup patterns for components and long-running processes
- Memory and resource considerations

## What You'll Learn

By the end of this section, you'll be able to:
- Subscribe to any server-side query and react to changes in real time
- Use parameterized queries for dynamic filtering
- Properly unsubscribe and avoid resource leaks

---

Start with: [Subscribing to Queries](./01-subscribing.md)
