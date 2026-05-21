import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HhApiError } from "./errors.js";

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

const TOKENS_DIR = path.join(os.homedir(), ".hh-mcp");
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

export function initAuth(): void {
  state.authBase = (process.env.HH_AUTH_BASE ?? "https://hh.kz").replace(/\/+$/, "");
  state.apiBase = (process.env.HH_API_BASE ?? "https://api.hh.ru").replace(/\/+$/, "");
  state.userAgent = process.env.HH_USER_AGENT || "hh-mcp/0.1.1 (+https://github.com/mardanaltynbekov1104/hh-mcp)";
  state.clientId = process.env.HH_CLIENT_ID || null;
  state.clientSecret = process.env.HH_CLIENT_SECRET || null;
  state.redirectUri = process.env.HH_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob";

  // 1) tokens.json в приоритете (свежее, чем env)
  const fromDisk = loadTokensFromDisk();
  if (fromDisk) {
    state.accessToken = fromDisk.accessToken;
    state.refreshToken = fromDisk.refreshToken;
    state.expiresAt = fromDisk.expiresAt ?? null;
  }

  // 2) env как fallback
  if (!state.accessToken && process.env.HH_ACCESS_TOKEN) {
    state.accessToken = process.env.HH_ACCESS_TOKEN;
  }
  if (!state.refreshToken && process.env.HH_REFRESH_TOKEN) {
    state.refreshToken = process.env.HH_REFRESH_TOKEN;
  }

  const mode = state.accessToken ? "tokens" : state.clientId ? "oauth-ready" : "anonymous";
  console.error(
    `[AUTH] api=${state.apiBase} auth=${state.authBase} mode=${mode} client_id=${state.clientId ? "set" : "unset"}`
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
  expiresInSec?: number | null
): void {
  state.accessToken = accessToken;
  if (refreshToken !== undefined) state.refreshToken = refreshToken;
  state.expiresAt = expiresInSec ? Date.now() + expiresInSec * 1000 : null;
  persistTokens();
}

export function clearTokens(): void {
  state.accessToken = null;
  state.refreshToken = null;
  state.expiresAt = null;
  try {
    if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH);
  } catch (err) {
    console.error("[AUTH] failed to remove tokens.json:", (err as Error).message);
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

function persistTokens(): void {
  try {
    if (!fs.existsSync(TOKENS_DIR)) {
      fs.mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(
      TOKENS_PATH,
      JSON.stringify(
        {
          access_token: state.accessToken,
          refresh_token: state.refreshToken,
          expires_at: state.expiresAt,
          saved_at: Date.now(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch (err) {
    console.error("[AUTH] failed to persist tokens.json:", (err as Error).message);
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
  refreshPromise = (async () => {
    if (!state.refreshToken) {
      throw new HhApiError({
        status: 401,
        endpoint: "POST /oauth/token",
        message: "no refresh_token — run hh_auth action=get_auth_url and exchange_code first",
      });
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: state.refreshToken,
    });
    const res = await fetch(`${state.authBase}/oauth/token`, {
      method: "POST",
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
    setTokens(json.access_token, json.refresh_token ?? state.refreshToken, json.expires_in ?? null);
    console.error("[AUTH] refreshed access_token");
  })();
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * Exchange authorization_code for tokens.
 */
export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
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
  const res = await fetch(`${state.authBase}/oauth/token`, {
    method: "POST",
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
  setTokens(json.access_token, json.refresh_token, json.expires_in);
  return json;
}

/**
 * Build authorize URL for OAuth code flow.
 */
export function buildAuthorizeUrl(opts?: { state?: string; force?: boolean }): string {
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
  return `${state.authBase}/oauth/authorize?${params.toString()}`;
}
