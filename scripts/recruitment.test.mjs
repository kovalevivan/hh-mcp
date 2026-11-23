import assert from "node:assert/strict";
import test from "node:test";
import { createRecruitmentTool } from "../src/tools/recruitment.ts";
import { createChatTools } from "../src/tools/chats.ts";
import { HhApiError } from "../src/lib/errors.ts";
import { registerTools } from "../src/server.ts";

const employer = { id: "2114165", name: "Клиника Артдент" };
const other = { id: "12608954", name: "Центр Лазерной Стоматологии" };
const profile = { id: "manager-user", employer, manager: { id: "manager-1" } };
const vacancy = { id: "139546547", name: "Менеджер по подбору персонала", employer, description: "Проверенное описание" };
function fixture(options = {}) {
  const calls = [];
  const request = async (method, path, params) => {
    calls.push({ method, path, params });
    if (path === "/me") return options.profile ?? profile;
    if (path.startsWith("/vacancies/")) return { ...vacancy, ...options.vacancy, id: path.split("/").at(-1) };
    if (options.error) throw options.error;
    if (path.includes("/vacancies/active")) return { found: 1, page: 0, pages: 1, per_page: 10, items: [vacancy] };
    if (path === "/negotiations") return { collections: [{ id: "response", name: "Неразобранные", counters: { total: 2, unread: 1 } }] };
    if (path === "/negotiations/response") return { found: 2, page: 1, pages: 2, per_page: 1, items: [{
      id: "topic-1", resume: { id: "resume-1", title: "Рекрутер", contact: [{ value: "private@example.com" }] },
      vacancy: { id: vacancy.id, name: vacancy.name }, chat_id: "chat-1",
    }] };
    if (path === "/negotiations/topic-1") return { id: "topic-1", vacancy: { id: options.topicVacancy ?? vacancy.id }, resume: { id: "resume-1" } };
    return { found: 0, items: [], page: 0, pages: 1, per_page: 10, unread_chats_count: "0" };
  };
  return { calls, tool: createRecruitmentTool(request), chats: createChatTools(request) };
}
const body = result => JSON.parse(result.content[0].text);

test("a public vacancy identifies its real employer and mismatch without claiming a tariff failure", async () => {
  const { tool } = fixture({ vacancy: { employer: other } });
  const result = body(await tool({ action: "vacancy", vacancy_id: vacancy.id }));
  assert.equal(result.name, vacancy.name);
  assert.equal(result.description, vacancy.description);
  assert.equal(result.belongs_to_connected_employer, false);
  assert.deepEqual(result.account.employer, employer);
  assert.deepEqual(result.employer, other);
});

test("a changed HH employer is observed on the next request without stale account caching", async () => {
  const options = { vacancy: { employer: other } };
  const { tool } = fixture(options);
  assert.equal((await tool({ action: "collections", vacancy_id: vacancy.id })).isError, true);
  options.profile = { ...profile, employer: other };
  const result = await tool({ action: "collections", vacancy_id: vacancy.id });
  assert.ok(!result.isError);
  assert.deepEqual(body(result).account.employer, other);
});

for (const action of ["collections", "applications", "application"]) {
  test(`another employer blocks ${action} before querying negotiations`, async () => {
    const { tool, calls } = fixture({ vacancy: { employer: other } });
    const result = await tool({ action, vacancy_id: vacancy.id, collection: "response", topic_id: "topic-1" });
    assert.equal(result.isError, true);
    assert.equal(body(result).error.code, "HH_EMPLOYER_MISMATCH");
    assert.deepEqual(body(result).error.connected_employer, employer);
    assert.deepEqual(body(result).error.vacancy_employer, other);
    assert.ok(calls.every(call => !call.path.startsWith("/negotiations")));
  });
}

test("chat filtering rejects a vacancy from another employer instead of fabricating zero chats", async () => {
  const { chats, calls } = fixture({ vacancy: { employer: other } });
  const result = await chats.read({ action: "list", vacancy_ids: [vacancy.id] });
  assert.equal(result.isError, true);
  assert.equal(body(result).error.code, "HH_EMPLOYER_MISMATCH");
  assert.ok(calls.every(call => call.path !== "/common/chats"));
});

