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
    {
      name: 'manage_thread',
      description:
        'Manage a Discord thread: rename, archive, unarchive, lock, or unlock it. The thread must belong to an allowlisted guild channel. Managing threads the bot did not create requires the bot role to have the "Manage Threads" server permission.',
      inputSchema: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: 'Thread ID to manage.' },
          action: {
            type: 'string',
            enum: ['rename', 'archive', 'unarchive', 'lock', 'unlock'],
            description: 'What to do with the thread.',
          },
          name: { type: 'string', description: 'New name (rename only, max 100 chars).' },
        },
        required: ['thread_id', 'action'],
      },
    },
    {
      name: 'delete_thread',
      description:
        'PERMANENTLY delete a Discord thread and all its messages. No undo — prefer manage_thread\'s archive action for cleanup. The thread must belong to an allowlisted guild channel, and the bot role needs the "Manage Threads" server permission.',
      inputSchema: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: 'Thread ID to permanently delete.' },
        },
        required: ['thread_id'],
      },
    },
    {
      name: 'list_threads',
      description:
        'List active (non-archived) threads of an allowlisted guild channel. Returns thread IDs and names — pass a thread ID as chat_id to the discord plugin\'s reply/fetch_messages to talk there.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Parent guild channel ID.' },
        },
        required: ['chat_id'],
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
      case 'manage_thread': {
        const thread_id = args.thread_id as string
        const action = args.action as string
        const name = (args.name as string | undefined)?.trim()

        // Gate on the thread's parent channel — same allowlist as everything else.
        const ch = await discord('GET', `/channels/${thread_id}`)
        if (!ch.parent_id) throw new Error(`${thread_id} is not a thread`)
        assertAllowedGuildChannel(ch.parent_id)

        let patch: Record<string, unknown>
        switch (action) {
          case 'rename':
            if (!name) throw new Error('rename requires a name')
            if (name.length > 100) throw new Error('thread name too long (Discord caps at 100 chars)')
            patch = { name }
            break
          case 'archive': patch = { archived: true }; break
          case 'unarchive': patch = { archived: false }; break
          case 'lock': patch = { locked: true }; break
          case 'unlock': patch = { locked: false }; break
          default: throw new Error(`unknown action: ${action}`)
        }
        const updated = await discord('PATCH', `/channels/${thread_id}`, patch)
        return {
          content: [{ type: 'text', text: `${action} ok — thread "${updated.name}" (id: ${updated.id})` }],
        }
      }
      case 'delete_thread': {
        const thread_id = args.thread_id as string

        // Same parent-channel gate as manage_thread. Fetch also confirms the
        // target really is a thread — never allow deleting a plain channel.
        const ch = await discord('GET', `/channels/${thread_id}`)
        if (!ch.parent_id || ![10, 11, 12].includes(ch.type)) {
          throw new Error(`${thread_id} is not a thread — delete_thread refuses non-thread channels`)
        }
        assertAllowedGuildChannel(ch.parent_id)

        await discord('DELETE', `/channels/${thread_id}`)
        return {
          content: [{ type: 'text', text: `permanently deleted thread "${ch.name}" (id: ${thread_id})` }],
        }
      }
      case 'list_threads': {
        const chat_id = args.chat_id as string
        assertAllowedGuildChannel(chat_id)

        // Active threads are listed guild-wide; filter to this channel.
        const parent = await discord('GET', `/channels/${chat_id}`)
        if (!parent.guild_id) throw new Error(`${chat_id} is not a guild channel`)
        const { threads } = await discord('GET', `/guilds/${parent.guild_id}/threads/active`)
        const mine = (threads as any[]).filter(t => t.parent_id === chat_id)
        const out =
          mine.length === 0
            ? '(no active threads)'
            : mine
                .map(t => `${t.name}  (id: ${t.id}, ${t.message_count} msgs${t.thread_metadata?.locked ? ', locked' : ''})`)
                .join('\n')
        return { content: [{ type: 'text', text: out }] }
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
