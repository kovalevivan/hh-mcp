import assert from "node:assert/strict";
import test from "node:test";
import { employerResumesTool, resumeQuery } from "../src/tools/employer_resumes.ts";
import { wrap } from "../src/server.ts";
import { fail, ok } from "../src/lib/result.ts";
import { HhApiError, describeHhError } from "../src/lib/errors.ts";

test("criteria uses the public dictionaries endpoint, not a resume ID", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(new URL(url).pathname);
    return Response.json({ resume_search_order: [{ id: "relevance" }] });
  });
  const result = await employerResumesTool({ action: "available_resume_search_criteria" });
  assert.ok(!result.isError);
  assert.deepEqual(calls, ["/dictionaries"]);
  assert.match(result.content[0].text, /resume_search_order/);
});

test("CSV numeric IDs become repeated HH query parameters without changing other filters", async (t) => {
  const query = { area: "1,2019", professional_role: "106, 107", text: "врач, стоматолог", per_page: 3, order_by: "relevance" };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(new URL(url));
    return Response.json({ items: [] });
  });
  for (const action of ["search", "saved_search_create", "saved_search_update"]) {
    assert.ok(!(await employerResumesTool({ action, query, saved_search_id: "123" })).isError);
  }
  for (const url of calls) {
    assert.deepEqual(url.searchParams.getAll("area"), ["1", "2019"]);
    assert.deepEqual(url.searchParams.getAll("professional_role"), ["106", "107"]);
    assert.equal(url.searchParams.get("text"), query.text);
    assert.equal(url.searchParams.get("per_page"), "3");
  }
  assert.equal(query.area, "1,2019");
  const alreadyValid = { area: ["1", "2019"], professional_role: "106" };
  assert.deepEqual(resumeQuery(alreadyValid), alreadyValid);
  assert.equal(resumeQuery(undefined), undefined);
});

test("an HH error remains isError and logs ERROR instead of OK, without logging response data", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    description: "bad argument",
    errors: [{ type: "bad_argument", value: "area" }],
    sensitive: "private-response-value",
  }, { status: 400, statusText: "Bad Request" }));
  const logs = [];
  const result = await wrap("hh_employer_resumes", employerResumesTool, (s) => logs.push(s))({ action: "search" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 400/);
  assert.match(result.content[0].text, /bad_argument/);
  assert.match(result.content[0].text, /area/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /ERROR.*GET \/resumes HTTP 400/);
  assert.doesNotMatch(logs[0], /\bOK\b|private-response-value|bad_argument/);
});

test("validation failures also log ERROR and preserve the failure", async () => {
  const logs = [];
  const result = fail("sensitive-validation-detail");
  assert.equal(await wrap("validation", async () => result, (s) => logs.push(s))({}), result);
  assert.match(logs[0], /ERROR/);
  assert.doesNotMatch(logs[0], /\bOK\b|sensitive-validation-detail/);
});

test("success logs OK exactly once", async () => {
  const logs = [];
  const result = ok({ items: [] });
  assert.equal(await wrap("success", async () => result, (s) => logs.push(s))({}), result);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\bOK\b/);
  assert.doesNotMatch(logs[0], /ERROR/);
});

test("thrown exceptions return failures without logging private exception messages", async () => {
  const logs = [];
  const result = await wrap("throws", async () => { throw new Error("private-token"); }, (s) => logs.push(s))({});
  assert.equal(result.isError, true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /ERROR/);
  assert.doesNotMatch(logs[0], /\bOK\b|private-token/);
});

test("HTTP status, endpoint and HH details survive error conversion", () => {
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const message = describeHhError(new HhApiError({ status, endpoint: "GET /resumes", message: "failure", body: {
      description: "Forbidden", errors: [{ type: "oauth", value: "token_expired" }],
    } }));
    assert.match(message, new RegExp(`HTTP ${status}`));
    assert.match(message, /token_expired/);
  }
});
