import assert from "node:assert/strict";
import test from "node:test";
import { dictionariesSchema } from "../src/tools/dictionaries.ts";
import { employerInfoSchema } from "../src/tools/employer_info.ts";
import { employerVacanciesSchema } from "../src/tools/employer_vacancies.ts";
import { employerNegotiationsSchema } from "../src/tools/employer_negotiations.ts";
import { employerResumesSchema, employerResumesTool } from "../src/tools/employer_resumes.ts";
import { salarySchema } from "../src/tools/salary.ts";
import { webhooksSchema } from "../src/tools/webhooks.ts";

for (const [name, schema] of Object.entries({
  dictionaries: dictionariesSchema,
  employerInfo: employerInfoSchema,
  employerVacancies: employerVacanciesSchema,
  employerNegotiations: employerNegotiationsSchema,
  employerResumes: employerResumesSchema,
  salary: salarySchema,
  webhooks: webhooksSchema,
})) {
  test(`${name}: record parameters retain arbitrary HH payloads`, () => {
    const action = schema.shape.action.options[0];
    const payload = { text: "стоматолог", area: [1, "2"], enabled: false, nested: { value: null } };
    for (const field of ["query", "body"]) {
      if (!schema.shape[field]) continue;
      assert.deepEqual(schema.parse({ action, [field]: payload })[field], payload);
      assert.equal(schema.safeParse({ action, [field]: "invalid" }).success, false);
    }
    assert.equal(schema.safeParse({ action: "invalid-action" }).success, false);
  });
}

test("opening a paid resume still requires explicit confirmation before any API request", async () => {
  const result = await employerResumesTool({ action: "get", resume_id: "not-a-real-resume" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /confirm/);
});
