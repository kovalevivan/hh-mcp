import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hh-admin-browser-"));
const port = Number(process.env.FIXTURE_PORT || 3412),
  base = `http://127.0.0.1:${port}`;
process.env.HH_DATA_DIR = directory;
process.env.HH_API_BASE = base;
process.env.HH_AUTH_BASE = base;
const { initAuth, getClientId } = await import("../src/lib/auth.ts");
const { createSettingsStore } = await import("../src/lib/settings.ts");
const { createAdminRouter } = await import("../src/admin.ts");
initAuth(null, true);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
let tokenCalls = 0;
const codes = new Map();
const token = "b".repeat(64);
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.post("/api/admin/login/local", (req, res) => {
  if (req.body.password !== "test-password")
    return res.status(422).json({ message: "Invalid credentials" });
  const reader = req.body.email === "reader@example.test";
  res.json({
    token: reader ? "reader" : "admin",
    user: {
      id: reader ? "reader" : "admin",
      email: req.body.email,
      name: "Test administrator",
      role: reader ? "USER" : "ADMIN",
    },
  });
});
app.get("/api/admin/grants/effective", (req, res) =>
  res.json({
    capabilities:
      req.headers.authorization === "Bearer admin"
        ? ["access:admin", "manage:configs"]
        : ["access:admin"],
  }),
);
app.get("/api/admin/verify", (req, res) =>
  res.json({
    user: {
      id: req.headers.authorization === "Bearer admin" ? "admin" : "reader",
      name: "Test administrator",
      role: "ADMIN",
    },
  }),
);
app.get("/api/admin/oauth/openid/check", (_req, res) => res.sendStatus(404));
app.get("/oauth/authorize", (req, res) => {
  const code = randomBytes(16).toString("hex");
  codes.set(code, {
    challenge: req.query.code_challenge,
    redirectUri: req.query.redirect_uri,
  });
  const redirect = new URL(req.query.redirect_uri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", req.query.state);
  res.redirect(redirect.toString());
});
app.post("/token", (req, res) => {
  tokenCalls++;
  if (req.body.client_secret !== "fixture-secret")
    return res.status(400).json({ error: "invalid_client" });
  const grant = codes.get(req.body.code);
  codes.delete(req.body.code);
  if (
    !grant ||
    createHash("sha256")
      .update(req.body.code_verifier || "")
      .digest("base64url") !== grant.challenge ||
    req.body.redirect_uri !== grant.redirectUri
  )
    return res.status(400).json({ error: "invalid_grant" });
  res.json({
    access_token: "fixture-access",
    refresh_token: "fixture-refresh",
    expires_in: 3600,
  });
});
app.get("/me", (req, res) =>
  req.headers.authorization === "Bearer fixture-access"
    ? res.json({
        id: "manager-1",
        first_name: "Test",
        last_name: "Manager",
        employer: { id: "employer-1", name: "Test employer" },
      })
    : res
        .status(403)
        .json({ errors: [{ type: "oauth", value: "bad_authorization" }] }),
);
app.get("/fixture", (_req, res) =>
  res.json({ configured: Boolean(getClientId()), tokenCalls }),
);
app.use(
  "/admin",
  createAdminRouter({
    token,
    callbackUri: "http://127.0.0.1:3410/headhunter-callback",
    stateTtlMs: 600000,
    store: createSettingsStore(directory, "c".repeat(64)),
  }),
);
const server = app.listen(port, "127.0.0.1", () =>
  console.log("Isolated HH and LibreChat API fixtures ready at " + base),
);
process.on("SIGTERM", () =>
  server.close(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  }),
);
