# Part 10: Testing

Set up integration tests and verify real-time behavior.

## Chapters

### [10.1 Test Setup](./01-test-setup.md)

Configure your test environment:
- Vitest as the test runner
- Starting a test server with `port: 0` and `host: '127.0.0.1'`
- Client setup and teardown with proper cleanup
- Handling async operations in tests

### [10.2 Testing Patterns](./02-testing-patterns.md)

Test common SDK scenarios:
- Subscription tests — verifying initial data and push updates
- Reconnect tests — simulating disconnection and verifying recovery
- Auth tests — login, unauthorized access, session expiry
- Edge cases — timeouts, concurrent operations, rapid subscribe/unsubscribe

## What You'll Learn

By the end of this section, you'll be able to:
- Set up a reliable test environment for noex-client
- Write tests for subscriptions, reconnect, and auth flows
- Handle async timing in tests correctly

---

Start with: [Test Setup](./01-test-setup.md)
