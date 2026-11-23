import assert from "node:assert/strict";
import test from "node:test";
import { compactSearch, professionalText, splitProfessionalText } from "../src/resumes/presentation.ts";
import { ResumeDetails } from "../src/resumes/details.ts";
import { employerResumesTool } from "../src/tools/employer_resumes.ts";

const description = "Начало работы.\n" + "Профессиональные достижения 🚀 и показатели роста. ".repeat(120) + "\nКонец описания.";
const resume = {
  id: "resume-1", title: "Руководитель отдела продаж", area: { id: "1", name: "Москва", url: "https://api.hh.ru/areas/1" },
  salary: { amount: 200000, currency: "RUR", extra: "remove" }, updated_at: "2026-11-17T12:00:00+0300",
  first_name: "PRIVATE-NAME", contact: [{ value: "PRIVATE-PHONE" }], photo: { small: "PRIVATE-PHOTO" },
  alternate_url: "https://hh.ru/resume/resume-1", url: "https://api.hh.ru/resumes/resume-1",
  actions: { get_with_contact: { url: "PRIVATE-PURCHASE-LINK" }, download: { pdf: { url: "PRIVATE-DOWNLOAD" } } },
  experience: [
    { company: "Компания А", position: "РОП", start: "2023-01-01", end: null,
      industries: [{ id: "7", name: "Медицина" }, { id: "7", name: "Медицина" }],
      description, logo_urls: { small: "PRIVATE-LOGO" }, employer: { id: "5", url: "PRIVATE-EMPLOYER" } },
    { company: "Компания Б", position: "Менеджер", start: "2020-01-01", end: "2022-12-31", industries: [{ name: "Продажи" }], description: "Продавал услуги." },
  ],
  skills: "Полное описание навыков\n" + "CRM, аналитика и управление командой. ".repeat(100),
  skill_set: ["CRM", "Аналитика", "CRM"], can_view_full_info: false,
};
const options = { partChars: 1000, ttlSeconds: 60, maxBytes: 1000000, maxEntries: 10 };
function fixture(overrides = {}) {
  let calls = 0, revision = 1, now = Date.now();
  const request = async (method, path, opts) => { calls++; assert.equal(method, "GET"); assert.equal(path, "/resumes/resume-1"); assert.equal(opts, undefined); return structuredClone(resume); };
  const service = new ResumeDetails(request, () => revision, { ...options, ...overrides }, () => now);
  return { service, calls: () => calls, accountChanged: () => revision++, advance: (ms) => now += ms };
}

