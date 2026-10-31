import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import express from "express";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hh-admin-"));
process.env.HH_DATA_DIR = directory;
process.env.HH_AUTH_BASE = "https://hh.ru";
const auth = await import("../src/lib/auth.ts");
const { createSettingsStore } = await import("../src/lib/settings.ts");
const { createAdminRouter } = await import("../src/admin.ts");
const token = "a".repeat(64),
  key = "b".repeat(64);
const store = createSettingsStore(directory, key);
const callbackUri = "https://admin.example.com/headhunter-callback";
let server,
  base,
  exchanges = [];
let employer = true;
before(async () => {
  const app = express();
  app.use(
    "/admin",
    createAdminRouter({
      token,
      callbackUri,
      stateTtlMs: 600000,
      store,
      profile: async () => ({
        id: "manager1",
        first_name: "Test",
        employer: employer
          ? { id: "employer1", name: "Test employer" }
          : undefined,
      }),
      exchange: async (code, verifier) => {
        exchanges.push({ code, verifier });
        auth.setTokens("access-test", "refresh-test");
      },
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}/admin`;
});
after(async () => {
  server.close();
  await once(server, "close");
  fs.rmSync(directory, { recursive: true, force: true });
});
beforeEach(() => {
  auth.clearTokens(true);
  auth.initAuth();
  fs.rmSync(path.join(directory, "application.enc"), { force: true });
  exchanges = [];
  employer = true;
});
async function call(endpoint, method = "GET", body, bearer = token) {
  const r = await fetch(base + endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: body && method !== "GET" ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
async function save(secret = "application-secret") {
  return call("/settings", "PUT", {
    clientId: "client1",
    clientSecret: secret,
  });
}

test("management requires its own key and never accepts the chat key", async () => {
  for (const endpoint of [
    "/settings",
    "/authorize",
    "/exchange",
    "/disconnect",
  ])
    assert.equal(
      (
        await call(
          endpoint,
          endpoint === "/settings" ? "GET" : "POST",
          {},
          "chat-token",
        )
      ).status,
      401,
    );
});
test("encrypted credentials survive restart without exposing the secret", async () => {
  assert.equal((await call("/settings")).body.configured, false);
  const r = await save();
  assert.equal(r.status, 200);
  assert.equal(r.body.redirectUri, callbackUri);
  assert.equal(JSON.stringify(r.body).includes("application-secret"), false);
  const bytes = fs.readFileSync(
    path.join(directory, "application.enc"),
    "utf8",
  );
  assert.equal(bytes.includes("application-secret"), false);
  assert.equal(
    fs.statSync(path.join(directory, "application.enc")).mode & 0o777,
    0o600,
  );
  assert.equal(store.load().clientSecret, "application-secret");
  auth.initAuth(store.load());
  assert.equal(auth.getClientId(), "client1");
});
test("omitting a secret preserves it, changing client ID requires reentry", async () => {
  await save();
  auth.setTokens("access-test", "refresh-test");
  assert.equal(
    (await call("/settings", "PUT", { clientId: "client1" })).body.connected,
    true,
  );
  assert.equal(
    (await call("/settings", "PUT", { clientId: "different" })).status,
    400,
  );
  assert.equal(store.load().clientSecret, "application-secret");
});
test("rotating credentials clears the old account and invalidates pending authorization", async () => {
  await save();
  auth.setTokens("access-test", "refresh-test");
  const state = "1".repeat(64);
  await call("/authorize", "POST", { state });
  await save("rotated-secret");
  assert.equal(auth.getAccessToken(), null);
  assert.equal(
    (await call("/exchange", "POST", { state, code: "old-code" })).status,
    409,
  );
});
test("OAuth uses PKCE and consumes the state once", async () => {
  await save();
  const state = "2".repeat(64);
  const started = await call("/authorize", "POST", { state });
  assert.equal(started.status, 200);
  const url = new URL(started.body.url);
  assert.equal(url.origin, "https://hh.ru");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    (await call("/exchange", "POST", { state: "3".repeat(64), code: "bad" }))
      .status,
    409,
  );
  assert.equal(
    (await call("/exchange", "POST", { state, code: "good" })).status,
    200,
  );
  assert.equal(
    url.searchParams.get("code_challenge"),
    createHash("sha256").update(exchanges[0].verifier).digest("base64url"),
  );
  assert.equal(
    (await call("/exchange", "POST", { state, code: "replayed" })).status,
    409,
  );
  assert.equal(exchanges.length, 1);
});
test("cancellation consumes the pending flow", async () => {
  await save();
  const state = "4".repeat(64);
  await call("/authorize", "POST", { state });
  await call("/cancel", "POST", { state });
  assert.equal(
    (await call("/exchange", "POST", { state, code: "cancelled" })).status,
    409,
  );
});
test("disconnect preserves application settings and survives session reload", async () => {
  await save();
  auth.setTokens("access-test", "refresh-test");
  assert.equal(
    (await call("/test", "POST")).body.account.employer.id,
    "employer1",
  );
  const result = await call("/disconnect", "POST");
  assert.equal(result.body.connected, false);
  assert.equal(result.body.configured, true);
  auth.initAuth(store.load());
  assert.equal(auth.getAccessToken(), null);
  assert.equal(auth.getClientId(), "client1");
});
test("verification reports applicant accounts and missing login accurately", async () => {
  assert.equal((await call("/test", "POST")).status, 409);
  auth.setTokens("access-test", "refresh-test");
  employer = false;
  assert.equal((await call("/test", "POST")).body.error, "employer_required");
});
test("corrupt ciphertext and the wrong encryption key fail closed", () => {
  store.save({ clientId: "x", clientSecret: "y", redirectUri: callbackUri });
  assert.throws(() => createSettingsStore(directory, "c".repeat(64)).load());
  fs.writeFileSync(path.join(directory, "application.enc"), "tampered");
  assert.throws(() => store.load());
});
test("real code exchange cannot install an old token after application changes", async () => {
  let received, release;
  const called = new Promise((resolve) => {
    received = resolve;
  });
  const provider = express();
  provider.post(
    "/token",
    express.urlencoded({ extended: false }),
    async (req, res) => {
      assert.equal(req.body.code_verifier, "proof-key");
      received();
      await new Promise((resolve) => {
        release = resolve;
      });
      res.json({
        access_token: "stale",
        refresh_token: "stale-refresh",
        expires_in: 100,
      });
    },
  );
  const http = provider.listen(0, "127.0.0.1");
  await once(http, "listening");
  process.env.HH_API_BASE = `http://127.0.0.1:${http.address().port}`;
  try {
    auth.initAuth({
      clientId: "old",
      clientSecret: "old-secret",
      redirectUri: callbackUri,
    });
    const exchanging = auth.exchangeCode("code", "proof-key");
    const rejected = assert.rejects(exchanging, /Authentication changed/);
    await called;
    auth.configureApplication({
      clientId: "new",
      clientSecret: "new-secret",
      redirectUri: callbackUri,
    });
    release();
    await rejected;
    assert.equal(auth.getAccessToken(), null);
  } finally {
    http.close();
    await once(http, "close");
    delete process.env.HH_API_BASE;
  }
});

test("managed chat tools cannot change the shared account", async () => {
  const { authTool, managedAuthSchema } = await import("../src/tools/auth.ts");
  auth.initAuth(null, true);
  for (const action of [
    "logout",
    "set_tokens",
    "exchange_code",
    "get_auth_url",
    "refresh",
  ]) {
    assert.equal(
      (await authTool({ action, access_token: "injected" })).isError,
      true,
    );
    assert.equal(managedAuthSchema.safeParse({ action }).success, false);
  }
  assert.equal(auth.getAccessToken(), null);
  assert.equal((await authTool({ action: "status" })).isError, undefined);
});

test("a cancelled real code exchange cannot commit its tokens", async () => {
  let release, seen;
  const called = new Promise((resolve) => {
    seen = resolve;
  });
  let allowed = true;
  const provider = express();
  provider.post("/token", async (_req, res) => {
    seen();
    await new Promise((resolve) => {
      release = resolve;
    });
    res.json({
      access_token: "cancelled",
      refresh_token: "cancelled-refresh",
      expires_in: 100,
    });
  });
  const http = provider.listen(0, "127.0.0.1");
  await once(http, "listening");
  process.env.HH_API_BASE = `http://127.0.0.1:${http.address().port}`;
  try {
    auth.initAuth({
      clientId: "x",
      clientSecret: "y",
      redirectUri: callbackUri,
    });
    const exchanging = auth.exchangeCode("code", "proof", () => allowed);
    const rejected = assert.rejects(exchanging, /cancelled/);
    await called;
    allowed = false;
    release();
    await rejected;
    assert.equal(auth.getAccessToken(), null);
  } finally {
    http.close();
    await once(http, "close");
    delete process.env.HH_API_BASE;
  }
});

test("HH 403 token_expired refreshes once for concurrent and late responses", async () => {
  const { hhRequest } = await import("../src/client/hh.ts");
  let refreshes = 0,
    oldRequests = 0;
  const provider = express();
  provider.get("/me", async (req, res) => {
    if (req.headers.authorization === "Bearer new-access")
      return res.json({ id: "manager" });
    oldRequests++;
    if (oldRequests === 2)
      await new Promise((resolve) => setTimeout(resolve, 40));
    res
      .status(403)
      .json({ errors: [{ type: "oauth", value: "token_expired" }] });
  });
  provider.post(
    "/token",
    express.urlencoded({ extended: false }),
    async (req, res) => {
      assert.equal(req.body.grant_type, "refresh_token");
      assert.equal(req.body.refresh_token, "old-refresh");
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      res.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 100,
      });
    },
  );
  const http = provider.listen(0, "127.0.0.1");
  await once(http, "listening");
  process.env.HH_API_BASE = `http://127.0.0.1:${http.address().port}`;
  try {
    auth.initAuth();
    auth.setTokens("old-access", "old-refresh");
    const result = await Promise.all([
      hhRequest("GET", "/me"),
      hhRequest("GET", "/me"),
    ]);
    assert.equal(result[0].id, "manager");
    assert.equal(result[1].id, "manager");
    assert.equal(refreshes, 1);
    assert.equal(auth.hasRefreshToken(), true);
  } finally {
    http.close();
    await once(http, "close");
    delete process.env.HH_API_BASE;
  }
});

test("expired state is rejected before contacting the provider", async () => {
  auth.configureApplication({
    clientId: "x",
    clientSecret: "y",
    redirectUri: callbackUri,
  });
  let calls = 0;
  const app = express();
  app.use(
    createAdminRouter({
      token,
      callbackUri,
      stateTtlMs: 1,
      store,
      exchange: async () => {
        calls++;
      },
    }),
  );
  const http = app.listen(0, "127.0.0.1");
  await once(http, "listening");
  const url = `http://127.0.0.1:${http.address().port}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const state = "9".repeat(64);
  try {
    assert.equal(
      (
        await fetch(url + "/authorize", {
          method: "POST",
          headers,
          body: JSON.stringify({ state }),
        })
      ).status,
      200,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(
      (
        await fetch(url + "/exchange", {
          method: "POST",
          headers,
          body: JSON.stringify({ state, code: "expired" }),
        })
      ).status,
      409,
    );
    assert.equal(calls, 0);
  } finally {
    http.close();
    await once(http, "close");
  }
});
