# Part 7: Authentication

Authenticate with token-based login and automatic session recovery on reconnect.

## Chapters

### [7.1 Login & Logout](./01-login-logout.md)

Manage auth sessions manually:
- `auth.login(token)` — authenticate and receive an AuthSession
- `auth.whoami()` — check current session (userId, roles, metadata, expiresAt)
- `auth.logout()` — end the current session

### [7.2 Auto Login](./02-auto-login.md)

Let the SDK handle authentication automatically:
- `ClientOptions.auth.token` — configure a token at construction time
- Automatic login after initial connect
- Automatic re-login after every successful reconnect

## What You'll Learn

By the end of this section, you'll be able to:
- Authenticate manually with login/logout
- Inspect the current session
- Configure automatic login for hands-free authentication

---

Start with: [Login & Logout](./01-login-logout.md)
