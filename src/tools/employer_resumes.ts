import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const employerResumesSchema = z.object({
  action: z
    .enum([
      // search & view
      "search",
      "get",
      "views_list",
      "available_resume_search_criteria",
      // resume → negotiations history
      "negotiations_history",
      // saved searches
      "saved_searches_list",
      "saved_search_get",
      "saved_search_create",
      "saved_search_update",
      "saved_search_delete",
      "saved_search_move_manager",
      // applicant comments (заметки команды о кандидате)
      "applicant_comments_list",
      "applicant_comment_add",
      "applicant_comment_update",
      "applicant_comment_delete",
      // misc
      "mine_invitations",
    ])
    .describe(
      "Employer resume search & sourcing. ВНИМАНИЕ: action=get тратит контакт работодателя — используется только с confirm=true."
    ),
  resume_id: z.string().optional(),
  applicant_id: z.string().optional().describe("id соискателя (для applicant_comments_*)"),
  comment_id: z.string().optional(),
  saved_search_id: z.string().optional(),
  manager_id: z.string().optional().describe("для saved_search_move_manager"),
  query: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Query params. Для saved_search_create/update — тот же набор фильтров что и для resumes search " +
        "(text, area, professional_role, salary_from, experience, education, age_from/to, gender, ...)"
    ),
  body: z.record(z.string(), z.unknown()).optional().describe("body для applicant_comment_add/update"),
  confirm: z
    .boolean()
    .optional()
    .describe("Явное подтверждение для платных действий (action=get)."),
});

export type EmployerResumesInput = z.infer<typeof employerResumesSchema>;

export async function employerResumesTool(input: EmployerResumesInput): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "search":
        return ok(await hhRequest("GET", "/resumes", { query: input.query }));

      case "get": {
        if (!input.resume_id) return fail("resume_id is required");
        if (!input.confirm) {
          return fail(
            "action=get тратит контакт работодателя (платная операция). " +
              "Передай confirm: true если действительно хочешь открыть резюме."
          );
        }
        return ok(await hhRequest("GET", `/resumes/${input.resume_id}`));
      }

      case "views_list":
        if (!input.resume_id) return fail("resume_id is required");
        return ok(
          await hhRequest("GET", `/resumes/${input.resume_id}/views`, { query: input.query })
        );

      case "available_resume_search_criteria":
        return ok(await hhRequest("GET", "/resumes/dictionary"));

      case "negotiations_history":
        if (!input.resume_id) return fail("resume_id is required");
        return ok(
          await hhRequest("GET", `/resumes/${input.resume_id}/negotiations_history`, {
            query: input.query,
          })
        );

      case "saved_searches_list":
        return ok(await hhRequest("GET", "/saved_searches/resumes", { query: input.query }));

      case "saved_search_get":
        if (!input.saved_search_id) return fail("saved_search_id is required");
        return ok(await hhRequest("GET", `/saved_searches/resumes/${input.saved_search_id}`));

      case "saved_search_create":
        // params go via query string, same шапка как у /resumes search
        return ok(await hhRequest("POST", "/saved_searches/resumes", { query: input.query }));

      case "saved_search_update":
        if (!input.saved_search_id) return fail("saved_search_id is required");
        return ok(
          await hhRequest("PUT", `/saved_searches/resumes/${input.saved_search_id}`, {
            query: input.query,
          })
        );

      case "saved_search_delete":
        if (!input.saved_search_id) return fail("saved_search_id is required");
        return ok(
          (await hhRequest("DELETE", `/saved_searches/resumes/${input.saved_search_id}`)) ?? {
            deleted: true,
          }
        );

      case "saved_search_move_manager":
        if (!input.saved_search_id || !input.manager_id)
          return fail("saved_search_id and manager_id are required");
        return ok(
          await hhRequest(
            "PUT",
            `/saved_searches/resumes/${input.saved_search_id}/managers/${input.manager_id}`
          )
        );

      case "applicant_comments_list":
        if (!input.applicant_id) return fail("applicant_id is required");
        return ok(
          await hhRequest("GET", `/applicant_comments/${input.applicant_id}`, {
            query: input.query,
          })
        );

      case "applicant_comment_add":
        if (!input.applicant_id) return fail("applicant_id is required");
        if (!input.body) return fail("body is required (e.g. { text: '…' })");
        return ok(
          await hhRequest("POST", `/applicant_comments/${input.applicant_id}`, {
            body: input.body,
          })
        );

      case "applicant_comment_update":
        if (!input.applicant_id || !input.comment_id)
          return fail("applicant_id and comment_id are required");
        if (!input.body) return fail("body is required");
        return ok(
          await hhRequest(
            "PUT",
            `/applicant_comments/${input.applicant_id}/${input.comment_id}`,
            { body: input.body }
          )
        );

      case "applicant_comment_delete":
        if (!input.applicant_id || !input.comment_id)
          return fail("applicant_id and comment_id are required");
        return ok(
          (await hhRequest(
            "DELETE",
            `/applicant_comments/${input.applicant_id}/${input.comment_id}`
          )) ?? { deleted: true }
        );

      case "mine_invitations":
        return ok(await hhRequest("GET", "/resumes/mine/invitations", { query: input.query }));

      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
