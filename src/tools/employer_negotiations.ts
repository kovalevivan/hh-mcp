import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const employerNegotiationsSchema = z.object({
  action: z
    .enum([
      "collections",
      "list",
      "get",
      "messages_list",
      "message_send",
      "history",
      "move_to_collection",
      "view",
      "templates_list",
      "statistics",
      "active_topics",
      "ignore_list",
      "candidate_test_solution",
    ])
    .describe("Employer negotiations (отклики/приглашения) actions"),
  topic_id: z.string().optional().describe("negotiation id"),
  vacancy_id: z.string().optional().describe("ограничить отклики по вакансии"),
  collection: z
    .string()
    .optional()
    .describe(
      "Имя коллекции для list/move_to_collection (response, invitation, consider, hired, discard, phone_interview, …)"
    ),
  message: z.string().optional().describe("текст сообщения для message_send"),
  query: z.record(z.unknown()).optional(),
  body: z.record(z.unknown()).optional(),
});

export type EmployerNegotiationsInput = z.infer<typeof employerNegotiationsSchema>;

export async function employerNegotiationsTool(
  input: EmployerNegotiationsInput
): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "collections":
        return ok(
          await hhRequest("GET", "/negotiations", {
            query: { ...input.query, only_collection_info: "true" },
          })
        );
      case "list": {
        const query: Record<string, unknown> = { ...input.query };
        if (input.vacancy_id) query.vacancy_id = input.vacancy_id;
        if (input.collection) query.status = input.collection;
        const path = input.collection ? `/negotiations/${input.collection}` : "/negotiations";
        return ok(await hhRequest("GET", path, { query }));
      }
      case "get":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(await hhRequest("GET", `/negotiations/${input.topic_id}`));
      case "messages_list":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(
          await hhRequest("GET", `/negotiations/${input.topic_id}/messages`, { query: input.query })
        );
      case "message_send":
        if (!input.topic_id) return fail("topic_id is required");
        if (!input.message && !input.body) return fail("message or body is required");
        return ok(
          await hhRequest("POST", `/negotiations/${input.topic_id}/messages`, {
            body: input.body ?? { message: input.message },
          })
        );
      case "history":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(await hhRequest("GET", `/negotiations/${input.topic_id}/history`));
      case "move_to_collection":
        if (!input.topic_id) return fail("topic_id is required");
        if (!input.collection) return fail("collection is required");
        return ok(
          await hhRequest("PUT", `/negotiations/${input.collection}`, {
            body: input.body ?? { topic_ids: [input.topic_id] },
          })
        );
      case "view":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(
          (await hhRequest("POST", `/negotiations/${input.topic_id}/view`)) ?? { viewed: true }
        );
      case "templates_list":
        return ok(await hhRequest("GET", "/message_templates", { query: input.query }));
      case "statistics":
        if (!input.vacancy_id) return fail("vacancy_id is required for statistics");
        return ok(
          await hhRequest("GET", `/negotiations/vacancy/${input.vacancy_id}/statistics`)
        );
      case "active_topics":
        return ok(
          await hhRequest("GET", "/negotiations/active_topics", { query: input.query })
        );
      case "ignore_list":
        return ok(await hhRequest("GET", "/negotiations/ignored", { query: input.query }));
      case "candidate_test_solution":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(
          await hhRequest("GET", `/negotiations/${input.topic_id}/test_solution`)
        );
      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
