import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function cleanEnvironment(directory) {
  const env = { ...process.env, HH_DATA_DIR: directory };
  for (const key of Object.keys(env)) {
    if ((key.startsWith("HH_") && key !== "HH_DATA_DIR") || key === "MCP_AUTH_TOKEN") delete env[key];
  }
  return env;
}

for (const value of [undefined, "", "   "]) {
  test(`HTTP mode refuses a ${JSON.stringify(value)} token before listening`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hh-http-security-"));
    try {
      const env = cleanEnvironment(directory);
      if (value !== undefined) env.MCP_AUTH_TOKEN = value;
      const child = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "--http"], {
        env, encoding: "utf8", timeout: 5000,
      });
      assert.equal(child.status, 1, child.stderr);
      assert.match(child.stderr, /MCP_AUTH_TOKEN is required in HTTP mode/);
      assert.doesNotMatch(child.stderr, /listening on/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("stdio mode remains usable without an HTTP bearer token", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hh-stdio-security-"));
  const client = new Client({ name: "hh-stdio-security-test", version: "1" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", "src/index.ts"],
      env: cleanEnvironment(directory), stderr: "pipe",
    }));
    assert.equal((await client.listTools()).tools.length, 13);
  } finally {
    await client.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
