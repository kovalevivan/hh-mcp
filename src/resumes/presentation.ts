export type ResumeObject = Record<string, unknown>;
function object(value: unknown): ResumeObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ResumeObject : {};
}
function scalar(value: unknown): string | number | boolean | null {
  return ["string", "number", "boolean"].includes(typeof value) ? value as string | number | boolean : null;
}
function label(value: unknown): string | number | boolean | null {
  return typeof value === "string" ? value : scalar(object(value).name);
}
function uniqueNames(value: unknown): (string | number | boolean)[] {
  return [...new Set((Array.isArray(value) ? value : []).map(label).filter((x): x is string | number | boolean => x !== null))];
}
export function workHistory(value: unknown): ResumeObject[] {
  return (Array.isArray(value) ? value : []).map((entry) => {
    const job = object(entry);
    return { company: scalar(job.company), industries: uniqueNames(job.industries), position: scalar(job.position), start: scalar(job.start), end: scalar(job.end) };
  });
}
export function resumeLink(id: unknown): string | null {
  return typeof id === "string" && id ? `https://hh.ru/resume/${encodeURIComponent(id)}` : null;
}
export function searchCard(value: unknown): ResumeObject {
  const resume = object(value), salary = object(resume.salary);
  return { id: scalar(resume.id), url: resumeLink(resume.id), title: scalar(resume.title), city: label(resume.area),
    salary: resume.salary ? { amount: scalar(salary.amount), currency: scalar(salary.currency) } : null,
    updated_at: scalar(resume.updated_at), experience: workHistory(resume.experience) };
}
export function compactSearch(value: unknown): ResumeObject {
  const result = object(value);
  return { found: scalar(result.found), page: scalar(result.page), pages: scalar(result.pages), per_page: scalar(result.per_page),
    items: (Array.isArray(result.items) ? result.items : []).map(searchCard) };
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }

/** Work descriptions and skills are copied verbatim; structured contact fields are never selected. */
export function professionalText(value: unknown): string {
  const resume = object(value), chunks: string[] = [];
  const jobs = Array.isArray(resume.experience) ? resume.experience : [];
  chunks.push("Опыт работы");
  if (!jobs.length) chunks.push("HH не вернул историю работы.");
  for (const [index, value] of jobs.entries()) {
    const job = object(value);
    chunks.push(`\n${index + 1}. Компания: ${text(job.company) || "не указана"}`,
      `Отрасль: ${uniqueNames(job.industries).join(", ") || "не указана"}`,
      `Должность: ${text(job.position) || "не указана"}`,
      `Период: ${text(job.start) || "не указан"} — ${job.end === null ? "по настоящее время" : text(job.end) || "не указан"}`,
      "Описание работы:", typeof job.description === "string" ? job.description : "HH не вернул описание работы.");
  }
  chunks.push("\nПрофессиональные навыки и описание", typeof resume.skills === "string" ? resume.skills : "HH не вернул текст навыков.");
  chunks.push("\nКлючевые навыки", uniqueNames(resume.skill_set).join(", ") || "HH не вернул ключевые навыки.");
  return chunks.join("\n");
}
export function splitProfessionalText(text: string, maxChars: number): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 2) throw new Error("Text part size must be at least 2");
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end - 1);
      if (newline >= start + Math.floor(maxChars / 2)) end = newline + 1;
      // Never split a UTF-16 surrogate pair. No trimming: concatenation reconstructs the full text.
      if (end > start && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    parts.push(text.slice(start, end)); start = end;
  }
  return parts.length ? parts : [""];
}
export function professionalMetadata(value: unknown): ResumeObject {
  const resume = object(value);
  return { id: scalar(resume.id), url: resumeLink(resume.id), title: scalar(resume.title), contacts_included: false,
    hh_can_view_full_info: scalar(resume.can_view_full_info),
    availability_note: "Выдан весь профессиональный текст, доступный в обычном ответе HH. HH может скрывать поля; can_view_full_info=false не означает отсутствия текста. Контакты и ссылки их открытия исключены." };
}
export function unpagedProfessionalResume(value: unknown): ResumeObject {
  const content = professionalText(value);
  return { ...professionalMetadata(value), text: content, part: 1, parts_total: 1, has_more: false, next_cursor: null, next: null };
}
