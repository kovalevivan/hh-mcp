import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import os from "node:os";
import path from "node:path";

import { initAuth, getAuthRevision } from "./lib/auth.js";
import { hhRequest } from "./client/hh.js";
import { ResumeDetails } from "./resumes/details.js";
import {
  createServer,
  registerTools,
  SERVER_NAME,
  SERVER_VERSION,
} from "./server.js";
import { createAdminRouter } from "./admin.js";
import { createSettingsStore } from "./lib/settings.js";

async function startStdio(): Promise<void> {
  const server = createServer();
  registerTools(server, { resumeDetails });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} ready on stdio`);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      await server.close();
      process.exit(0);
    });
  }
}

async function startHttp(port: number): Promise<void> {
  const authToken = process.env.MCP_AUTH_TOKEN;
  if (!authToken?.trim()) {
    throw new Error("MCP_AUTH_TOKEN is required in HTTP mode");
  }
  const app = express();
  if (settingsStore) {
    if (process.env.HH_ADMIN_TOKEN === authToken)
      throw new Error("Use distinct administration and MCP access tokens");
    app.use(
      "/admin",
      createAdminRouter({
        store: settingsStore,
        token: process.env.HH_ADMIN_TOKEN!,
        callbackUri: process.env.HH_ADMIN_REDIRECT_URI ?? "",
        stateTtlMs: Number(process.env.HH_OAUTH_STATE_TTL_MS ?? 600_000),
      }),
    );
  }

  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    const header = req.headers.authorization;
    if (!header || header !== `Bearer ${authToken}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });
  console.error("[AUTH] HTTP Bearer auth enabled");

  // Streamable HTTP — основной транспорт MCP (claude.ai, Cursor remote, …)
  app.post("/mcp", async (req, res) => {
    delete req.headers["mcp-session-id"];
    delete req.headers["mcp-protocol-version"];
    try {
      const server = createServer();
      registerTools(server, { resumeDetails });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      transport.onerror = (err) =>
        console.error("[MCP] transport error:", err.message);
      await server.connect(transport);
      await transport.handleRequest(req, res);
      await server.close();
    } catch (err) {
      console.error("[MCP] handler error:", (err as Error).message);
      if (!res.headersSent)
        res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/mcp", (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write(": keepalive\n\n");
  });

  app.delete("/mcp", (_req, res) => res.status(200).json({ ok: true }));

  app.get("/health", (_req, res) =>
    res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION }),
  );

  app.listen(port, () => {
    console.error(
      `${SERVER_NAME} v${SERVER_VERSION} listening on http://localhost:${port}`,
    );
    console.error(`Streamable HTTP: POST http://localhost:${port}/mcp`);
  });
}

const mode = process.argv.includes("--http") ? "http" : "stdio";
const settingsStore =
  mode === "http" && process.env.HH_ADMIN_TOKEN
    ? createSettingsStore(
        process.env.HH_DATA_DIR || path.join(os.homedir(), ".hh-mcp"),
        process.env.HH_CONFIG_KEY ?? "",
      )
    : null;
initAuth(settingsStore?.load(), Boolean(settingsStore));
function detailSetting(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}
const resumeDetails = new ResumeDetails(hhRequest, getAuthRevision, {
  partChars: detailSetting("HH_RESUME_PART_CHARS", 6000, 1000, 20000),
  ttlSeconds: detailSetting("HH_RESUME_CONTINUATION_TTL_SECONDS", 600, 30, 3600),
  maxBytes: detailSetting("HH_RESUME_CONTINUATION_MAX_BYTES", 8 * 1024 * 1024, 20000, 32 * 1024 * 1024),
  maxEntries: detailSetting("HH_RESUME_CONTINUATION_MAX_ENTRIES", 50, 1, 200),
});
const portArg = process.argv.find((a) => a.startsWith("--port="));
const port =
  parseInt(process.env.PORT ?? "") ||
  (portArg ? parseInt(portArg.split("=")[1], 10) : 3400);

if (mode === "http") {
  startHttp(port).catch((err) => {
    console.error("Failed to start HTTP server:", err);
    process.exit(1);
  });
} else {
  startStdio().catch((err) => {
    console.error("Failed to start stdio server:", err);
    process.exit(1);
  });
}
