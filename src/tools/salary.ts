import { z } from "zod";
import { hhRequest } from "../client/hh.js";
import { ok, fail, failFromError, type ToolContent } from "../lib/result.js";

export const salarySchema = z.object({
  action: z
    .enum([
      "evaluation",
      "industries",
      "professional_areas",
      "employee_levels",
      "areas",
    ])
    .describe(
      "Аналитика зарплат HH. evaluation — оценка для конкретного запроса (полезно при создании вакансии). Остальное — словари осей."
    ),
  area_id: z.string().optional().describe("регион для evaluation (обязателен)"),
  query: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Для evaluation: professional_role / employee_level / industry / education / experience и др. (см. /salary_statistics/dictionaries/*)"
    ),
});

export type SalaryInput = z.infer<typeof salarySchema>;

export async function salaryTool(input: SalaryInput): Promise<ToolContent> {
  try {
    switch (input.action) {
      case "evaluation": {
        if (!input.area_id) return fail("area_id is required for evaluation");
        return ok(
          await hhRequest("GET", `/salary_statistics/paid/salary_evaluation/${input.area_id}`, {
            query: input.query,
          })
        );
      }
      case "industries":
        return ok(await hhRequest("GET", "/salary_statistics/dictionaries/salary_industries"));
      case "professional_areas":
        return ok(
          await hhRequest("GET", "/salary_statistics/dictionaries/professional_areas")
        );
      case "employee_levels":
        return ok(await hhRequest("GET", "/salary_statistics/dictionaries/employee_levels"));
      case "areas":
        return ok(await hhRequest("GET", "/salary_statistics/dictionaries/salary_areas"));
      default:
        return fail(`unknown action: ${(input as { action: string }).action}`);
    }
  } catch (err) {
    return failFromError(err);
  }
}
