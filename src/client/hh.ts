import { HhApiError } from "../lib/errors.js";
import {
  getAccessToken,
  getApiBase,
  getUserAgent,
  hasRefreshToken,
  refreshAccessToken,
} from "../lib/auth.js";

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  /** When true, skip Authorization header (used by /oauth endpoints themselves). */
  skipAuth?: boolean;
  /** Force application/x-www-form-urlencoded with given body (Record or URLSearchParams). */
  form?: Record<string, string> | URLSearchParams;
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return "";
  const entries = Object.entries(query).flatMap(([k, v]) => {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v))
      return v.map((item) => [k, String(item)] as [string, string]);
    return [[k, String(v)] as [string, string]];
  });
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

async function doFetch(
  method: Method,
  path: string,
  opts: RequestOptions,
): Promise<Response> {
  const url = `${getApiBase()}${path}${buildQuery(opts.query)}`;
  const headers: Record<string, string> = {
    "User-Agent": getUserAgent(),
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };
  if (!opts.skipAuth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let body: BodyInit | undefined;
  if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body =
      opts.form instanceof URLSearchParams
        ? opts.form
        : new URLSearchParams(opts.form as Record<string, string>);
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetch(url, { method, headers, body });
}

/**
 * HH API request with auto-refresh on 401.
 *
 * HH endpoints almost all live under api.hh.ru and accept Bearer tokens.
 * On 401, attempt refresh once and retry. On second 401, surface error.
 */
export async function hhRequest<T = unknown>(
  method: Method,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const issuedToken = getAccessToken();
  let res = await doFetch(method, path, opts);
  const forbidden =
    res.status === 403
      ? ((await res
          .clone()
          .json()
          .catch(() => null)) as {
          errors?: Array<{ type?: string; value?: string }>;
        } | null)
      : null;
  const expired =
    res.status === 401 ||
    forbidden?.errors?.some(
      (error) => error.type === "oauth" && error.value === "token_expired",
    );
  if (expired && !opts.skipAuth && hasRefreshToken()) {
    try {
      if (issuedToken === getAccessToken()) await refreshAccessToken();
    } catch (err) {
      throw new HhApiError({
        status: 401,
        endpoint: `${method} ${path}`,
        message: `auth failed and refresh did not recover: ${(err as Error).message}`,
      });
    }
    res = await doFetch(method, path, opts);
  }

  if (!res.ok) {
    let bodyJson: unknown = undefined;
    const text = await res.text().catch(() => "");
    try {
      bodyJson = text ? JSON.parse(text) : text;
    } catch {
      bodyJson = text;
    }
    throw new HhApiError({
      status: res.status,
      endpoint: `${method} ${path}`,
      message: `${res.status} ${res.statusText}`,
      body: bodyJson,
    });
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}
