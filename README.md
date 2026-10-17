<!-- mcp-name: io.github.payload-tools/veyline-mcp -->

# Veyline by Payload — MCP Server

An [MCP](https://modelcontextprotocol.io) server (stdio transport, Node.js standard library only, zero dependencies) that exposes **Veyline**, Payload's flagship noncustodial authorization layer, to AI agents.

Veyline decides whether an agent payment may proceed, under policy, before any wallet signs. This server wraps the Payload rail's Veyline A2A skills as MCP tools. Every tool call goes to the live Payload rail (`https://payload-rail.fly.dev`) authenticated with **your own** rail API key, for your own existing Veyline organization.

## Tools

| Tool | Upstream route | What it does |
|------|---------------|--------------|
| `veyline_status` | `POST /v1/a2a` (A2A skill `veyline_status`) | Read the current authenticated organization's Veyline entitlement and tier. Does not authorize a payment. |
| `veyline_usage` | `POST /v1/a2a` (A2A skill `veyline_usage`) | Read the current authenticated organization's quota and usage. Does not change policy. |
| `veyline_preflight` | `POST /v1/a2a` (A2A skill `veyline_preflight`) | Request a signed, short-lived, policy-enforced payment preflight. **No funds are transferred.** Requires Veyline execution scope and the original authoritative x402 quote. Inputs include the authoritative `protocol`, `provider`, `action`, `network` (`eip155:8453`), `asset`, `amount_cents`, `recipient`, `request_hash`, `quote_id`, and `quote`. |

## Adding Veyline to an agent workflow

Veyline sits between an agent that wants to pay and the wallet that signs. You add it to the stack you already have; you do not rebuild around it.

1. **The agent identifies a payment it intends to make.** Your application knows the recipient, amount, asset, and network.
2. **The application obtains authoritative payment details.** For x402-priced actions, that is the original quote returned by the seller, not a number the agent guessed.
3. **Veyline evaluates the proposed action.** Call `veyline_preflight` with the complete authoritative quote and its associated request hash, action, amount in cents, recipient, asset, CAIP-2 network, and quote ID. Incomplete quote requests fail closed. Veyline checks the request against your organization's authorization policies, spending limits, and permitted recipients before anything is signed.
4. **An eligible request receives a scoped, signed, expiring authorization.** A preflight returns a signed, short-lived authorization bound to that payment intent. A request outside policy is refused, and nothing proceeds.
5. **Your own wallet or signer executes the payment.** The customer's wallet, signer, or approved execution system performs the payment within the authorized boundaries. Veyline never holds funds and never signs in place of your wallet.
6. **Evidence is recorded or verified through supported functionality.** Your application keeps the preflight result alongside the payment it authorized. On the same rail, RevRule records payout evidence linked back to the original entitlement entries, so a payout can later be checked against what was owed.

Two reads round out the integration: `veyline_status` reports your organization's entitlement and tier, and `veyline_usage` reports quota and usage. Neither authorizes a payment.

Plainly stated: Veyline provides governance and authorization without custody of customer funds. It does not execute payments itself, and it cannot guarantee that external payment systems, networks, or counterparties will not fail. What it does guarantee is narrower and useful: a payment your application routes through preflight gets a policy check before any wallet signs.

### Evaluate free, then subscribe

- **Evaluation:** get a free Payload rail API key from the sandbox signup on https://payloadhq.github.io/veyline.html (email only, free tier with 1,000 operations per month) or from the console at https://payload-rail.fly.dev/revrule-console/, and use it with your Veyline organization. Install the verified MCPB release below; no preconfigured key is included.
- **Paid:** the Veyline Developer subscription starts at $99 per month via https://payloadhq.github.io/veyline.html and is the production path for payment-enabled agents and APIs that need policy-enforced authorization in the loop.

## Install

### Verified MCPB release

Install the [veyline v1.1.0 MCPB bundle](https://github.com/Payloadhq/veyline-mcp/releases/download/v1.1.0/veyline.mcpb) in an MCPB-compatible client, or run from source below. The published bundle declares the supported MCP tools. This direct release is the verified installation path while third-party directory listings are revalidated.

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
