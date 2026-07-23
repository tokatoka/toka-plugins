#!/usr/bin/env bun
/**
 * discord-extras — companion MCP server to the official discord channel plugin.
 *
 * Tools-only, no gateway connection: talks to Discord over REST. Shares the
 * official plugin's state (~/.claude/channels/discord): same bot token, and
 * targets are gated against the same access.json allowlist, so this server
 * can't reach any channel the channel plugin couldn't.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const STATE_DIR = process.env.DISCORD_STATE_DIR ?? join(homedir(), '.claude', 'channels', 'discord')
const ACCESS_FILE = join(STATE_DIR, 'access.json')
const ENV_FILE = join(STATE_DIR, '.env')

// Same token the official plugin uses. Real env wins.
try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

const TOKEN = process.env.DISCORD_BOT_TOKEN
if (!TOKEN) {
  process.stderr.write(`discord-extras: DISCORD_BOT_TOKEN required (set in ${ENV_FILE})\n`)
  process.exit(1)
}

const API = 'https://discord.com/api/v10'

async function discord(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Discord API ${res.status}: ${json.message ?? JSON.stringify(json)}`)
  }
  return json
}

// Mirror the official plugin's outbound gate: only channels the user
// allowlisted via /discord:access. Guild channels only — thread creation
// needs a parent guild channel, so groups keys are exactly the valid targets.
function assertAllowedGuildChannel(chatId: string): void {
  let groups: Record<string, unknown> = {}
  try {
    groups = JSON.parse(readFileSync(ACCESS_FILE, 'utf8')).groups ?? {}
  } catch {}
  if (!(chatId in groups)) {
    throw new Error(
      `channel ${chatId} is not an allowlisted guild channel — add via /discord:access (threads/DMs can't be thread parents)`,
    )
  }
}

const mcp = new Server(
  { name: 'discord-extras', version: '0.0.1' },
  {
    capabilities: { tools: {} },
    instructions:
      'Companion tools for the discord channel plugin. create_thread returns a thread ID — pass it as chat_id to the discord plugin\'s reply/fetch_messages tools to talk in the thread.',
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_thread',
      description:
        'Create a thread in an allowlisted Discord guild channel. Pass chat_id of the parent channel and a name (max 100 chars). Optionally pass message_id to anchor the thread to an existing message. Returns the thread ID — use it as chat_id with the discord plugin\'s reply/fetch_messages to talk there.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Parent guild channel ID.' },
          name: { type: 'string', description: 'Thread name, max 100 chars.' },
          message_id: {
            type: 'string',
            description: 'Optional message to anchor the thread to. Omit for a standalone thread.',
          },
        },
        required: ['chat_id', 'name'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'create_thread': {
        const chat_id = args.chat_id as string
        const name = ((args.name as string) ?? '').trim()
        const message_id = args.message_id as string | undefined
        if (!name) throw new Error('thread name must not be empty')
        if (name.length > 100) throw new Error('thread name too long (Discord caps at 100 chars)')
        assertAllowedGuildChannel(chat_id)

        // Anchored: thread off an existing message. Standalone: public thread
        // (type 11) in the channel.
        const thread = message_id
          ? await discord('POST', `/channels/${chat_id}/messages/${message_id}/threads`, { name })
          : await discord('POST', `/channels/${chat_id}/threads`, { name, type: 11 })
        return {
          content: [{
            type: 'text',
            text: `thread created (id: ${thread.id}) — pass it as chat_id to the discord plugin's reply/fetch_messages to talk there`,
          }],
        }
      }
      default:
        return {
          content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
          isError: true,
        }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `${req.params.name} failed: ${msg}` }],
      isError: true,
    }
  }
})

await mcp.connect(new StdioServerTransport())

// EOF on stdin = Claude Code closed the connection.
process.stdin.on('end', () => process.exit(0))
process.stdin.on('close', () => process.exit(0))
