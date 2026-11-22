import assert from "node:assert/strict";
import test from "node:test";
import { createChatTools, chatsSchema, chatSendSchema, chatStartSchema } from "../src/tools/chats.ts";
import { HhApiError } from "../src/lib/errors.ts";
import { createServer, registerTools } from "../src/server.ts";
import { hhRequest } from "../src/client/hh.ts";
import fs from "node:fs";

const message = {
  chat_id: "123", recipient_id: "456", recipient_name: "Иван Иванов",
  text: "Здравствуйте! Удобно обсудить вакансию?",
  idempotency_key: "8abcdef8-4abc-4edf-1234-1234567890ab", confirm: true,
};
const state = {
  id: "123", type: "NEGOTIATION",
  chat_states: { write_message_state: { allowed: true } },
};
const participants = { items: [
  { id: "456", name: "Иван Иванов", role: "APPLICANT" },
  { id: "457", name: "Рекрутер", role: "EMPLOYER" },
] };
function fixture(options = {}) {
  const calls = [];
  const request = async (method, path, params) => {
    calls.push({ method, path, params });
    if (options.error) throw options.error;
    if (method === "POST") {
      if (options.sendError) throw options.sendError;
      return { id: "message-1" };
    }
    return path.endsWith("/participants") ? options.participants ?? participants : options.state ?? state;
  };
  return { tools: createChatTools(request), calls };
}
const payload = result => JSON.parse(result.content[0].text);

test("text delivery checks the recipient and write permission, sends exact approved content and AI flag", async () => {
  const { tools, calls } = fixture();
  const result = await tools.send({ ...message, text: "  Точный текст\nбез изменений  ", reply_to_message_id: "777" });
  assert.ok(!result.isError);
  assert.equal(payload(result).status, "sent");
  assert.equal(payload(result).message_id, "message-1");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], { method: "POST", path: "/common/chats/123/messages", params: { body: {
    text: "  Точный текст\nбез изменений  ", idempotency_key: message.idempotency_key,
    is_automated: true, reply_to_message_id: "777",
  } } });
});

for (const confirm of [undefined, false]) {
  test(`unconfirmed send (${confirm}) performs no requests`, async () => {
    const { tools, calls } = fixture();
    assert.equal((await tools.send({ ...message, confirm })).isError, true);
    assert.equal(calls.length, 0);
  });
  test(`unconfirmed chat creation (${confirm}) performs no requests`, async () => {
    const { tools, calls } = fixture();
    assert.equal((await tools.start({ resume_id: "resume-1", confirm })).isError, true);
    assert.equal(calls.length, 0);
  });
}

for (const [name, options] of [
  ["wrong chat", { state: { ...state, id: "other" } }],
  ["support chat", { state: { ...state, type: "SUPPORT" } }],
  ["blocked chat", { state: { ...state, chat_states: { write_message_state: { allowed: false, reason: "ARCHIVED_BY_EMPLOYER" } } } }],
  ["unknown write permission", { state: { id: "123", type: "COMMON" } }],
  ["changed recipient", { participants: { items: [{ ...participants.items[0], id: "999" }] } }],
  ["changed recipient name", { participants: { items: [{ ...participants.items[0], name: "Другой человек" }] } }],
  ["no applicant", { participants: { items: [participants.items[1]] } }],
  ["ambiguous recipient", { participants: { items: [...participants.items, { ...participants.items[0], id: "999" }] } }],
]) {
  test(`${name} blocks delivery`, async () => {
    const { tools, calls } = fixture(options);
    assert.equal((await tools.send(message)).isError, true);
    assert.ok(calls.every(call => call.method === "GET"));
  });
}

for (const invalid of [
  { text: "" }, { text: " \n " }, { text: "a".repeat(20001) },
  { idempotency_key: "not-a-uuid" }, { chat_id: "../another" },
  { recipient_id: "https://example.com" }, { body: { is_automated: false } },
]) {
  test(`invalid send ${Object.keys(invalid)} is rejected before any HH request`, async () => {
    const { tools, calls } = fixture();
    assert.equal((await tools.send({ ...message, ...invalid })).isError, true);
    assert.equal(calls.length, 0);
  });
}

for (const status of [403, 404, 409]) {
  test(`HH ${status} remains an error and never falls back to legacy sending`, async () => {
    const { tools, calls } = fixture({ sendError: new HhApiError({
      status, endpoint: "POST /common/chats/123/messages", message: "upstream refused",
    }) });
    const result = await tools.send(message);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(`HTTP ${status}`));
    assert.equal(calls.filter(call => call.method === "POST").length, 1);
    assert.ok(calls.every(call => call.path.startsWith("/common/chats")));
  });
}

