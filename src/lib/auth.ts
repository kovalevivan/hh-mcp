import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { HhApiError } from "./errors.js";
import type { ApplicationSettings } from "./settings.js";

interface AuthState {
  authBase: string;
  apiBase: string;
  userAgent: string;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
}

const TOKENS_DIR =
  process.env.HH_DATA_DIR || path.join(os.homedir(), ".hh-mcp");
const TOKENS_PATH = path.join(TOKENS_DIR, "tokens.json");

const state: AuthState = {
  authBase: "https://hh.kz",
  apiBase: "https://api.hh.ru",
  userAgent: "hh-mcp/0.1.1 (+https://github.com/mardanaltynbekov1104/hh-mcp)",
  clientId: null,
  clientSecret: null,
  redirectUri: "urn:ietf:wg:oauth:2.0:oob",
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
};

let refreshPromise: Promise<void> | null = null;
let authGeneration = 0;
let adminManaged = false;

export function initAuth(
  application?: ApplicationSettings | null,
  managed = false,
): void {
  adminManaged = managed;
  authGeneration++;
  refreshPromise = null;
  state.accessToken = null;
  state.refreshToken = null;
  state.expiresAt = null;
  state.authBase = (process.env.HH_AUTH_BASE ?? "https://hh.kz").replace(
    /\/+$/,
    "",
  );
  state.apiBase = (process.env.HH_API_BASE ?? "https://api.hh.ru").replace(
    /\/+$/,
    "",
  );
  state.userAgent =
    process.env.HH_USER_AGENT ||
    "hh-mcp/0.1.1 (+https://github.com/mardanaltynbekov1104/hh-mcp)";
  state.clientId = process.env.HH_CLIENT_ID || null;
  state.clientSecret = process.env.HH_CLIENT_SECRET || null;
  state.redirectUri =
    process.env.HH_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob";
  if (application) {
    state.clientId = application.clientId;
    state.clientSecret = application.clientSecret;
    state.redirectUri = application.redirectUri;
  }

  // 1) tokens.json в приоритете (свежее, чем env)
  const fromDisk = loadTokensFromDisk();
  if (fromDisk) {
    state.accessToken = fromDisk.accessToken;
    state.refreshToken = fromDisk.refreshToken;
    state.expiresAt = fromDisk.expiresAt ?? null;
  }

  // 2) env как fallback
  if (!application && !state.accessToken && process.env.HH_ACCESS_TOKEN) {
    state.accessToken = process.env.HH_ACCESS_TOKEN;
  }
  if (!application && !state.refreshToken && process.env.HH_REFRESH_TOKEN) {
    state.refreshToken = process.env.HH_REFRESH_TOKEN;
  }

  const mode = state.accessToken
    ? "tokens"
    : state.clientId
      ? "oauth-ready"
      : "anonymous";
  console.error(
    `[AUTH] api=${state.apiBase} auth=${state.authBase} mode=${mode} client_id=${state.clientId ? "set" : "unset"}`,
  );
}

export function getApiBase(): string {
  return state.apiBase;
}

export function getAuthBase(): string {
  return state.authBase;
}

export function getUserAgent(): string {
  return state.userAgent;
}

export function getClientId(): string | null {
  return state.clientId;
}

export function getClientSecret(): string | null {
  return state.clientSecret;
}

export function isAdminManaged(): boolean {
  return adminManaged;
}

export function configureApplication(application: ApplicationSettings): void {
  state.clientId = application.clientId;
  state.clientSecret = application.clientSecret;
  state.redirectUri = application.redirectUri;
  authGeneration++;
  state.accessToken = null;
  state.refreshToken = null;
  state.expiresAt = null;
  refreshPromise = null;
}

export function getRedirectUri(): string {
  return state.redirectUri;
}

export function getAccessToken(): string | null {
  return state.accessToken;
}

export function hasRefreshToken(): boolean {
  return !!state.refreshToken;
}

export function setTokens(
  accessToken: string,
  refreshToken?: string | null,
  expiresInSec?: number | null,
  expectedGeneration = authGeneration,
  advanceGeneration = true,
): void {
  if (expectedGeneration !== authGeneration)
    throw new Error("Authentication changed; reconnect HeadHunter");
  const next = {
    accessToken,
    refreshToken:
      refreshToken !== undefined ? refreshToken : state.refreshToken,
    expiresAt: expiresInSec ? Date.now() + expiresInSec * 1000 : null,
  };
  persistTokens(next);
  state.accessToken = accessToken;
  state.refreshToken = next.refreshToken;
  state.expiresAt = next.expiresAt;
  if (advanceGeneration) {
    authGeneration++;
    refreshPromise = null;
  }
}

