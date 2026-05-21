import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const suggestsSchema = z.object({
  action: z
    .enum([
      "areas",
      "professional_roles",
      "positions",
      "companies",
      "organizations",
      "skill_set",
      "fields_of_study",
      "vacancy_search_keyword",
      "registered_companies",
      "areas_leaves",
      "educational_institutions",
    ])
    .describe("Suggest endpoint — авто-подсказки для подстановки в фильтры/формы."),
  text: z.string().describe("Поисковый текст (минимум 2 символа)"),
  area_id: z.string().optional().describe("ограничить область поиска (для positions, companies)"),
  locale: z.string().optional().describe("RU / EN / KZ"),
});

export type SuggestsInput = z.infer<typeof suggestsSchema>;

const SUGGEST_PATHS: Record<SuggestsInput["action"], string> = {
  areas: "/suggests/areas",
  professional_roles: "/suggests/professional_roles",
  positions: "/suggests/positions",
  companies: "/suggests/companies",
  organizations: "/suggests/organizations",
  skill_set: "/suggests/skill_set",
  fields_of_study: "/suggests/fields_of_study",
  vacancy_search_keyword: "/suggests/vacancy_search_keyword",
  registered_companies: "/suggests/registered_companies",
  areas_leaves: "/suggests/areas_leaves",
  educational_institutions: "/suggests/educational_institutions",
};

export async function suggestsTool(input: SuggestsInput): Promise<ToolContent> {
  try {
    if (!input.text || input.text.length < 1) return fail("text is required");
    const path = SUGGEST_PATHS[input.action];
    if (!path) return fail(`unknown action: ${input.action}`);
    const query: Record<string, unknown> = { text: input.text };
    if (input.area_id) query.area = input.area_id;
    if (input.locale) query.locale = input.locale;
    return ok(await hhRequest("GET", path, { query }));
  } catch (err) {
    return failFromError(err);
  }
}
