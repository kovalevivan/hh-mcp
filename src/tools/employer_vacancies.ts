import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const employerVacanciesSchema = z.object({
  action: z
    .enum([
      "search",
      "get",
      "similar",
      "active_list",
      "archived_list",
      "hidden_list",
      "create",
      "update",
      "delete",
      "archive",
      "restore",
      "prolongate",
      "hide",
      "unhide",
      "drafts_list",
      "draft_get",
      "draft_create",
      "draft_update",
      "draft_delete",
      "draft_publish",
      "stats",
      "available_types",
      "available_types_for_employer",
      "visitors",
      "available_services",
      "upgrade_list",
      "related",
      "prolongation_info",
      "disable_auto_publication",
      "draft_duplicates",
    ])
    .describe("Employer vacancies actions"),
  vacancy_id: z.string().optional(),
  draft_id: z.string().optional(),
  employer_id: z.string().optional().describe("обычно подтягивается из /me, но можно задать вручную"),
  manager_id: z.string().optional(),
  query: z.record(z.unknown()).optional().describe("query params (text, area, per_page, page, ...)"),
  body: z.record(z.unknown()).optional().describe("vacancy/draft payload"),
});

export type EmployerVacanciesInput = z.infer<typeof employerVacanciesSchema>;

async function resolveEmployerAndManager(
  input: EmployerVacanciesInput
): Promise<{ employer_id: string; manager_id: string }> {
  if (input.employer_id && input.manager_id) {
    return { employer_id: input.employer_id, manager_id: input.manager_id };
  }
  const me = (await hhRequest("GET", "/me")) as {
    employer?: { id?: string };
    manager?: { id?: string };
  };
  const employer_id = input.employer_id ?? me.employer?.id;
  const manager_id = input.manager_id ?? me.manager?.id;
  if (!employer_id) throw new Error("employer_id not found — нужен авторизованный работодатель (hh_auth action=me)");
  if (!manager_id) throw new Error("manager_id not found — текущая сессия не привязана к менеджеру");
  return { employer_id, manager_id };
}

export async function employerVacanciesTool(input: EmployerVacanciesInput): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "search":
        return ok(await hhRequest("GET", "/vacancies", { query: input.query }));
      case "get": {
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(await hhRequest("GET", `/vacancies/${input.vacancy_id}`));
      }
      case "similar": {
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(
          await hhRequest("GET", `/vacancies/${input.vacancy_id}/similar_vacancies`, {
            query: input.query,
          })
        );
      }
      case "active_list": {
        const { employer_id, manager_id } = await resolveEmployerAndManager(input);
        return ok(
          await hhRequest(
            "GET",
            `/employers/${employer_id}/managers/${manager_id}/vacancies/active`,
            { query: input.query }
          )
        );
      }
      case "archived_list": {
        const { employer_id, manager_id } = await resolveEmployerAndManager(input);
        return ok(
          await hhRequest(
            "GET",
            `/employers/${employer_id}/managers/${manager_id}/vacancies/archived`,
            { query: input.query }
          )
        );
      }
      case "hidden_list": {
        const { employer_id, manager_id } = await resolveEmployerAndManager(input);
        return ok(
          await hhRequest(
            "GET",
            `/employers/${employer_id}/managers/${manager_id}/vacancies/hidden`,
            { query: input.query }
          )
        );
      }
      case "create":
        if (!input.body) return fail("body is required (vacancy payload)");
        return ok(await hhRequest("POST", "/vacancies", { body: input.body }));
      case "update":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        if (!input.body) return fail("body is required");
        return ok(await hhRequest("PUT", `/vacancies/${input.vacancy_id}`, { body: input.body }));
      case "delete":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok((await hhRequest("DELETE", `/vacancies/${input.vacancy_id}`)) ?? { deleted: true });
      case "archive":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(
          (await hhRequest("PUT", `/vacancies/${input.vacancy_id}/archive`)) ?? { archived: true }
        );
      case "restore":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(
          (await hhRequest("POST", `/vacancies/archived/${input.vacancy_id}/restore`)) ?? {
            restored: true,
          }
        );
      case "prolongate":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(
          (await hhRequest("POST", `/vacancies/${input.vacancy_id}/prolongate`)) ?? {
            prolongated: true,
          }
        );
      case "hide":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(
          (await hhRequest("PUT", `/vacancies/${input.vacancy_id}/hidden`)) ?? { hidden: true }
        );
      case "unhide":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(
          (await hhRequest("DELETE", `/vacancies/${input.vacancy_id}/hidden`)) ?? {
            unhidden: true,
          }
        );
      case "drafts_list":
        return ok(await hhRequest("GET", "/vacancies/drafts", { query: input.query }));
      case "draft_get":
        if (!input.draft_id) return fail("draft_id is required");
        return ok(await hhRequest("GET", `/vacancies/drafts/${input.draft_id}`));
      case "draft_create":
        if (!input.body) return fail("body is required (draft payload)");
        return ok(await hhRequest("POST", "/vacancies/drafts", { body: input.body }));
      case "draft_update":
        if (!input.draft_id) return fail("draft_id is required");
        if (!input.body) return fail("body is required");
        return ok(
          await hhRequest("PUT", `/vacancies/drafts/${input.draft_id}`, { body: input.body })
        );
      case "draft_delete":
        if (!input.draft_id) return fail("draft_id is required");
        return ok(
          (await hhRequest("DELETE", `/vacancies/drafts/${input.draft_id}`)) ?? { deleted: true }
        );
      case "draft_publish":
        if (!input.draft_id) return fail("draft_id is required");
        return ok(
          await hhRequest("POST", `/vacancies/drafts/${input.draft_id}/publish`, {
            body: input.body ?? {},
          })
        );
      case "stats":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(await hhRequest("GET", `/vacancies/${input.vacancy_id}/stats`));
      case "available_types":
        return ok(await hhRequest("GET", "/vacancy_conditions"));
      case "available_types_for_employer": {
        const employer_id = input.employer_id;
        if (!employer_id) return fail("employer_id is required");
        return ok(await hhRequest("GET", `/vacancies/available_types/${employer_id}`));
      }
      case "visitors":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(
          await hhRequest("GET", `/vacancies/${input.vacancy_id}/visitors`, { query: input.query })
        );
      case "available_services":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(await hhRequest("GET", `/vacancies/${input.vacancy_id}/available_services`));
      case "upgrade_list":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(await hhRequest("GET", `/vacancies/${input.vacancy_id}/upgrades`));
      case "related":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(
          await hhRequest("GET", `/vacancies/${input.vacancy_id}/related_vacancies`, {
            query: input.query,
          })
        );
      case "prolongation_info":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(await hhRequest("GET", `/vacancies/${input.vacancy_id}/prolongate`));
      case "disable_auto_publication":
        if (!input.vacancy_id) return fail("vacancy_id is required");
        return ok(
          (await hhRequest("DELETE", `/vacancies/auto_publication/${input.vacancy_id}`)) ?? {
            disabled: true,
          }
        );
      case "draft_duplicates":
        if (!input.body && !input.query) return fail("query or body with draft fields is required");
        return ok(
          await hhRequest("POST", "/vacancies/drafts/duplicates", {
            body: input.body,
            query: input.query,
          })
        );
      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
