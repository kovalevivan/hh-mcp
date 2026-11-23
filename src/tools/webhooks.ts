import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const webhooksSchema = z.object({
  action: z
    .enum(["list", "subscribe", "update", "unsubscribe"])
    .describe(
      "Webhook subscriptions работодателя. Для приёма событий нужен публичный HTTPS-URL (например, ngrok / Railway / hiring-bot)."
    ),
  subscription_id: z.string().optional().describe("для update / unsubscribe"),
  body: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Subscribe payload: { url: "https://example.com/hh", actions: [{ type: "NEW_NEGOTIATION_VACANCY", settings: { vacancies: ["123"] } }] }. Для update можно передать только изменяемые поля; actions заменяет весь список.'
    ),
});

export type WebhooksInput = z.infer<typeof webhooksSchema>;

export async function webhooksTool(input: WebhooksInput): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "list":
        return ok(await hhRequest("GET", "/webhook/subscriptions"));
      case "subscribe":
        if (!input.body?.url || !Array.isArray(input.body.actions) || !input.body.actions.length)
          return fail("body.url and nonempty body.actions are required (HH webhook subscription)");
        return ok(await hhRequest("POST", "/webhook/subscriptions", { body: input.body }));
      case "update":
        if (!input.subscription_id) return fail("subscription_id is required");
        if (!input.body) return fail("body is required");
        return ok(
          await hhRequest("PUT", `/webhook/subscriptions/${encodeURIComponent(input.subscription_id)}`, {
            body: input.body,
          })
        );
      case "unsubscribe":
        if (!input.subscription_id) return fail("subscription_id is required");
        return ok(
          (await hhRequest("DELETE", `/webhook/subscriptions/${encodeURIComponent(input.subscription_id)}`)) ?? {
            unsubscribed: true,
          }
        );
      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
