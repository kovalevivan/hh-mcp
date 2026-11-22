import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const dictionariesSchema = z.object({
  action: z
    .enum([
      "dictionaries",
      "areas",
      "area",
      "professional_roles",
      "industries",
      "languages",
      "metro",
      "metro_city",
      "locales",
      "currencies",
      "educational_institutions",
    ])
    .describe("Dictionary action — все методы публичные, авторизация не нужна."),
  area_id: z.string().optional().describe("for action=area"),
  city_id: z.string().optional().describe("for action=metro_city"),
  query: z.record(z.string(), z.unknown()).optional().describe("Для educational_institutions обязателен id или массив id учебных заведений; для поиска названия используй hh_suggests."),
});

export type DictionariesInput = z.infer<typeof dictionariesSchema>;

export async function dictionariesTool(input: DictionariesInput): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "dictionaries":
        return ok(await hhRequest("GET", "/dictionaries"));
      case "areas":
        return ok(await hhRequest("GET", "/areas"));
      case "area":
        if (!input.area_id) return fail("area_id is required");
        return ok(await hhRequest("GET", `/areas/${encodeURIComponent(input.area_id)}`));
      case "professional_roles":
        return ok(await hhRequest("GET", "/professional_roles"));
      case "industries":
        return ok(await hhRequest("GET", "/industries"));
      case "languages":
        return ok(await hhRequest("GET", "/languages"));
      case "metro":
        return ok(await hhRequest("GET", "/metro"));
      case "metro_city":
        if (!input.city_id) return fail("city_id is required");
        return ok(await hhRequest("GET", `/metro/${encodeURIComponent(input.city_id)}`));
      case "locales":
        return ok(await hhRequest("GET", "/locales"));
      case "currencies": {
        const dictionaries = await hhRequest<{ currency: unknown }>("GET", "/dictionaries");
        return ok(dictionaries.currency);
      }
      case "educational_institutions":
        if (!input.query?.id || (Array.isArray(input.query.id) && !input.query.id.length)) return fail("query.id is required; use hh_suggests for name search");
        return ok(
          await hhRequest("GET", "/educational_institutions", { query: input.query })
        );
      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