test("all vacancy IDs in a chat filter are checked", async () => {
  const { chats, calls } = fixture();
  await chats.read({ action: "list", vacancy_ids: ["12345678", "123456789"] });
  assert.ok(calls.some(call => call.path === "/vacancies/12345678"));
  assert.ok(calls.some(call => call.path === "/vacancies/123456789"));
});

test("an empty chat list and unread counter retain the actual employer context", async () => {
  const { chats } = fixture();
  const list = body(await chats.read({ action: "list" }));
  assert.equal(list.found, 0);
  assert.deepEqual(list.account.employer, employer);
  assert.match(list.diagnostic_note, /не доказывает/);
  assert.deepEqual(body(await chats.read({ action: "unread" })).account.employer, employer);
});

test("applications are paged by vacancy and collection without needing resume_id or requesting contacts", async () => {
  const { tool, calls } = fixture();
  const result = await tool({ action: "applications", vacancy_id: vacancy.id, collection: "response", page: 1, per_page: 1 });
  assert.ok(!result.isError);
  const data = body(result);
  assert.equal(data.found, 2); assert.equal(data.page, 1); assert.equal(data.pages, 2);
  assert.equal(data.items[0].resume.id, "resume-1");
  assert.equal(data.items[0].id, "topic-1");
  assert.equal(data.items[0].chat_id, "chat-1");
  assert.equal(data.items[0].resume.contact, undefined);
  assert.ok(calls.every(call => call.method === "GET"));
  assert.ok(calls.every(call => !call.path.startsWith("/resumes")));
  assert.deepEqual(calls.find(call => call.path === "/negotiations/response").params.query, { vacancy_id: vacancy.id, page: 1, per_page: 1, status: undefined });
});

test("own vacancies and collections are exposed without write actions", async () => {
  const { tool, calls } = fixture();
  assert.deepEqual(body(await tool({ action: "context" })).account.employer, employer);
  assert.equal(body(await tool({ action: "vacancies" })).items[0].name, vacancy.name);
  const groups = body(await tool({ action: "collections", vacancy_id: vacancy.id }));
  assert.equal(groups.data.collections[0].counters.total, 2);
  assert.ok(calls.every(call => call.method === "GET"));
});

test("a single application must belong to the selected vacancy", async () => {
  const good = fixture();
  assert.equal(body(await good.tool({ action: "application", vacancy_id: vacancy.id, topic_id: "topic-1" })).application.id, "topic-1");
  const bad = fixture({ topicVacancy: "another-vacancy" });
  assert.equal((await bad.tool({ action: "application", vacancy_id: vacancy.id, topic_id: "topic-1" })).isError, true);
});

for (const input of [{ action: "applications", vacancy_id: vacancy.id }, { action: "collections" },
  { action: "application", vacancy_id: vacancy.id }, { action: "invite" }, { action: "vacancies", page: -1 },
  { action: "applications", vacancy_id: vacancy.id, collection: "../escape" }]) {
  test(`invalid or mutating request ${JSON.stringify(input)} performs no requests`, async () => {
    const { tool, calls } = fixture(); assert.equal((await tool(input)).isError, true); assert.equal(calls.length, 0);
  });
}

test("HH permission failures are explicit errors, not empty applications", async () => {
  const { tool } = fixture({ error: new HhApiError({ status: 403, endpoint: "GET /negotiations", message: "Forbidden" }) });
  const result = await tool({ action: "collections", vacancy_id: vacancy.id });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /HTTP 403/);
});

test("non-employer tokens cannot produce a misleading empty employer list", async () => {
  const { tool, chats } = fixture({ profile: { id: "applicant" } });
  assert.equal((await tool({ action: "vacancies" })).isError, true);
  assert.equal((await chats.read({ action: "list" })).isError, true);
});

test("the agent-facing recruitment tool is registered as read-only", () => {
  const definitions = [];
  registerTools({ tool: (...args) => definitions.push(args) });
  const tool = definitions.find(args => args[0] === "hh_recruitment");
  assert.equal(tool[3].readOnlyHint, true);
  assert.equal(tool[3].destructiveHint, false);
});
