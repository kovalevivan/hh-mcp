import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { initAuth } from "./lib/auth.js";
import { createServer, registerTools, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function startStdio(): Promise<void> {
  const server = createServer();
  registerTools(server);
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
  const app = express();
  const authToken = process.env.MCP_AUTH_TOKEN;

  if (authToken) {
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
  }

  // Streamable HTTP — основной транспорт MCP (claude.ai, Cursor remote, …)
  app.post("/mcp", async (req, res) => {
    delete req.headers["mcp-session-id"];
    delete req.headers["mcp-protocol-version"];
    try {
      const server = createServer();
      registerTools(server);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      transport.onerror = (err) => console.error("[MCP] transport error:", err.message);
      await server.connect(transport);
      await transport.handleRequest(req, res);
      await server.close();
    } catch (err) {
      console.error("[MCP] handler error:", (err as Error).message);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
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
    res.json({ status: "ok", name: SERVER_NAME, version: SERVER_VERSION })
  );

  app.listen(port, () => {
    console.error(`${SERVER_NAME} v${SERVER_VERSION} listening on http://localhost:${port}`);
    console.error(`Streamable HTTP: POST http://localhost:${port}/mcp`);
  });
}

initAuth();

const mode = process.argv.includes("--http") ? "http" : "stdio";
const portArg = process.argv.find((a) => a.startsWith("--port="));
const port = parseInt(process.env.PORT ?? "") || (portArg ? parseInt(portArg.split("=")[1], 10) : 3400);

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
