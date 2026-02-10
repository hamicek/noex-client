# Part 2: Getting Started

Install the SDK, connect to a server, and explore the configuration options.

## Chapters

### [2.1 Installation](./01-installation.md)

Set up the SDK in your project:
- `npm install @hamicek/noex-client`
- Node.js requires the `ws` package for WebSocket support
- Browser uses the native WebSocket — no extra dependencies

### [2.2 First Connection](./02-first-connection.md)

Connect to a running noex-server and interact with it:
- `NoexClient.connect()` and the welcome message
- `client.disconnect()` for graceful shutdown
- Lifecycle events: connected, disconnected, error

### [2.3 Configuration](./03-configuration.md)

Understand every option available in `ClientOptions` and `ReconnectOptions`:
- `requestTimeoutMs`, `connectTimeoutMs` — timeout controls
- `reconnect` — boolean or detailed `ReconnectOptions`
- `auth.token` — automatic login on connect
- `heartbeat` — automatic pong response
- `WebSocket` — custom WebSocket constructor for Node.js

## What You'll Learn

By the end of this section, you'll be able to:
- Install and import the SDK in Node.js and browser environments
- Connect to a noex-server and handle the welcome handshake
- Configure timeouts, reconnection, auth, and heartbeat

---

Start with: [Installation](./01-installation.md)
