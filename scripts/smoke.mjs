import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_URL ?? "http://127.0.0.1:3400/mcp";
const token = process.env.MCP_TOKEN_FILE
  ? readFileSync(process.env.MCP_TOKEN_FILE, "utf8").trim()
  : process.env.MCP_AUTH_TOKEN;
assert.ok(token, "Set MCP_AUTH_TOKEN or MCP_TOKEN_FILE");
const health = new URL(endpoint);
health.pathname = health.pathname.replace(/\/mcp$/, "/health");
assert.equal((await fetch(health)).status, 200);
for (const method of ["GET", "POST", "DELETE"]) {
  assert.equal((await fetch(endpoint, { method })).status, 401, `${method} requires a token`);
  assert.equal((await fetch(endpoint, {
    method, headers: { Authorization: "Bearer invalid" },
  })).status, 401, `${method} rejects an invalid token`);
}
const client = new Client({ name: "hh-mcp-smoke", version: "1.0.0" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  const { tools } = await client.listTools();
  assert.equal(tools.length, 9);
  const status = await client.callTool({ name: "hh_auth", arguments: { action: "status" } });
  assert.ok(!status.isError, "Auth status must be readable");
  if (process.env.HH_SMOKE_LIVE === "1") {
    const result = await client.callTool({
      name: "hh_employer_vacancies",
      arguments: { action: "search", query: { text: "стоматолог", per_page: 1 } },
    });
    assert.ok(!result.isError, "Public vacancy search must succeed");
    assert.ok(result.content.some(item => item.type === "text" && item.text.includes('"items"')));
    console.log("PASS: live HH vacancy search");
  }
  console.log("PASS: health, missing/invalid auth, MCP initialize, nine tools, auth status");
} finally {
  await client.close();
}
