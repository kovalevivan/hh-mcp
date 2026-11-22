import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { authSchema, managedAuthSchema, authTool } from "./tools/auth.js";
import { isAdminManaged } from "./lib/auth.js";
import { dictionariesSchema, dictionariesTool } from "./tools/dictionaries.js";
import { suggestsSchema, suggestsTool } from "./tools/suggests.js";
import { employerInfoSchema, employerInfoTool } from "./tools/employer_info.js";
import {
  employerVacanciesSchema,
  employerVacanciesTool,
} from "./tools/employer_vacancies.js";
import {
  employerNegotiationsSchema,
  employerNegotiationsTool,
} from "./tools/employer_negotiations.js";
import {
  employerResumesSchema,
  employerResumesTool,
} from "./tools/employer_resumes.js";
import { salarySchema, salaryTool } from "./tools/salary.js";
import { webhooksSchema, webhooksTool } from "./tools/webhooks.js";
import { failFromError, type ToolContent } from "./lib/result.js";
import type { ResumeDetails } from "./resumes/details.js";

export const SERVER_NAME = "hh-mcp";
export const SERVER_VERSION = "0.1.1";

export function createServer(): McpServer {
  return new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description: "MCP server for HeadHunter (hh.kz / hh.ru) employer API",
  });
}

export function wrap(
  name: string,
  fn: (input: any) => Promise<ToolContent>,
  log: (message: string) => void = console.error,
) {
  return async (input: any) => {
    const start = Date.now();
    try {
      const result = await fn(input);
      if (result.isError) {
        // Log status and endpoint only: tool output can contain personal data or tokens.
        const text = result.content.map((item) => item.text).join("\n");
        const hh = text.match(/hh ([A-Z]+ \/[^\s?]+) → HTTP (\d{3})/);
        log(`[TOOL] ${name} ERROR (${Date.now() - start}ms): ${
          hh ? `hh ${hh[1]} HTTP ${hh[2]}` : "tool returned isError=true"
        }`);
      } else {
        log(`[TOOL] ${name} OK (${Date.now() - start}ms)`);
      }
      return result;
    } catch (err) {
      log(`[TOOL] ${name} ERROR (${Date.now() - start}ms): handler threw`);
      return failFromError(err);
    }
  };
}

export function registerTools(server: McpServer, options?: { resumeDetails: ResumeDetails }): void {
  server.tool(
    "hh_auth",
    isAdminManaged()
      ? "HeadHunter account status and current profile. Manage the shared account in LibreChat administration."
      : "HH OAuth: get_auth_url (получить ссылку для авторизации работодателя), exchange_code (обменять code на токены), refresh, me (текущий пользователь), set_tokens (вручную проставить), logout, status. Токены персистятся в ~/.hh-mcp/tokens.json.",
    (isAdminManaged() ? managedAuthSchema : authSchema).shape,
    {
      readOnlyHint: isAdminManaged(),
      destructiveHint: false,
      openWorldHint: true,
    },
    wrap("hh_auth", authTool),
  );

  server.tool(
    "hh_dictionaries",
    "Публичные справочники HH (без OAuth): dictionaries, areas (регионы), area, professional_roles, industries, languages, metro, metro_city, locales, currencies, educational_institutions. Нужны для составления фильтров и payload вакансий.",
    dictionariesSchema.shape,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    wrap("hh_dictionaries", dictionariesTool),
  );

  server.tool(
    "hh_suggests",
    "Публичные подсказки HH: areas, professional_roles, positions, companies, skill_set, fields_of_study, vacancy_search_keyword, area_leaves (также прежний alias areas_leaves), educational_institutions. organizations и registered_companies не поддерживаются публичным API.",
    suggestsSchema.shape,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    wrap("hh_suggests", suggestsTool),
  );

  server.tool(
    "hh_employer_info",
    "Информация о работодателе (employer OAuth): me, get, search, managers_list/get, manager_types, addresses_list/get, departments_list, vacancy_areas, vacancy_branded_templates.",
    employerInfoSchema.shape,
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    wrap("hh_employer_info", employerInfoTool),
  );

  server.tool(
    "hh_employer_vacancies",
    "Вакансии работодателя: search (публичный поиск), get/similar, active_list/archived_list/hidden_list, CRUD (create/update/delete), archive/prolongate/hide/unhide, черновики (drafts_list/get/create/update/delete/publish), stats. Большая часть требует employer OAuth.",
    employerVacanciesSchema.shape,
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    wrap("hh_employer_vacancies", employerVacanciesTool),
  );

  server.tool(
    "hh_employer_negotiations",
    "Отклики и приглашения HH. collections/list/active_topics требуют vacancy_id; active_topics возвращает активные коллекции. get, mark_read, messages_list/message_send, move_to_collection/change_action. templates_list/message_template_get требуют template, для списка шаблонов компании — mail_templates_list. preference_order_get/set требуют vacancy_id; set требует body.order. statistics — статистика компании (с vacancy_id — статистика вакансии); statistics_manager — статистика откликов менеджера. candidate_test_solution/test_results — результаты теста. invite может списать контакт по правилам HH: выполняй только по явному запросу пользователя.",
    employerNegotiationsSchema.shape,
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    wrap("hh_employer_negotiations", employerNegotiationsTool),
  );

  server.tool(
    "hh_employer_resumes",
    "Резюме HH. search: компактные карточки — ID, ссылка, должность, город, зарплата, обновление, вся история работы (компания, отрасли, должность, даты), без описаний и служебных объектов. Сначала отбирай перспективных кандидатов по карточкам; только для них вызывай get. get: профессиональные описания работы и навыки без контактов, confirm не требуется; длинный текст выдаётся частями text, part/parts_total, has_more и next_cursor. Если has_more=true, продолжай через аргументы next до конца, не считай первую часть полным резюме. Продолжения используют временный снимок в памяти без повторного обращения к HH; если он истёк — начни get заново и не смешивай старые части с новыми. HH может ограничивать поля и число просмотров; can_view_full_info=false не означает отсутствия профессионального текста. Также: negotiations_history, available_resume_search_criteria, saved_searches CRUD, applicant_comments CRUD.",
    employerResumesSchema.shape,
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    wrap("hh_employer_resumes", (input) => employerResumesTool(input, options?.resumeDetails)),
  );

  server.tool(
    "hh_salary",
    "Аналитика зарплат HH: evaluation (оценка для конкретной вакансии по area + professional_role/experience/employee_level), плюс справочники industries/professional_areas/employee_levels/areas. Полезно при создании вакансий и переговорах об оффере.",
    salarySchema.shape,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    wrap("hh_salary", salaryTool),
  );

  server.tool(
    "hh_webhooks",
    "Webhook-подписки работодателя для real-time событий (новый отклик, изменение состояния и т.д.): list, subscribe, update, unsubscribe. Требует публичный HTTPS-URL приёмника (например, hiring-bot на Railway).",
    webhooksSchema.shape,
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    wrap("hh_webhooks", webhooksTool),
  );
}