export function clearTokens(strict = false): void {
  if (strict) fs.rmSync(TOKENS_PATH, { force: true });
  authGeneration++;
  refreshPromise = null;
  state.accessToken = null;
  state.refreshToken = null;
  state.expiresAt = null;
  try {
    if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
  } catch (err) {
    console.error(
      "[AUTH] failed to remove tokens.json:",
      (err as Error).message,
    );
  }
}

function loadTokensFromDisk(): {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
} | null {
  try {
    if (!fs.existsSync(TOKENS_PATH)) return null;
    const raw = fs.readFileSync(TOKENS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    };
    return {
      accessToken: parsed.access_token ?? null,
      refreshToken: parsed.refresh_token ?? null,
      expiresAt: parsed.expires_at ?? null,
    };
  } catch (err) {
    console.error("[AUTH] failed to load tokens.json:", (err as Error).message);
    return null;
  }
}

function persistTokens(
  tokens: Pick<AuthState, "accessToken" | "refreshToken" | "expiresAt">,
): void {
  const temporary = TOKENS_PATH + "." + randomBytes(8).toString("hex") + ".tmp";
  try {
    if (!fs.existsSync(TOKENS_DIR)) {
      fs.mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(
      temporary,
      JSON.stringify(
        {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_at: tokens.expiresAt,
          saved_at: Date.now(),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    fs.renameSync(temporary, TOKENS_PATH);
  } catch (err) {
    console.error(
      "[AUTH] failed to persist tokens.json:",
      (err as Error).message,
    );
    throw new Error("Failed to save HeadHunter session");
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/**
 * Refresh access token using refresh_token grant.
 * HH docs: https://github.com/hhru/api/blob/master/docs/authorization_for_user.md
 *
 * @throws if refresh fails or refresh_token is missing
 */
export async function refreshAccessToken(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  const generation = authGeneration;
  const promise = (async () => {
    if (!state.refreshToken) {
      throw new HhApiError({
        status: 401,
        endpoint: "POST /oauth/token",
        message:
          "no refresh_token — run hh_auth action=get_auth_url and exchange_code first",
      });
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: state.refreshToken,
    });
    const res = await fetch(`${state.apiBase}/token`, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": state.userAgent,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HhApiError({
        status: res.status,
        endpoint: "POST /oauth/token (refresh)",
        message: `${res.status} ${res.statusText}`,
        body: text,
      });
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    setTokens(
      json.access_token,
      json.refresh_token ?? state.refreshToken,
      json.expires_in ?? null,
      generation,
      false,
    );
    console.error("[AUTH] refreshed access_token");
  })();
  refreshPromise = promise;
  try {
    await refreshPromise;
  } finally {
    if (refreshPromise === promise) refreshPromise = null;
  }
}

/**
 * Exchange authorization_code for tokens.
 */
export async function exchangeCode(
  code: string,
  codeVerifier?: string,
  canCommit: () => boolean = () => true,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const generation = authGeneration;
  if (!state.clientId || !state.clientSecret) {
    throw new HhApiError({
      status: 400,
      endpoint: "POST /oauth/token",
      message: "HH_CLIENT_ID and HH_CLIENT_SECRET are required",
    });
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: state.clientId,
    client_secret: state.clientSecret,
    code,
    redirect_uri: state.redirectUri,
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);
  const res = await fetch(`${state.apiBase}/token`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": state.userAgent,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HhApiError({
      status: res.status,
      endpoint: "POST /oauth/token (exchange)",
      message: `${res.status} ${res.statusText}`,
      body: text,
    });
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  if (!canCommit())
    throw new Error("Authorization was cancelled; reconnect HeadHunter");
  setTokens(json.access_token, json.refresh_token, json.expires_in, generation);
  return json;
}

/**
 * Build authorize URL for OAuth code flow.
 */
export function buildAuthorizeUrl(opts?: {
  state?: string;
  force?: boolean;
  codeChallenge?: string;
}): string {
  if (!state.clientId) {
    throw new HhApiError({
      status: 400,
      endpoint: "GET /oauth/authorize",
      message: "HH_CLIENT_ID is required",
    });
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: state.clientId,
    redirect_uri: state.redirectUri,
  });
  if (opts?.state) params.set("state", opts.state);
  if (opts?.force) params.set("force_login", "true");
  if (opts?.codeChallenge) {
    params.set("code_challenge", opts.codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  return `${state.authBase}/oauth/authorize?${params.toString()}`;
}