test("a network failure is not retried with another key; an explicit retry retains the same payload", async () => {
  const { tools, calls } = fixture({ sendError: new Error("network interrupted") });
  await tools.send(message);
  await tools.send(message);
  const posts = calls.filter(call => call.method === "POST");
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], posts[1]);
});

test("failed preflight cannot send", async () => {
  const { tools, calls } = fixture({ error: new Error("not connected") });
  assert.equal((await tools.send(message)).isError, true);
  assert.ok(calls.every(call => call.method === "GET"));
});

test("creating a chat cannot smuggle in a first message", async () => {
  const { tools, calls } = fixture();
  assert.equal((await tools.start({ resume_id: "abc", confirm: true, first_message: "not approved" })).isError, true);
  assert.equal(calls.length, 0);
  await tools.start({ resume_id: "abc", confirm: true });
  assert.deepEqual(calls, [{ method: "POST", path: "/common/chats/without_vacancy", params: { body: { resume_hash: "abc" } } }]);
});

test("all browsing actions are GET-only and retain paging, filters and large string IDs", async () => {
  const { tools, calls } = fixture();
  await tools.read({ action: "list", page: 2, per_page: 3, filter_unread: true, vacancy_ids: ["99999999999999999999", "2"], vacancy_status: "with" });
  await tools.read({ action: "messages", chat_id: "123", start_message_id: "99", limit: 5, order: "prev" });
  await tools.read({ action: "participants", chat_id: "123" });
  await tools.read({ action: "unread" });
  assert.ok(calls.every(call => call.method === "GET"));
  assert.equal(calls[0].params.query.filter_with_vacancy_ids, "[99999999999999999999,2]");
  assert.equal(calls[0].params.query.page, 2);
  assert.equal(calls[1].params.query.start_message_id, "99");
  assert.equal(calls[1].params.query.order, "prev");
});

test("read validation rejects missing chat, unsupported actions and excessive pages", async () => {
  const { tools, calls } = fixture();
  for (const input of [{ action: "messages" }, { action: "participants" }, { action: "send" }, { action: "list", per_page: 21 }]) {
    assert.equal((await tools.read(input)).isError, true);
  }
  assert.equal(calls.length, 0);
});

test("registration exposes read/write tools separately with explicit mutation annotations", () => {
  const definitions = [];
  registerTools({ tool: (...args) => definitions.push(args) });
  const read = definitions.find(args => args[0] === "hh_chats");
  assert.equal(read[3].readOnlyHint, true);
  for (const name of ["hh_chat_start", "hh_chat_send"]) {
    const tool = definitions.find(args => args[0] === name);
    assert.equal(tool[3].readOnlyHint, false);
    assert.equal(tool[3].destructiveHint, true);
  }
  assert.equal(chatSendSchema.parse(message).confirm, true);
  assert.equal(chatStartSchema.parse({ resume_id: "123" }).confirm, false);
  assert.equal(chatsSchema.safeParse({ action: "messages", limit: 51 }).success, false);
  assert.ok(createServer());
});

test("actual HH client satisfies the independent chat POST contract, including JSON encoding and client identity", async (t) => {
  const contract = JSON.parse(fs.readFileSync(new URL("./hh-chat-contract.json", import.meta.url)));
  let delivered = 0;
  t.mock.method(globalThis, "fetch", async (value, options) => {
    const url = new URL(value);
    assert.ok(options.headers["HH-User-Agent"]);
    if (options.method === "POST") {
      delivered++;
      assert.equal(url.pathname, "/common/chats/123/messages");
      assert.equal(options.headers["Content-Type"], contract.contentType);
      const body = JSON.parse(options.body);
      for (const key of contract.message.required) assert.ok(key in body);
      for (const key of Object.keys(body)) assert.ok(key in contract.message.properties);
      assert.match(body.idempotency_key, new RegExp(contract.message.properties.idempotency_key.pattern));
      assert.ok(body.text.length <= contract.message.properties.text.maxLength);
      assert.equal(body.is_automated, true);
      return Response.json({ id: "987" }, { status: 201 });
    }
    return Response.json(url.pathname.endsWith("/participants") ? participants : state);
  });
  const result = await createChatTools(hhRequest).send(message);
  assert.ok(!result.isError, result.content[0].text);
  assert.equal(delivered, 1);
});
