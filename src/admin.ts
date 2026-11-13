import { Router, json } from "express";
import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type {
  ApplicationSettings,
  createSettingsStore,
} from "./lib/settings.js";
import {
  buildAuthorizeUrl,
  clearTokens,
  configureApplication,
  exchangeCode,
  getAccessToken,
  getClientId,
  getClientSecret,
  getRedirectUri,
  hasRefreshToken,
} from "./lib/auth.js";
import { hhRequest } from "./client/hh.js";

interface HhProfile {
  id: string;
  first_name?: string;
  last_name?: string;
  employer?: { id: string; name?: string };
}

interface AdminOptions {
  token: string;
  callbackUri: string;
  stateTtlMs: number;
  store: ReturnType<typeof createSettingsStore>;
  profile?: () => Promise<HhProfile>;
  exchange?: (
    code: string,
    codeVerifier: string,
    canCommit: () => boolean,
  ) => Promise<unknown>;
}

const settingsInput = z
  .object({
    clientId: z.string().trim().min(1).max(256),
    clientSecret: z.string().trim().max(4096).optional(),
  })
  .strict();
const stateInput = z
  .object({ state: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const exchangeInput = stateInput.extend({ code: z.string().min(1).max(4096) });

export function createAdminRouter(options: AdminOptions): Router {
  if (options.token.length < 32)
    throw new Error("HH_ADMIN_TOKEN must contain at least 32 characters");
  const callback = new URL(options.callbackUri);
  if (
    (callback.protocol !== "https:" &&
      !(
        callback.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname)
      )) ||
    callback.username ||
    callback.password ||
    callback.hash ||
    callback.search
  ) {
    throw new Error("HH_ADMIN_REDIRECT_URI must be a clean HTTPS callback URL");
  }
  if (
    !Number.isSafeInteger(options.stateTtlMs) ||
    options.stateTtlMs < 1 ||
    options.stateTtlMs > 600_000
  ) {
    throw new Error("HH_OAUTH_STATE_TTL_MS must be between 1 and 600000");
  }
  const profile = options.profile ?? (() => hhRequest<HhProfile>("GET", "/me"));
  const exchange = options.exchange ?? exchangeCode;
  const flows = new Map<
    string,
    { issued: number; verifier: string; used: boolean; cancelled: boolean }
  >();
  const cancelFlows = () => {
    for (const flow of flows.values()) flow.cancelled = true;
    flows.clear();
  };
  const router = Router();
  const expected = Buffer.from(`Bearer ${options.token}`);
  router.use((req, res, next) => {
    const received = Buffer.from(req.headers.authorization ?? "");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(json({ limit: "8kb" }));

  const status = () => ({
    configured: Boolean(getClientId() && getClientSecret()),
    clientId: getClientId() ?? "",
    redirectUri: options.callbackUri,
    connected: Boolean(getAccessToken()),
    renewable: hasRefreshToken(),
    needsMigration: Boolean(
      getClientId() &&
      getClientSecret() &&
      getRedirectUri() !== options.callbackUri,
    ),
  });

  router.get("/settings", (_req, res) => res.json(status()));
  router.put("/settings", (req, res) => {
    const input = settingsInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "invalid_settings" });
      return;
    }
    const clientSecret = input.data.clientSecret || getClientSecret();
    if (!clientSecret) {
      res.status(400).json({ error: "secret_required" });
      return;
    }
    if (input.data.clientId !== getClientId() && !input.data.clientSecret) {
      res.status(400).json({ error: "secret_required" });
      return;
    }
    const settings: ApplicationSettings = {
      ...input.data,
      clientSecret,
      redirectUri: options.callbackUri,
    };
    if (
      settings.clientId === getClientId() &&
      settings.clientSecret === getClientSecret() &&
      settings.redirectUri === getRedirectUri()
    ) {
      res.json(status());
      return;
    }
    try {
      clearTokens(true);
      options.store.save(settings);
      configureApplication(settings);
      cancelFlows();
      res.json(status());
    } catch {
      res.status(500).json({ error: "save_failed" });
    }
  });

  router.post("/authorize", (req, res) => {
    const input = stateInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "invalid_state" });
      return;
    }
    if (!status().configured || getRedirectUri() !== options.callbackUri) {
      res.status(409).json({ error: "not_configured" });
      return;
    }
    cancelFlows();
    const verifier = randomBytes(32).toString("base64url");
    flows.set(input.data.state, {
      issued: Date.now(),
      verifier,
      used: false,
      cancelled: false,
    });
    res.json({
      url: buildAuthorizeUrl({
        state: input.data.state,
        force: Boolean(getAccessToken()),
        codeChallenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      }),
    });
  });

  router.post("/cancel", (req, res) => {
    const input = stateInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "invalid_state" });
      return;
    }
    const flow = flows.get(input.data.state);
    if (flow) flow.cancelled = true;
    flows.delete(input.data.state);
    res.json({ cancelled: true });
  });

  router.post("/exchange", async (req, res) => {
    const input = exchangeInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "invalid_callback" });
      return;
    }
    const flow = flows.get(input.data.state);
    if (
      !flow ||
      flow.used ||
      flow.cancelled ||
      Date.now() - flow.issued >= options.stateTtlMs
    ) {
      res.status(409).json({ error: "expired_state" });
      return;
    }
    flow.used = true;
    try {
      await exchange(
        input.data.code,
        flow.verifier,
        () => !flow.cancelled && Date.now() - flow.issued < options.stateTtlMs,
      );
      res.json(status());
    } catch {
      res.status(400).json({ error: "authorization_failed" });
    } finally {
      if (flows.get(input.data.state) === flow) flows.delete(input.data.state);
    }
  });

  router.post("/test", async (_req, res) => {
    if (!getAccessToken()) {
      res.status(409).json({ error: "not_connected" });
      return;
    }
    try {
      const me = await profile();
      if (!me.employer?.id) {
        res.status(403).json({ error: "employer_required" });
        return;
      }
      res.json({
        ...status(),
        account: {
          id: me.id,
          name: [me.first_name, me.last_name].filter(Boolean).join(" "),
          employer: { id: me.employer.id, name: me.employer.name ?? "" },
        },
      });
    } catch {
      res.status(502).json({ error: "verification_failed" });
    }
  });

  router.post("/disconnect", (_req, res) => {
    try {
      clearTokens(true);
      cancelFlows();
      res.json(status());
    } catch {
      res.status(500).json({ error: "disconnect_failed" });
    }
  });
  return router;
}
