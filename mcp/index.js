#!/usr/bin/env node
'use strict';
/**
 * Veyline MCP server — node stdlib ONLY, zero dependencies.
 *
 * Exposes the Payload rail's Veyline A2A skills as MCP tools over stdio
 * (JSON-RPC 2.0), per the MCP 2024-11-05 protocol surface:
 *   initialize / notifications/initialized / tools/list / tools/call
 *
 * Each tool maps to one skill on the rail's A2A endpoint
 * (POST {PAYLOAD_RAIL_URL}/v1/a2a, A2A protocol 1.0, JSON-RPC `message/send`,
 * skill id carried in message.metadata.skillId, tool input carried as a
 * `data` part), authenticated with the USER's own rail API key (Bearer).
 * Skill list per the rail's agent card (/.well-known/agent-card.json):
 *   veyline_status    read org entitlement and tier (never authorizes payment)
 *   veyline_usage     read org quota and usage
 *   veyline_preflight signed, short-lived, policy-enforced payment preflight;
 *                     NO funds are transferred by a preflight
 *
 * Env:
 *   PAYLOAD_RAIL_API_KEY  required for tool calls; tools fail closed with a
 *                         clear "API key not configured" error when absent
 *   PAYLOAD_RAIL_URL      optional; default https://payload-rail.fly.dev
 */
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');

const VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'veyline';
const DEFAULT_RAIL_URL = 'https://payload-rail.fly.dev';
const TIMEOUT_MS = 30000;

const API_KEY_MISSING =
  'API key not configured: set PAYLOAD_RAIL_API_KEY to your own Payload rail ' +
  'API key (for an existing Veyline organization) and retry. This server ' +
  'never ships with a bundled key.';

function railUrl() {
  const u = (process.env.PAYLOAD_RAIL_URL || '').trim();
  return (u || DEFAULT_RAIL_URL).replace(/\/+$/, '');
}

function apiKey() {
  return (process.env.PAYLOAD_RAIL_API_KEY || '').trim();
}

/* ------------------------------------------------------------------ */
/* A2A transport: one JSON-RPC message/send per tool call.             */
/* ------------------------------------------------------------------ */
async function a2aSend(skillId, data) {
  const key = apiKey();
  if (!key) return { isError: true, text: JSON.stringify({ error: API_KEY_MISSING }) };

  const request = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: randomUUID(),
        role: 'user',
        parts: [{ kind: 'data', data: data || {} }],
        metadata: { skillId },
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${railUrl()}/v1/a2a`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (e) {
    const msg = e && e.name === 'AbortError'
      ? `rail request timed out after ${TIMEOUT_MS}ms`
      : `rail request failed: ${e && e.message ? e.message : String(e)}`;
    return { isError: true, text: JSON.stringify({ error: msg }) };
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }

  if (!res.ok) {
    return {
      isError: true,
      text: JSON.stringify({
        error: `rail HTTP ${res.status}`,
        body: parsed !== undefined ? parsed : raw.slice(0, 2000),
      }),
    };
  }
  if (parsed && parsed.error) {
    return {
      isError: true,
      text: JSON.stringify({ error: 'rail A2A error', detail: parsed.error }),
    };
  }
  return {
    isError: false,
    text: JSON.stringify(parsed ? parsed.result : { raw: raw.slice(0, 2000) }, null, 2),
  };
}

/* ------------------------------------------------------------------ */
/* Tool definitions: one MCP tool per A2A skill on the agent card.     */
/* ------------------------------------------------------------------ */
const TOOLS = [
  {
    name: 'veyline_status',
    skill: 'veyline_status',
    description:
      'Read the current authenticated organization Veyline entitlement and ' +
      'tier. Does not authorize a payment. (Rail A2A skill veyline_status.)',
    inputSchema: { type: 'object', properties: {} },
    buildInput: () => ({}),
  },
  {
    name: 'veyline_usage',
    skill: 'veyline_usage',
    description:
      'Read the current authenticated organization quota and usage. Does ' +
      'not change policy. (Rail A2A skill veyline_usage.)',
    inputSchema: { type: 'object', properties: {} },
    buildInput: () => ({}),
  },
  {
    name: 'veyline_preflight',
    skill: 'veyline_preflight',
    description:
      'Request a signed, short-lived, policy-enforced payment preflight. ' +
      'No funds are transferred. Requires Veyline execution scope and the ' +
      'original authoritative x402 quote. Pass the payment intent ' +
      '(recipient, amount, asset, network) and, when available, the ' +
      'original x402 quote object. (Rail A2A skill veyline_preflight.)',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          description: 'Intended payment recipient (wallet address or payee identifier).',
        },
        amount: {
          type: 'string',
          description: 'Payment amount as a decimal string, e.g. "12.50".',
        },
        asset: {
          type: 'string',
          description: 'Payment asset, e.g. "USDC".',
        },
        network: {
          type: 'string',
          description: 'Network for the payment, e.g. "base".',
        },
        quote: {
          type: 'object',
          description: 'Optional: the original authoritative x402 quote object for this payment.',
        },
      },
      required: ['recipient', 'amount', 'asset', 'network'],
    },
    buildInput: (args) => ({ ...args }),
  },
];

/* ------------------------------------------------------------------ */
/* JSON-RPC over stdio (framing mirrors the callx402 MCP server).      */
/* ------------------------------------------------------------------ */
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function result(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function error(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

async function handleToolsCall(id, params) {
  const name = params && params.name;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    error(id, -32602, `unknown tool '${name}'`);
    return;
  }
  const args = (params && params.arguments) || {};
  try {
    const out = await a2aSend(tool.skill, tool.buildInput(args));
    result(id, { content: [{ type: 'text', text: out.text }], isError: out.isError });
  } catch (e) {
    result(id, {
      content: [{ type: 'text', text: JSON.stringify({ error: e && e.message ? e.message : String(e) }) }],
      isError: true,
    });
  }
}

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: VERSION },
      });
      break;
    case 'notifications/initialized':
      break; // no response for notifications
    case 'tools/list':
      result(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
      break;
    case 'tools/call':
      if (id === undefined || id === null) break;
      await handleToolsCall(id, params);
      break;
    case 'ping':
      result(id, {});
      break;
    default:
      if (id !== undefined && id !== null) error(id, -32601, `method not found: ${method}`);
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let buffer = '';
  rl.on('line', (line) => {
    buffer += line;
    // Handle one complete JSON message per line (MCP stdio framing).
    try {
      const msg = JSON.parse(buffer);
      buffer = '';
      handleMessage(msg).catch((e) => {
        if (msg && msg.id !== undefined && msg.id !== null) error(msg.id, -32603, String((e && e.message) || e));
      });
    } catch {
      // Incomplete JSON — keep buffering. Guard against unbounded growth.
      if (buffer.length > 4 * 1024 * 1024) buffer = '';
    }
  });
  rl.on('close', () => process.exit(0));
}

if (require.main === module) main();
module.exports = { TOOLS, SERVER_NAME, VERSION, PROTOCOL_VERSION };
