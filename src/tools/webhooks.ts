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
      "Subscribe payload: { webhook_event: 'NEW_NEGOTIATION'|'NEGOTIATION_FEEDBACK'|…, url, employer_id?, vacancy_id?, secret_key }"
    ),
});

export type WebhooksInput = z.infer<typeof webhooksSchema>;

export async function webhooksTool(input: WebhooksInput): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "list":
        return ok(await hhRequest("GET", "/webhook/subscriptions"));
      case "subscribe":
        if (!input.body) return fail("body is required (webhook_event + url + secret_key)");
        return ok(await hhRequest("POST", "/webhook/subscriptions", { body: input.body }));
      case "update":
        if (!input.subscription_id) return fail("subscription_id is required");
        if (!input.body) return fail("body is required");
        return ok(
          await hhRequest("PUT", `/webhook/subscriptions/${input.subscription_id}`, {
            body: input.body,
          })
        );
      case "unsubscribe":
        if (!input.subscription_id) return fail("subscription_id is required");
        return ok(
          (await hhRequest("DELETE", `/webhook/subscriptions/${input.subscription_id}`)) ?? {
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
