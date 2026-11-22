import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { employerResumesTool } from "../src/tools/employer_resumes.ts";
import { employerNegotiationsTool } from "../src/tools/employer_negotiations.ts";
import { employerVacanciesTool } from "../src/tools/employer_vacancies.ts";
import { wrap } from "../src/server.ts";

// Independent snapshot of the public HH OpenAPI, not a list copied from our routes.
const contract = JSON.parse(fs.readFileSync(new URL("./hh-api-contract.json", import.meta.url)));
const modules = ["dictionaries", "suggests", "employer_info", "employer_vacancies",
  "employer_negotiations", "employer_resumes", "salary", "webhooks"];
const input = {
  employer_id: "991", manager_id: "992", vacancy_id: "993", resume_id: "994",
  topic_id: "995", draft_id: "996", applicant_id: "997", comment_id: "998",
  subscription_id: "999", saved_search_id: "990", area_id: "1", city_id: "1",
  address_id: "987", collection: "response", action_id: "consider", template: "invite",
  text: "стоматолог", message: "test-message",
  body: { url: "https://example.com/hh", actions: [{ type: "NEW_NEGOTIATION_VACANCY", settings: { vacancies: ["993"] } }],
    order: "updated_at", message: "test-message", topic_ids: ["995"] },
  query: { id: "1", text: "стоматолог", order: "updated_at" },
};
function match(url, method) {
  const matches = Object.entries(contract.paths).filter(([path, methods]) =>
    methods[method.toLowerCase()] && new RegExp("^" + path.replace(/\{[^}]+\}/g, "[^/]+") + "$").test(url.pathname));
  matches.sort(([a], [b]) => a.split("{").length - b.split("{").length);
  assert.ok(matches.length, `${method} ${url.pathname} must exist in HH OpenAPI`);
  return matches[0][1][method.toLowerCase()];
}
for (const name of modules) {
  const mod = await import(`../src/tools/${name}.ts`);
  const schema = Object.entries(mod).find(([key]) => key.endsWith("Schema"))[1];
  const fn = Object.entries(mod).find(([key]) => key.endsWith("Tool"))[1];
  for (const action of schema.shape.action.options) {
    test(`${name}.${action}: HTTP method, path, encoding and result satisfy HH/MCP contracts`, async (t) => {
      let calls = 0;
      t.mock.method(globalThis, "fetch", async (value, options) => {
        calls++;
        const url = new URL(value), operation = match(url, options.method);
        for (const required of operation.requiredQuery) {
          assert.ok(url.searchParams.has(required), `required query parameter: ${required}`);
        }
        if (options.body !== undefined) {
          assert.ok(operation.bodyTypes.includes(options.headers["Content-Type"]), "HH request encoding");
        }
        return operation.noContent ? new Response(null, { status: 204 }) : Response.json({
          employer: { id: "991" }, manager: { id: "992" }, items: [], currency: [{ code: "RUR" }],
        });
      });
      const args = { ...input, action };
      if (action === "message_send") args.body = { message: "test-message" };
      if (action === "move_to_collection") args.body = { topic_ids: ["995"], message: "test-message" };
      if (["templates_list", "message_template_get"].includes(action)) {
        delete args.vacancy_id;
        delete args.resume_id;
      }
      if (action.startsWith("applicant_comment_")) args.body = { text: "test-comment", access_type: "coworkers" };
      const result = await fn(args);
      assert.ok(!result.isError, result.content?.[0]?.text);
      assert.ok(calls > 0, "supported action reaches HH");
      assert.equal(typeof result.content[0].text, "string", "even HH 204 must be valid MCP text");
    });
  }
}

