import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, compact, fail, failFromError, type ToolContent } from "../lib/result.js";
import { formParams } from "../lib/form.js";
import { compactSearch, unpagedProfessionalResume } from "../resumes/presentation.js";
import type { ResumeDetails } from "../resumes/details.js";

export const employerResumesSchema = z.object({
  action: z
    .enum([
      // search & view
      "search",
      "get",
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
    ])
    .describe(
      "Employer resume search & sourcing. action=get — обычный просмотр без confirm и без открытия платных контактов. Доступ зависит от услуг HH."
    ),
  resume_id: z.string().optional(),
  cursor: z.string().regex(/^[a-f0-9-]{36}\.\d+$/).optional().describe("Для get: next_cursor из предыдущей части. Используй next как аргументы продолжения; не смешивай части разных чтений."),
  max_chars: z.number().int().min(1000).max(20000).optional().describe("Для первого get: размер части профессионального текста; по умолчанию 6000 символов (настраивается сервером). При продолжении не меняй размер."),
  applicant_id: z.string().optional().describe("id соискателя (для applicant_comments_*)"),
  comment_id: z.string().optional(),
  saved_search_id: z.string().optional(),
  manager_id: z.string().optional().describe("для saved_search_move_manager"),
  query: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Query params. Для saved_search_create/update — тот же набор фильтров что и для resumes search " +
        "(text, area, professional_role, salary_from, experience, education, age_from/to, gender, ...). " +
        'Для нескольких регионов или ролей передавай массив: area: ["1", "2019"]. ' +
        "Допустимые значения фильтров — action=available_resume_search_criteria."
    ),
  body: z.record(z.string(), z.unknown()).optional().describe("body для applicant_comment_add/update: text, access_type (тип доступа из applicant_comment_access_type в справочнике HH)"),
  confirm: z
    .boolean()
    .optional()
    .describe("Устаревшее поле совместимости: для обычного action=get не требуется и игнорируется."),
});

export type EmployerResumesInput = z.infer<typeof employerResumesSchema>;

/** Numeric IDs passed by agents as a CSV must be separate repeated query parameters. */
export function resumeQuery(query?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!query) return query;
  const result = { ...query };
  for (const key of ["area", "professional_role"]) {
    const value = result[key];
    if (typeof value === "string" && /^\s*\d+\s*(,\s*\d+\s*)+$/.test(value)) {
      result[key] = value.split(",").map((id) => id.trim());
    }
  }
  return result;
}

export async function employerResumesTool(input: EmployerResumesInput, details?: ResumeDetails): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "search":
        return compact(compactSearch(await hhRequest("GET", "/resumes", { query: resumeQuery(input.query) })));

      case "get": {
        if (!input.resume_id) return fail("resume_id is required");
        if (details) return compact(await details.get(input.resume_id, input.cursor, input.max_chars));
        if (input.cursor) return fail("Resume continuation service is not configured");
        // Plain resume view only. Never follow actions.get_with_contact or accept
        // caller-supplied contact-query parameters here.
        return compact(unpagedProfessionalResume(await hhRequest("GET", `/resumes/${encodeURIComponent(input.resume_id)}`)));
      }

      case "available_resume_search_criteria":
        return ok(await hhRequest("GET", "/dictionaries"));

      case "negotiations_history":
        if (!input.resume_id) return fail("resume_id is required");
        return ok(
          await hhRequest("GET", `/resumes/${encodeURIComponent(input.resume_id)}/negotiations_history`, {
            query: input.query,
          })
        );

      case "saved_searches_list":
        return ok(await hhRequest("GET", "/saved_searches/resumes", { query: input.query }));

      case "saved_search_get":
        if (!input.saved_search_id) return fail("saved_search_id is required");
        return ok(await hhRequest("GET", `/saved_searches/resumes/${encodeURIComponent(input.saved_search_id)}`));

      case "saved_search_create":
        // params go via query string, same шапка как у /resumes search
        return ok(await hhRequest("POST", "/saved_searches/resumes", { query: resumeQuery(input.query) }));

      case "saved_search_update":
        if (!input.saved_search_id) return fail("saved_search_id is required");
        return ok(
          await hhRequest("PUT", `/saved_searches/resumes/${encodeURIComponent(input.saved_search_id)}`, {
            query: resumeQuery(input.query),
          })
        );

      case "saved_search_delete":
        if (!input.saved_search_id) return fail("saved_search_id is required");
        return ok(
          (await hhRequest("DELETE", `/saved_searches/resumes/${encodeURIComponent(input.saved_search_id)}`)) ?? {
            deleted: true,
          }
        );

      case "saved_search_move_manager":
        if (!input.saved_search_id || !input.manager_id)
          return fail("saved_search_id and manager_id are required");
        return ok(
          await hhRequest(
            "PUT",
            `/saved_searches/resumes/${encodeURIComponent(input.saved_search_id)}/managers/${encodeURIComponent(input.manager_id)}`
          )
        );

      case "applicant_comments_list":
        if (!input.applicant_id) return fail("applicant_id is required");
        return ok(
          await hhRequest("GET", `/applicant_comments/${encodeURIComponent(input.applicant_id)}`, {
            query: input.query,
          })
        );

      case "applicant_comment_add":
        if (!input.applicant_id) return fail("applicant_id is required");
        if (!input.body?.text || !input.body.access_type) return fail("body.text and body.access_type are required");
        return ok(
          await hhRequest("POST", `/applicant_comments/${encodeURIComponent(input.applicant_id)}`, {
            form: formParams(input.body),
          })
        );

      case "applicant_comment_update":
        if (!input.applicant_id || !input.comment_id)
          return fail("applicant_id and comment_id are required");
        if (!input.body) return fail("body is required");
        return ok(
          await hhRequest(
            "PUT",
            `/applicant_comments/${encodeURIComponent(input.applicant_id)}/${encodeURIComponent(input.comment_id)}`,
            { form: formParams(input.body) }
          )
        );

      case "applicant_comment_delete":
        if (!input.applicant_id || !input.comment_id)
          return fail("applicant_id and comment_id are required");
        return ok(
          (await hhRequest(
            "DELETE",
            `/applicant_comments/${encodeURIComponent(input.applicant_id)}/${encodeURIComponent(input.comment_id)}`
          )) ?? { deleted: true }
        );

      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
