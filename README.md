<!-- mcp-name: io.github.Payloadhq/veyline-mcp -->

# Veyline by Payload — MCP Server

An [MCP](https://modelcontextprotocol.io) server (stdio transport, Node.js standard library only, zero dependencies) that exposes **Veyline**, Payload's flagship noncustodial authorization layer, to AI agents.

Veyline decides whether an agent payment may proceed, under policy, before any wallet signs. This server wraps the Payload rail's Veyline A2A skills as MCP tools. Every tool call goes to the live Payload rail (`https://payload-rail.fly.dev`) authenticated with **your own** rail API key, for your own existing Veyline organization.

## Tools

| Tool | Upstream route | What it does |
|------|---------------|--------------|
| `veyline_status` | `POST /v1/a2a` (A2A skill `veyline_status`) | Read the current authenticated organization's Veyline entitlement and tier. Does not authorize a payment. |
| `veyline_usage` | `POST /v1/a2a` (A2A skill `veyline_usage`) | Read the current authenticated organization's quota and usage. Does not change policy. |
| `veyline_preflight` | `POST /v1/a2a` (A2A skill `veyline_preflight`) | Request a signed, short-lived, policy-enforced payment preflight. **No funds are transferred.** Requires Veyline execution scope and the original authoritative x402 quote. Inputs: `recipient`, `amount`, `asset`, `network`, optional `quote`. |

## Install

### Via Smithery

Listed on Smithery as [kyler-simmons-partners/veyline](https://smithery.ai/servers/kyler-simmons-partners/veyline), or install the MCPB bundle from this repo (`veyline.mcpb`) in any MCPB-compatible client.

### From source

```bash
git clone https://github.com/Payloadhq/veyline-mcp
cd veyline-mcp
node mcp/index.js
```

Or run it straight from GitHub with npx:

```bash
npx -y github:Payloadhq/veyline-mcp
```

MCP client configuration (stdio):

```json
{
  "mcpServers": {
    "veyline": {
      "command": "node",
      "args": ["/path/to/veyline-mcp/mcp/index.js"],
      "env": {
        "PAYLOAD_RAIL_API_KEY": "your-rail-api-key"
      }
    }
  }
}
```

## Configuration

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PAYLOAD_RAIL_API_KEY` | Required for tool calls | — | Your own Payload rail API key for an existing Veyline organization. Sent to the rail only as a Bearer `Authorization` header. |
| `PAYLOAD_RAIL_URL` | Optional | `https://payload-rail.fly.dev` | Payload rail base URL. |

**Fail-closed:** with no API key configured, the server still starts and lists its tools, and every tool call returns a clear `API key not configured` error. Nothing is ever sent anywhere without your key, and the key never leaves your machine except as the Authorization header to the rail.

## Notes

- A preflight is an authorization check, not a payment: it never moves funds.
- You need an existing Veyline organization on the Payload rail for the tools to return data.

## License

MIT — see [LICENSE](LICENSE).

---

Veyline is the flagship product of [Payload](https://github.com/Payloadhq). See also [callx402 by Payload](https://github.com/Payloadhq/callx402), the MCP client layer for x402-priced actions.