test("plain resume get needs no confirmation and never requests or follows contact links", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(new URL(url));
    return Response.json({ id: "994", actions: { get_with_contact: { url: "https://api.hh.ru/resumes/994?with_contact=true" } } });
  });
  for (const confirm of [undefined, false, true]) {
    const result = await employerResumesTool({ action: "get", resume_id: "994", confirm,
      query: { with_contact: true, with_creds: true, topic_id: "995" } });
    assert.ok(!result.isError);
  }
  assert.equal(calls.length, 3);
  for (const url of calls) {
    assert.equal(url.pathname, "/resumes/994");
    assert.equal(url.search, "");
  }
  await employerResumesTool({ action: "get", resume_id: "994?with_contact=true" });
  assert.equal(calls.at(-1).search, "", "resume ID cannot inject contact parameters");
});

test("manager statistics cannot accidentally call method_access", async (t) => {
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => { paths.push(new URL(url).pathname); return Response.json({}); });
  await employerNegotiationsTool({ action: "statistics_manager", employer_id: "991", manager_id: "992" });
  assert.deepEqual(paths, ["/employers/991/managers/992/negotiations_statistics"]);
});

test("message sending and marking/transitioning topics use actual HH form fields", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ path: new URL(url).pathname, options }); return new Response(null, { status: 204 });
  });
  await employerNegotiationsTool({ action: "message_send", topic_id: "995", message: "test-message" });
  await employerNegotiationsTool({ action: "mark_read", topic_ids: ["995", "996"] });
  await employerNegotiationsTool({ action: "move_to_collection", collection: "consider", body: { topic_ids: ["995", "996"], message: "test-message" } });
  for (const call of calls) assert.equal(call.options.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(new URLSearchParams(calls[0].options.body).get("message"), "test-message");
  for (const call of calls.slice(1)) assert.deepEqual(new URLSearchParams(call.options.body).getAll("topic_id"), ["995", "996"]);
  assert.equal(calls[2].path, "/negotiations/consider");
});

test("missing required IDs do not issue pointless HH requests", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("MUST NOT FETCH"); });
  for (const action of ["collections", "list", "active_topics", "preference_order_get", "preference_order_set"]) {
    const result = await employerNegotiationsTool({ action });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /vacancy_id/);
  }
  for (const action of ["draft_duplicates", "disable_auto_publication"]) {
    const result = await employerVacanciesTool({ action });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /draft_id/);
  }
});

test("resume access failures remain errors, never claim free access or bypass HH", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ type: "forbidden", value: "not_enough_services" }] }, { status: 403 }));
  const logs = [];
  const result = await wrap("hh_employer_resumes", employerResumesTool, (s) => logs.push(s))({ action: "get", resume_id: "994" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 403/);
  assert.match(logs[0], /ERROR/);
  assert.doesNotMatch(logs[0], /\bOK\b/);
});

test("unsupported actions are no longer advertised to agents", async () => {
  for (const [name, removed] of [
    ["suggests", ["organizations", "registered_companies"]],
    ["employer_info", ["blacklisted"]],
    ["employer_vacancies", ["restore", "available_services"]],
    ["employer_negotiations", ["ignore_list", "history", "view"]],
    ["employer_resumes", ["views_list", "mine_invitations"]],
  ]) {
    const mod = await import(`../src/tools/${name}.ts`);
    const schema = Object.entries(mod).find(([key]) => key.endsWith("Schema"))[1];
    for (const action of removed) assert.ok(!schema.shape.action.options.includes(action));
  }
});

test("message templates forward exactly the supported context and reject ambiguous context locally", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => { urls.push(new URL(url)); return Response.json({}); });
  assert.ok(!(await employerNegotiationsTool({ action: "templates_list", template: "invite", vacancy_id: "993", resume_id: "994" })).isError);
  assert.equal(urls[0].searchParams.get("vacancy_id"), "993");
  assert.equal(urls[0].searchParams.get("resume_id"), "994");
  assert.ok(!(await employerNegotiationsTool({ action: "message_template_get", template: "invite", topic_id: "995" })).isError);
  assert.equal(urls[1].searchParams.get("topic_id"), "995");
  for (const args of [{}, { topic_id: "995", vacancy_id: "993", resume_id: "994" }]) {
    assert.equal((await employerNegotiationsTool({ action: "templates_list", template: "invite", ...args })).isError, true);
  }
  assert.equal(urls.length, 2);
});
