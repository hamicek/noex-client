# Part 1: Introduction

This section explains why a client SDK exists and introduces the architecture you'll work with throughout the guide.

## Chapters

### [1.1 Why a Client SDK?](./01-why-client-sdk.md)

Learn about the problems with raw WebSocket communication and how the SDK provides a structured alternative:
- Manual message framing, correlation, and error handling
- No type safety or abstraction over the wire protocol
- Reconnection, subscription recovery, and heartbeat left to the developer

### [1.2 Key Concepts](./02-key-concepts.md)

Get an overview of the fundamental building blocks:
- **Transport** - WebSocket connection management, send/receive
- **Protocol** - Message framing, request/response correlation, push routing
- **API** - High-level store, rules, and auth operations
- **Connection lifecycle** - connecting → connected → reconnecting → disconnected
- **Glossary** - Bucket, subscription, push, welcome, heartbeat

## What You'll Learn

By the end of this section, you'll understand:
- Why a dedicated SDK is better than hand-rolling WebSocket messages
- How the three-layer architecture (transport → protocol → API) works
- What each connection state means and when transitions happen
- The vocabulary used throughout the rest of the guide

---

Start with: [Why a Client SDK?](./01-why-client-sdk.md)
