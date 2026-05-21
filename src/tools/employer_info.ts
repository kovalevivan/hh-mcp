import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const employerInfoSchema = z.object({
  action: z
    .enum([
      "me",
      "get",
      "search",
      "managers_list",
      "manager_get",
      "manager_types",
      "addresses_list",
      "address_get",
      "departments_list",
      "vacancy_areas",
      "vacancy_branded_templates",
      "blacklisted",
    ])
    .describe("Employer info actions"),
  employer_id: z.string().optional().describe("for action=get / managers_list / addresses_list etc."),
  manager_id: z.string().optional().describe("for action=manager_get"),
  address_id: z.string().optional().describe("for action=address_get"),
  query: z.record(z.unknown()).optional().describe("optional query params"),
});

export type EmployerInfoInput = z.infer<typeof employerInfoSchema>;

export async function employerInfoTool(input: EmployerInfoInput): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "me":
        return ok(await hhRequest("GET", "/me"));
      case "get":
        if (!input.employer_id) return fail("employer_id is required");
        return ok(await hhRequest("GET", `/employers/${input.employer_id}`));
      case "search":
        return ok(await hhRequest("GET", "/employers", { query: input.query }));
      case "managers_list":
        if (!input.employer_id) return fail("employer_id is required");
        return ok(await hhRequest("GET", `/employers/${input.employer_id}/managers`, { query: input.query }));
      case "manager_get":
        if (!input.employer_id || !input.manager_id) return fail("employer_id and manager_id are required");
        return ok(
          await hhRequest("GET", `/employers/${input.employer_id}/managers/${input.manager_id}`)
        );
      case "manager_types":
        if (!input.employer_id) return fail("employer_id is required");
        return ok(await hhRequest("GET", `/employers/${input.employer_id}/manager_types`));
      case "addresses_list":
        if (!input.employer_id) return fail("employer_id is required");
        return ok(
          await hhRequest("GET", `/employers/${input.employer_id}/addresses`, { query: input.query })
        );
      case "address_get":
        if (!input.employer_id || !input.address_id) return fail("employer_id and address_id are required");
        return ok(
          await hhRequest("GET", `/employers/${input.employer_id}/addresses/${input.address_id}`)
        );
      case "departments_list":
        if (!input.employer_id) return fail("employer_id is required");
        return ok(await hhRequest("GET", `/employers/${input.employer_id}/departments`));
      case "vacancy_areas":
        if (!input.employer_id) return fail("employer_id is required");
        return ok(await hhRequest("GET", `/employers/${input.employer_id}/vacancy_areas/active`));
      case "vacancy_branded_templates":
        if (!input.employer_id) return fail("employer_id is required");
        return ok(
          await hhRequest("GET", `/employers/${input.employer_id}/vacancy_branded_templates`)
        );
      case "blacklisted":
        return ok(await hhRequest("GET", "/employers/blacklisted", { query: input.query }));
      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
