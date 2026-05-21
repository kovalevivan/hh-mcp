import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const employerResumesSchema = z.object({
  action: z
    .enum([
      "search",
      "get",
      "views_list",
      "mine_invitations",
      "saved_searches_list",
      "saved_search_get",
      "saved_search_delete",
      "available_resume_search_criteria",
    ])
    .describe(
      "Employer resume search. ВНИМАНИЕ: action=get тратит контакт работодателя — используется только с confirm=true."
    ),
  resume_id: z.string().optional(),
  saved_search_id: z.string().optional(),
  query: z.record(z.unknown()).optional().describe("query (text, area, professional_role, salary_from, ...)"),
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Явное подтверждение для платных действий. action=get не будет выполнен без confirm=true."
    ),
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
      case "mine_invitations":
        return ok(await hhRequest("GET", "/resumes/mine/invitations", { query: input.query }));
      case "saved_searches_list":
        return ok(await hhRequest("GET", "/saved_searches/resumes", { query: input.query }));
      case "saved_search_get":
        if (!input.saved_search_id) return fail("saved_search_id is required");
        return ok(await hhRequest("GET", `/saved_searches/resumes/${input.saved_search_id}`));
      case "saved_search_delete":
        if (!input.saved_search_id) return fail("saved_search_id is required");
        return ok(
          (await hhRequest("DELETE", `/saved_searches/resumes/${input.saved_search_id}`)) ?? {
            deleted: true,
          }
        );
      case "available_resume_search_criteria":
        return ok(await hhRequest("GET", "/resumes/dictionary"));
      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
