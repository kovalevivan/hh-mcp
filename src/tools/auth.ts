import { z } from "zod";
import {
  buildAuthorizeUrl,
  clearTokens,
  exchangeCode,
  getAccessToken,
  getRedirectUri,
  hasRefreshToken,
  refreshAccessToken,
  setTokens,
  isAdminManaged,
} from "../lib/auth.js";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const authSchema = z.object({
  action: z
    .enum([
      "get_auth_url",
      "exchange_code",
      "refresh",
      "me",
      "set_tokens",
      "logout",
      "status",
    ])
    .describe("OAuth action"),
  code: z
    .string()
    .optional()
    .describe("authorization code from /oauth callback (for exchange_code)"),
  state: z.string().optional().describe("optional CSRF state for get_auth_url"),
  force_login: z
    .boolean()
    .optional()
    .describe("force re-login on hh side (get_auth_url)"),
  access_token: z
    .string()
    .optional()
    .describe("manually set access token (set_tokens)"),
  refresh_token: z
    .string()
    .optional()
    .describe("manually set refresh token (set_tokens)"),
  expires_in: z.number().optional().describe("expires_in seconds (set_tokens)"),
});

export type AuthInput = z.infer<typeof authSchema>;
export const managedAuthSchema = authSchema.extend({
  action: z.enum(["status", "me"]),
});

export async function authTool(input: AuthInput): Promise<ToolContent> {
  if (isAdminManaged() && input.action !== "status" && input.action !== "me") {
    return fail(
      "Manage this shared HeadHunter account in LibreChat administration",
    );
  }
  try {
    switch (input.action) {
      case "status":
        return ok({
          has_access_token: !!getAccessToken(),
          has_refresh_token: hasRefreshToken(),
          redirect_uri: getRedirectUri(),
        });
      case "get_auth_url": {
        const url = buildAuthorizeUrl({
          state: input.state,
          force: input.force_login,
        });
        return ok(
          {
            url,
            redirect_uri: getRedirectUri(),
            instructions:
              "Открой URL в браузере, авторизуйся под нужным аккаунтом hh.kz/hh.ru. " +
              "После редиректа скопируй параметр `code` из адресной строки и вызови " +
              "hh_auth action=exchange_code code=<значение>.",
          },
          "Authorize URL",
        );
      }
      case "exchange_code": {
        if (!input.code) return fail("code is required");
        const tokens = await exchangeCode(input.code);
        return ok({
          access_token_preview: tokens.access_token.slice(0, 12) + "…",
          refresh_token_preview: tokens.refresh_token.slice(0, 12) + "…",
          expires_in: tokens.expires_in,
          persisted: "~/.hh-mcp/tokens.json",
        });
      }
      case "refresh":
        await refreshAccessToken();
        return ok({ refreshed: true });
      case "set_tokens":
        if (!input.access_token) return fail("access_token is required");
        setTokens(
          input.access_token,
          input.refresh_token ?? null,
          input.expires_in ?? null,
        );
        return ok({ set: true });
      case "logout":
        clearTokens();
        return ok({ cleared: true });
      case "me":
        return ok(await hhRequest("GET", "/me"));
      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
