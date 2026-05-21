import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";
import { getCurrentEmployerId } from "./_helpers.js";

export const employerNegotiationsSchema = z.object({
  action: z
    .enum([
      // sourcing / invite
      "invite",
      // listing & read
      "collections",
      "list",
      "get",
      "active_topics",
      "ignore_list",
      "mark_read",
      // messages (старый API, deprecated)
      "messages_list",
      "message_send",
      "history",
      // state transitions
      "move_to_collection",
      "change_action",
      "view",
      // tests
      "candidate_test_solution",
      "test_results",
      // templates
      "templates_list",
      "message_template_get",
      "mail_templates_list",
      "mail_template_update",
      // settings & analytics
      "preference_order_get",
      "preference_order_set",
      "statistics",
      "statistics_manager",
    ])
    .describe("Employer negotiations (отклики/приглашения) actions"),
  topic_id: z.string().optional().describe("negotiation id"),
  vacancy_id: z.string().optional().describe("ограничить отклики по вакансии"),
  resume_id: z.string().optional().describe("для invite — кого приглашаем"),
  collection: z
    .string()
    .optional()
    .describe(
      "Имя коллекции (response, invitation, consider, hired, discard, phone_interview, interview, assessment, offer, …)"
    ),
  action_id: z
    .string()
    .optional()
    .describe("id action из get-negotiation-item для change_action (см. поле available_actions)"),
  message: z.string().optional().describe("текст сообщения / приглашения"),
  template: z.string().optional().describe("ключ шаблона для message_template_get / mail_template_update"),
  send_sms: z.boolean().optional().describe("отправить SMS соискателю при invite"),
  employer_id: z.string().optional().describe("employer id (для mail_templates_*; иначе берётся из /me)"),
  manager_id: z.string().optional().describe("для statistics_manager"),
  topic_ids: z.array(z.string()).optional().describe("для mark_read — список topic_id"),
  query: z.record(z.unknown()).optional(),
  body: z.record(z.unknown()).optional(),
});

export type EmployerNegotiationsInput = z.infer<typeof employerNegotiationsSchema>;

export async function employerNegotiationsTool(
  input: EmployerNegotiationsInput
): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "invite": {
        if (!input.resume_id || !input.vacancy_id)
          return fail("resume_id and vacancy_id are required for invite");
        const form: Record<string, string> = {
          resume_id: input.resume_id,
          vacancy_id: input.vacancy_id,
        };
        if (input.message) form.message = input.message;
        if (input.send_sms !== undefined) form.send_sms = input.send_sms ? "true" : "false";
        return ok(await hhRequest("POST", "/negotiations/phone_interview", { form }));
      }

      case "collections":
        return ok(
          await hhRequest("GET", "/negotiations", {
            query: { ...input.query, only_collection_info: "true" },
          })
        );

      case "list": {
        const query: Record<string, unknown> = { ...input.query };
        if (input.vacancy_id) query.vacancy_id = input.vacancy_id;
        const path = input.collection ? `/negotiations/${input.collection}` : "/negotiations";
        return ok(await hhRequest("GET", path, { query }));
      }

      case "get":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(await hhRequest("GET", `/negotiations/${input.topic_id}`));

      case "active_topics":
        return ok(await hhRequest("GET", "/negotiations/active_topics", { query: input.query }));

      case "ignore_list":
        return ok(await hhRequest("GET", "/negotiations/ignored", { query: input.query }));

      case "mark_read": {
        const ids = input.topic_ids ?? (input.topic_id ? [input.topic_id] : []);
        if (ids.length === 0) return fail("topic_id or topic_ids is required");
        return ok(
          await hhRequest("POST", "/negotiations/read", {
            body: input.body ?? { topic_ids: ids },
          })
        );
      }

      case "messages_list":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(
          await hhRequest("GET", `/negotiations/${input.topic_id}/messages`, {
            query: input.query,
          })
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
        if (!input.collection) return fail("collection is required");
        if (!input.topic_id && !(input.body && (input.body as { topic_ids?: unknown }).topic_ids))
          return fail("topic_id or body.topic_ids is required");
        return ok(
          await hhRequest("PUT", `/negotiations/${input.collection}`, {
            body: input.body ?? { topic_ids: [input.topic_id] },
          })
        );

      case "change_action": {
        if (!input.topic_id) return fail("topic_id is required");
        if (!input.action_id) return fail("action_id is required (см. available_actions в negotiation item)");
        return ok(
          await hhRequest("PUT", `/negotiations/${input.topic_id}/${input.action_id}`, {
            body: input.body,
          })
        );
      }

      case "view":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(
          (await hhRequest("POST", `/negotiations/${input.topic_id}/view`)) ?? { viewed: true }
        );

      case "candidate_test_solution":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(await hhRequest("GET", `/negotiations/${input.topic_id}/test_solution`));

      case "test_results":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(await hhRequest("GET", `/negotiations/${input.topic_id}/test/solution`));

      case "templates_list":
        return ok(await hhRequest("GET", "/message_templates", { query: input.query }));

      case "message_template_get":
        if (!input.template) return fail("template is required");
        return ok(await hhRequest("GET", `/message_templates/${input.template}`));

      case "mail_templates_list": {
        const employer_id = input.employer_id ?? (await getCurrentEmployerId());
        return ok(await hhRequest("GET", `/employers/${employer_id}/mail_templates`));
      }

      case "mail_template_update": {
        if (!input.template) return fail("template is required");
        const employer_id = input.employer_id ?? (await getCurrentEmployerId());
        return ok(
          await hhRequest("PUT", `/employers/${employer_id}/mail_templates/${input.template}`, {
            body: input.body,
          })
        );
      }

      case "preference_order_get":
        return ok(await hhRequest("GET", "/negotiations/preferred_order"));

      case "preference_order_set":
        return ok(
          await hhRequest("PUT", "/negotiations/preferred_order", { body: input.body ?? {} })
        );

      case "statistics":
        if (!input.vacancy_id) return fail("vacancy_id is required for statistics");
        return ok(await hhRequest("GET", `/negotiations/vacancy/${input.vacancy_id}/statistics`));

      case "statistics_manager": {
        if (!input.manager_id) return fail("manager_id is required");
        const employer_id = input.employer_id ?? (await getCurrentEmployerId());
        return ok(
          await hhRequest(
            "GET",
            `/employers/${employer_id}/managers/${input.manager_id}/method_access`,
            { query: input.query }
          )
        );
      }

      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
