import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";
import { getCurrentEmployerId } from "./_helpers.js";
import { formParams } from "../lib/form.js";

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
      "mark_read",
      // messages (старый API, deprecated)
      "messages_list",
      "message_send",
      // state transitions
      "move_to_collection",
      "change_action",
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
  template: z.string().optional().describe("ключ шаблона. templates_list/message_template_get требуют topic_id либо пару vacancy_id+resume_id (не одновременно). mail_template_update — ключ шаблона компании."),
  send_sms: z.boolean().optional().describe("отправить SMS соискателю при invite"),
  employer_id: z.string().optional().describe("employer id (для mail_templates_*; иначе берётся из /me)"),
  manager_id: z.string().optional().describe("для statistics_manager"),
  topic_ids: z.array(z.string()).max(50).optional().describe("для mark_read / move_to_collection — список topic_id"),
  query: z.record(z.string(), z.unknown()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
});

export type EmployerNegotiationsInput = z.infer<typeof employerNegotiationsSchema>;

function vacancyId(input: EmployerNegotiationsInput): string | undefined {
  const id = input.vacancy_id ?? input.query?.vacancy_id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function topicIds(input: EmployerNegotiationsInput): string[] {
  const ids = input.topic_ids ?? (input.topic_id ? [input.topic_id] :
    input.body?.topic_ids ?? input.body?.topic_id ?? []);
  const values = Array.isArray(ids) ? ids : [ids];
  if (values.length > 50 || values.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("topic_ids must contain 1–50 nonempty strings");
  }
  return values as string[];
}

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
        if (!vacancyId(input)) return fail("vacancy_id is required for employer negotiations");
        return ok(
          await hhRequest("GET", "/negotiations", {
            query: { ...input.query, vacancy_id: vacancyId(input) },
          })
        );

      case "list": {
        if (!vacancyId(input)) return fail("vacancy_id is required for employer negotiations");
        const query: Record<string, unknown> = { ...input.query };
        query.vacancy_id = vacancyId(input);
        const path = input.collection ? `/negotiations/${encodeURIComponent(input.collection)}` : "/negotiations";
        return ok(await hhRequest("GET", path, { query }));
      }

      case "get":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(await hhRequest("GET", `/negotiations/${encodeURIComponent(input.topic_id)}`));

      case "active_topics":
        if (!vacancyId(input)) return fail("vacancy_id is required for employer negotiations");
        return ok(await hhRequest("GET", "/negotiations", {
          query: { ...input.query, vacancy_id: vacancyId(input), status: "active" },
        }));

      case "mark_read": {
        const ids = topicIds(input);
        if (ids.length === 0) return fail("topic_id or topic_ids is required");
        return ok(
          await hhRequest("POST", "/negotiations/read", {
            form: formParams({ topic_id: ids }),
          })
        );
      }

      case "messages_list":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(
          await hhRequest("GET", `/negotiations/${encodeURIComponent(input.topic_id)}/messages`, {
            query: input.query,
          })
        );

      case "message_send":
        if (!input.topic_id) return fail("topic_id is required");
        if (!(input.body?.message ?? input.message)) return fail("message or body.message is required");
        return ok(
          await hhRequest("POST", `/negotiations/${encodeURIComponent(input.topic_id)}/messages`, {
            form: formParams({ ...input.body, message: input.body?.message ?? input.message }),
          })
        );

      case "move_to_collection": {
        if (!input.collection) return fail("collection is required");
        const ids = topicIds(input);
        if (!ids.length) return fail("topic_id or topic_ids is required");
        const { topic_ids: _legacyIds, topic_id: _ids, ...fields } = input.body ?? {};
        return ok(
          await hhRequest("PUT", `/negotiations/${encodeURIComponent(input.collection)}`, {
            form: formParams({ ...fields, topic_id: ids }),
          })
        );
      }

      case "change_action": {
        if (!input.topic_id) return fail("topic_id is required");
        if (!input.action_id) return fail("action_id is required (см. available_actions в negotiation item)");
        return ok(
          await hhRequest("PUT", `/negotiations/${encodeURIComponent(input.action_id)}/${encodeURIComponent(input.topic_id)}`, {
            body: input.body,
          })
        );
      }

      case "candidate_test_solution":
      case "test_results":
        if (!input.topic_id) return fail("topic_id is required");
        return ok(await hhRequest("GET", `/negotiations/${encodeURIComponent(input.topic_id)}/test/solution`));

      case "templates_list":
      case "message_template_get": {
        if (!input.template) return fail("template is required");
        const query = { ...input.query };
        if (input.topic_id) query.topic_id = input.topic_id;
        if (input.vacancy_id) query.vacancy_id = input.vacancy_id;
        if (input.resume_id) query.resume_id = input.resume_id;
        if (query.topic_id && (query.vacancy_id || query.resume_id)) {
          return fail("For a message template use topic_id OR vacancy_id+resume_id, not both");
        }
        if (!query.topic_id && !(query.vacancy_id && query.resume_id)) {
          return fail("topic_id or vacancy_id+resume_id is required for a message template");
        }
        return ok(await hhRequest("GET", `/message_templates/${encodeURIComponent(input.template)}`, { query }));
      }

      case "mail_templates_list": {
        const employer_id = input.employer_id ?? (await getCurrentEmployerId());
        return ok(await hhRequest("GET", `/employers/${encodeURIComponent(employer_id)}/mail_templates`));
      }

      case "mail_template_update": {
        if (!input.template) return fail("template is required");
        if (!input.body) return fail("body is required");
        const employer_id = input.employer_id ?? (await getCurrentEmployerId());
        return ok(
          await hhRequest("PUT", `/employers/${encodeURIComponent(employer_id)}/mail_templates/${encodeURIComponent(input.template)}`, {
            body: input.body,
          })
        );
      }

      case "preference_order_get":
        if (!vacancyId(input)) return fail("vacancy_id is required");
        return ok(await hhRequest("GET", `/vacancies/${vacancyId(input)}/preferred_negotiations_order`));

      case "preference_order_set":
        if (!vacancyId(input)) return fail("vacancy_id is required");
        if (!input.body?.order) return fail("body.order is required");
        return ok(
          await hhRequest("PUT", `/vacancies/${vacancyId(input)}/preferred_negotiations_order`, {
            form: formParams({ order: input.body.order }),
          })
        );

      case "statistics":
        if (input.vacancy_id) return ok(await hhRequest("GET", `/vacancies/${encodeURIComponent(input.vacancy_id)}/stats`));
        return ok(await hhRequest("GET", `/employers/${input.employer_id ?? await getCurrentEmployerId()}/negotiations_statistics`));

      case "statistics_manager": {
        if (!input.manager_id) return fail("manager_id is required");
        const employer_id = input.employer_id ?? (await getCurrentEmployerId());
        return ok(
          await hhRequest(
            "GET",
            `/employers/${encodeURIComponent(employer_id)}/managers/${encodeURIComponent(input.manager_id)}/negotiations_statistics`,
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
