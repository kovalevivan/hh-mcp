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
  query: z.record(z.string(), z.unknown()).optional().describe("optional query params (например text= для educational_institutions)"),
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
        return ok(await hhRequest("GET", `/areas/${input.area_id}`));
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
        return ok(await hhRequest("GET", `/metro/${input.city_id}`));
      case "locales":
        return ok(await hhRequest("GET", "/locales"));
      case "currencies":
        return ok(await hhRequest("GET", "/dictionaries", { query: { only: "currency" } }));
      case "educational_institutions":
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