test("search includes exactly the requested fields and ALL jobs, but no long descriptions or service objects", () => {
  const result = compactSearch({ items: [resume], found: 1, page: 0, pages: 1, per_page: 20, clusters: { huge: "remove" } });
  assert.deepEqual(Object.keys(result).sort(), ["found", "items", "page", "pages", "per_page"]);
  assert.deepEqual(result.items[0], {
    id: "resume-1", url: "https://hh.ru/resume/resume-1", title: resume.title, city: "Москва",
    salary: { amount: 200000, currency: "RUR" }, updated_at: resume.updated_at,
    experience: [
      { company: "Компания А", industries: ["Медицина"], position: "РОП", start: "2023-01-01", end: null },
      { company: "Компания Б", industries: ["Продажи"], position: "Менеджер", start: "2020-01-01", end: "2022-12-31" },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|description|logo|photo|actions|download|clusters/);
});

test("search preserves pagination and missing fields without inventing descriptions", () => {
  const result = compactSearch({ found: 0, page: 4, pages: 5, per_page: 10, items: [] });
  assert.deepEqual(result, { found: 0, page: 4, pages: 5, per_page: 10, items: [] });
  assert.deepEqual(compactSearch({ items: [{ id: "x", experience: null }] }).items[0].experience, []);
});

test("professional text preserves every work description and all supplied skill text verbatim", () => {
  const text = professionalText(resume);
  assert.ok(text.includes(description));
  assert.ok(text.includes(resume.skills));
  assert.ok(text.includes("Продавал услуги."));
  assert.ok(text.includes("CRM, Аналитика"));
  assert.doesNotMatch(text, /PRIVATE/);
});

test("parts reconstruct the ENTIRE document, preserve whitespace and never split surrogate pairs", () => {
  for (const input of [professionalText(resume), "x".repeat(999) + "🚀" + "y".repeat(2001), "а".repeat(5000)]) {
    const parts = splitProfessionalText(input, 1000);
    assert.equal(parts.join(""), input);
    assert.ok(parts.every((p) => p.length <= 1000));
    for (const part of parts) {
      assert.ok(!/[\uD800-\uDBFF]$/.test(part));
      assert.ok(!/^[\uDC00-\uDFFF]/.test(part));
    }
  }
});

test("get continuations are explicit, consistent and do not issue additional HH requests", async () => {
  const f = fixture(), text = [];
  let result = await f.service.get("resume-1"), index = 1;
  assert.ok(result.has_more);
  const firstNext = result.next;
  while (true) {
    assert.equal(result.part, index++);
    assert.equal(result.contacts_included, false);
    assert.equal(result.hh_can_view_full_info, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    text.push(result.text);
    if (!result.has_more) break;
    assert.equal(result.next.cursor, result.next_cursor);
    assert.equal(result.next.action, "get");
    result = await f.service.get(result.next.resume_id, result.next.cursor);
  }
  assert.equal(text.join(""), professionalText(resume));
  assert.equal(result.next, null); assert.equal(result.next_cursor, null);
  assert.equal(result.part, result.parts_total);
  assert.equal(f.calls(), 1);
  const retryA = await f.service.get(firstNext.resume_id, firstNext.cursor);
  const retryB = await f.service.get(firstNext.resume_id, firstNext.cursor);
  assert.deepEqual(retryA, retryB, "retries are idempotent");
});

test("a short resume completes in one part without an unnecessary continuation", async () => {
  const f = new ResumeDetails(async () => ({ id: "x", skills: "CRM" }), () => 1, options);
  const result = await f.get("x");
  assert.equal(result.parts_total, 1); assert.equal(result.has_more, false); assert.equal(result.next, null);
});

test("expired snapshots fail explicitly instead of fetching a new version and mixing texts", async () => {
  const f = fixture(), first = await f.service.get("resume-1");
  f.advance(60000);
  await assert.rejects(f.service.get("resume-1", first.next_cursor), /expired/);
  assert.equal(f.calls(), 1);
});

test("restart, different resume and changed account cannot reuse a continuation", async () => {
  const f = fixture(), first = await f.service.get("resume-1");
  await assert.rejects(f.service.get("other", first.next_cursor), /invalid/);
  await assert.rejects(fixture().service.get("resume-1", first.next_cursor), /expired/);
  f.accountChanged();
  await assert.rejects(f.service.get("resume-1", first.next_cursor), /expired/);
  assert.equal(f.calls(), 1);
});

test("account replacement during an HH request cannot publish its result", async () => {
  let revision = 1;
  const f = new ResumeDetails(async () => { revision++; return resume; }, () => revision, options);
  await assert.rejects(f.get("resume-1"), /account changed/);
});

test("bounded memory evicts old snapshots explicitly; oversized text is never silently clipped", async () => {
  const f = fixture({ maxEntries: 1 });
  const old = await f.service.get("resume-1");
  const current = await f.service.get("resume-1");
  await assert.rejects(f.service.get("resume-1", old.next_cursor), /expired/);
  assert.equal((await f.service.get("resume-1", current.next_cursor)).part, 2);
  await assert.rejects(fixture({ maxBytes: 1 }).service.get("resume-1"), /memory budget/);
});

test("invalid cursors/sizes fail locally; size cannot change between parts", async () => {
  const f = fixture(), first = await f.service.get("resume-1");
  for (const cursor of ["../file", first.next_cursor.split(".")[0] + ".9999999"]) {
    await assert.rejects(f.service.get("resume-1", cursor), /invalid/);
  }
  await assert.rejects(f.service.get("resume-1", first.next_cursor, 2000), /change max_chars/);
  await assert.rejects(f.service.get("resume-1", undefined, 0), /max_chars/);
  assert.equal(f.calls(), 1);
});

test("HH failures stay failures, and search/get use compact JSON instead of pretty-printed objects", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (new URL(url).pathname === "/resumes") return Response.json({ items: [resume], found: 1, page: 0, pages: 1, per_page: 20 });
    return Response.json({ errors: [{ type: "forbidden" }] }, { status: 403 });
  });
  const search = await employerResumesTool({ action: "search" });
  assert.ok(!search.isError); assert.ok(!search.content[0].text.includes("\n"));
  const result = await employerResumesTool({ action: "get", resume_id: "resume-1" });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /HTTP 403/);
});
