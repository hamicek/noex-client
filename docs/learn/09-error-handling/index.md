# Part 9: Error Handling

Understand error classes, codes, and strategies for resilient applications.

## Chapters

### [9.1 Error Types](./01-error-types.md)

Learn the error hierarchy:
- `NoexClientError` — base class for all server errors, carries a machine-readable `code`
- `TimeoutError` — request did not receive a response within `requestTimeoutMs`
- `DisconnectedError` — attempted to send while not connected, or connection was lost
- Server error codes: VALIDATION_ERROR, UNAUTHORIZED, NOT_FOUND, RATE_LIMITED

### [9.2 Recovery Strategies](./02-recovery-strategies.md)

Handle errors gracefully in production:
- Mapping server error codes to user-facing messages
- Retry patterns for idempotent operations
- Why non-idempotent operations (insert, emit) are not auto-retried
- Graceful degradation when the server is unreachable

## What You'll Learn

By the end of this section, you'll be able to:
- Catch and classify errors by type and code
- Implement appropriate recovery strategies per error type
- Build resilient applications that degrade gracefully

---

Start with: [Error Types](./01-error-types.md)
