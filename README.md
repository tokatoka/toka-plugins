# toka-plugins

A small [Claude Code](https://claude.com/claude-code) plugin marketplace.

## Plugins

### discord-extras

Companion to the official [`discord` channel plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) — adds tools the official plugin doesn't have yet. It is **not** a replacement: keep the official plugin installed for messaging (only official channel plugins get inbound-message and permission-relay powers).

**Tools:**

- `create_thread(chat_id, name, message_id?)` — create a thread in an allowlisted guild channel, standalone or anchored to an existing message. Returns the thread ID; pass it as `chat_id` to the official plugin's `reply`/`fetch_messages` to talk in the thread. (Tracking upstream: [claude-plugins-official#1144](https://github.com/anthropics/claude-plugins-official/issues/1144))

**Design:**

- Tools-only MCP server over Discord's REST API — no gateway connection, no duplicate bot session
- Shares the official plugin's state in `~/.claude/channels/discord/`: same `DISCORD_BOT_TOKEN` (from `.env`) and the same `access.json` allowlist, so it can only reach channels you approved via `/discord:access`

## Install

Requires [bun](https://bun.sh) and a working install of the official `discord` plugin (configured via `/discord:configure`).

```
/plugin marketplace add <path-or-git-url-of-this-repo>
/plugin install discord-extras@toka-local
/reload-plugins
```

## License

Apache-2.0
