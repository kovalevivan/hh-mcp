import { z } from "zod";
import type { hhRequest } from "../client/hh.js";
import { compact, fail, type ToolContent } from "../lib/result.js";
import { accountScope, currentEmployer, readVacancy, requireVacancyEmployer, employerFailure } from "../employer/scope.js";
import type { Vacancy } from "../employer/scope.js";
import { searchCard } from "../resumes/presentation.js";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const recruitmentSchema = z.object({
  action: z.enum(["context", "vacancies", "vacancy", "collections", "applications", "application"]),
  vacancy_id: id.optional().describe("ID вакансии любой длины из ссылки HH, не employer_id"),
  collection: id.optional().describe("ID коллекции из collections, например response"),
  topic_id: id.optional().describe("ID отклика из applications; resume_id заранее не нужен"),
  state: z.enum(["active", "archived", "hidden"]).optional(),
  page: z.number().int().min(0).optional(),
  per_page: z.number().int().min(1).max(50).optional(),
  status: z.literal("active").optional(),
}).strict();
export const recruitmentCatalogSchema = recruitmentSchema.pick({
  action: true, vacancy_id: true, state: true, page: true, per_page: true,
}).extend({ action: z.enum(["context", "vacancies", "vacancy"]) });

export const applicationsSchema = z.object({
  action: z.enum(["collections", "list", "get"]),
  vacancy_id: id.describe("ОБЯЗАТЕЛЬНО: ID вакансии для каждого действия. Возьмите из hh_recruitment vacancy/vacancies или ссылки пользователя"),
  collection: id.optional().describe("ОБЯЗАТЕЛЬНО для action=list: ID коллекции из action=collections"),
  topic_id: id.optional().describe("ОБЯЗАТЕЛЬНО для action=get: ID отклика из action=list"),
  page: z.number().int().min(0).optional(),
  per_page: z.number().int().min(1).max(50).optional(),
  status: z.literal("active").optional(),
}).strict();

interface Page<T> { items: T[]; found?: number; page?: number; pages?: number; per_page?: number }
interface Application {
  id: string;
  created_at?: string;
  updated_at?: string;
  state?: unknown;
  resume?: unknown;
  vacancy?: { id: string; name?: string };
  chat_id?: string;
}
function vacancyCard(vacancy: Vacancy) {
  return { id: vacancy.id, name: vacancy.name, employer: vacancy.employer,
    url: vacancy.alternate_url, archived: vacancy.archived, counters: vacancy.counters,
    area: vacancy.area, salary: vacancy.salary };
}
function applicationCard(item: Application) {
  return { id: item.id, created_at: item.created_at, updated_at: item.updated_at,
    state: item.state, vacancy: item.vacancy, resume: item.resume ? searchCard(item.resume) : null,
    chat_id: item.chat_id ?? null };
}

/** Read-only employer workflow: listing applications never requires a resume ID or a write tool. */
export function createRecruitmentTool(request: typeof hhRequest) {
  return async (raw: z.input<typeof recruitmentSchema>): Promise<ToolContent> => {
    try {
      const input = recruitmentSchema.parse(raw);
      if (["vacancy", "collections", "applications", "application"].includes(input.action) && !input.vacancy_id) {
        return fail("Укажите vacancy_id. Список вакансий доступен через action=vacancies.");
      }
      if (input.action === "applications" && !input.collection) return fail("Сначала запросите action=collections и передайте ID нужной коллекции в collection. resume_id не требуется.");
      if (input.action === "application" && !input.topic_id) return fail("Укажите topic_id из action=applications.");
      const profile = await currentEmployer(request);
      const account = accountScope(profile);
      if (input.action === "context") return compact({ account, note: "Общее подключение относится к этому работодателю и менеджеру HH. Кабинет в браузере может быть другим." });
      const query = { page: input.page ?? 0, per_page: input.per_page ?? 10 };
      if (input.action === "vacancies") {
        const response = await request<Page<Vacancy>>("GET", `/employers/${encodeURIComponent(profile.employer.id)}/vacancies/${input.state ?? "active"}`, { query });
        return compact({ ...response, account, items: response.items.map(vacancyCard) });
      }
      const vacancy = await readVacancy(request, input.vacancy_id!);
      if (input.action === "vacancy") return compact({ ...vacancyCard(vacancy), account,
        belongs_to_connected_employer: vacancy.employer.id === profile.employer.id,
        private_access_blocked: vacancy.employer.id !== profile.employer.id,
        next_actions: vacancy.employer.id === profile.employer.id ? [{ tool: "hh_applications", arguments: { action: "collections", vacancy_id: vacancy.id } }] : [],
        description: vacancy.description, experience: vacancy.experience, employment: vacancy.employment, schedule: vacancy.schedule,
        access_note: vacancy.employer.id === profile.employer.id
          ? "Работодатель совпадает; доступ к откликам дополнительно проверяет HH для текущего менеджера."
          : "СТОП: это вакансия другого работодателя. Публичное описание доступно, её отклики и переписка требуют соответствующего подключения HH. Не повторяйте попытки чтения откликов/чатов до смены подключения.",
      });
      requireVacancyEmployer(profile, vacancy);
      if (input.action === "collections") return compact({ account, vacancy: vacancyCard(vacancy),
        data: await request("GET", "/negotiations", { query: { ...query, vacancy_id: vacancy.id, status: input.status } }),
      });
      if (input.action === "applications") {
        const response = await request<Page<Application>>("GET", `/negotiations/${encodeURIComponent(input.collection!)}`, {
          query: { ...query, vacancy_id: vacancy.id, status: input.status },
        });
        return compact({ ...response, account, vacancy: vacancyCard(vacancy), items: response.items.map(applicationCard) });
      }
      const application = await request<Application>("GET", `/negotiations/${encodeURIComponent(input.topic_id!)}`);
      if (application.vacancy?.id !== vacancy.id) return fail("Отклик не относится к указанной вакансии. Проверьте vacancy_id и topic_id.");
      return compact({ account, vacancy: vacancyCard(vacancy), application: applicationCard(application) });
    } catch (error) {
      return employerFailure(error);
    }
  };
}

export function createApplicationsTool(request: typeof hhRequest) {
  const recruitment = createRecruitmentTool(request);
  return async (raw: z.input<typeof applicationsSchema>): Promise<ToolContent> => {
    try {
      const input = applicationsSchema.parse(raw);
      return recruitment({ ...input,
        action: input.action === "list" ? "applications" : input.action === "get" ? "application" : "collections",
      });
    } catch (error) {
      return employerFailure(error);
    }
  };
}
