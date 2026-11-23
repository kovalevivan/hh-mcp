import type { hhRequest } from "../client/hh.js";
import { compact, failFromError, type ToolContent } from "../lib/result.js";

export interface Employer {
  id: string;
  name: string;
}
export interface EmployerProfile {
  id: string;
  employer: Employer;
  manager?: { id: string; has_admin_rights?: boolean };
}
export interface Vacancy {
  id: string;
  name: string;
  employer: Employer;
  alternate_url?: string;
  archived?: boolean;
  description?: string;
  counters?: unknown;
  area?: unknown;
  salary?: unknown;
  experience?: unknown;
  employment?: unknown;
  schedule?: unknown;
}

export class EmployerMismatch extends Error {
  constructor(readonly connected: Employer, readonly vacancy: Vacancy) {
    super(`Подключён работодатель «${connected.name}» (${connected.id}), а вакансия ${vacancy.id} принадлежит «${vacancy.employer.name}» (${vacancy.employer.id}). Для её откликов и чатов требуется подключение соответствующего работодателя.`);
  }
}

export async function currentEmployer(request: typeof hhRequest): Promise<EmployerProfile> {
  const profile = await request<EmployerProfile>("GET", "/me");
  if (!profile.employer?.id) throw new Error("Текущая авторизация HH не содержит работодателя. Проверьте подключённый аккаунт.");
  return { id: profile.id, employer: { id: profile.employer.id, name: profile.employer.name },
    manager: profile.manager ? { id: profile.manager.id, has_admin_rights: profile.manager.has_admin_rights } : undefined };
}

export async function readVacancy(request: typeof hhRequest, id: string): Promise<Vacancy> {
  const vacancy = await request<Vacancy>("GET", `/vacancies/${encodeURIComponent(id)}`);
  if (vacancy.id !== id || !vacancy.employer?.id) throw new Error("HH не вернул данные работодателя для указанной вакансии.");
  return { ...vacancy, employer: { id: vacancy.employer.id, name: vacancy.employer.name } };
}

export function requireVacancyEmployer(profile: EmployerProfile, vacancy: Vacancy): void {
  if (profile.employer.id !== vacancy.employer.id) throw new EmployerMismatch(profile.employer, vacancy);
}

export function accountScope(profile: EmployerProfile) {
  return { employer: profile.employer, manager_id: profile.manager?.id ?? null };
}

export function employerFailure(error: unknown): ToolContent {
  if (!(error instanceof EmployerMismatch)) return failFromError(error);
  return { ...compact({ error: {
    code: "HH_EMPLOYER_MISMATCH", message: error.message,
    connected_employer: error.connected, vacancy_id: error.vacancy.id,
    vacancy_employer: error.vacancy.employer,
    required_action: "Подключить в администрировании HH аккаунт работодателя этой вакансии. Это не доказательство ограничения тарифа или отсутствия откликов.",
  } }), isError: true };
}
