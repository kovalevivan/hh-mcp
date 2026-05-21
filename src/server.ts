import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { authSchema, authTool } from "./tools/auth.js";
import { dictionariesSchema, dictionariesTool } from "./tools/dictionaries.js";
import { suggestsSchema, suggestsTool } from "./tools/suggests.js";
import { employerInfoSchema, employerInfoTool } from "./tools/employer_info.js";
import { employerVacanciesSchema, employerVacanciesTool } from "./tools/employer_vacancies.js";
import { employerNegotiationsSchema, employerNegotiationsTool } from "./tools/employer_negotiations.js";
import { employerResumesSchema, employerResumesTool } from "./tools/employer_resumes.js";
import { salarySchema, salaryTool } from "./tools/salary.js";
import { webhooksSchema, webhooksTool } from "./tools/webhooks.js";

export const SERVER_NAME = "hh-mcp";
export const SERVER_VERSION = "0.1.1";

export function createServer(): McpServer {
  return new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    description: "MCP server for HeadHunter (hh.kz / hh.ru) employer API",
  });
}

function wrap(name: string, fn: (input: any) => Promise<any>) {
  return async (input: any) => {
    const start = Date.now();
    try {
      const result = await fn(input);
      console.error(`[TOOL] ${name} OK (${Date.now() - start}ms)`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[TOOL] ${name} ERROR (${Date.now() - start}ms):`, message);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
  };
}

export function registerTools(server: McpServer): void {
  server.tool(
    "hh_auth",
    "HH OAuth: get_auth_url (получить ссылку для авторизации работодателя), exchange_code (обменять code на токены), refresh, me (текущий пользователь), set_tokens (вручную проставить), logout, status. Токены персистятся в ~/.hh-mcp/tokens.json.",
    authSchema.shape,
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    wrap("hh_auth", authTool)
  );

  server.tool(
    "hh_dictionaries",
    "Публичные справочники HH (без OAuth): dictionaries, areas (регионы), area, professional_roles, industries, languages, metro, metro_city, locales, currencies, educational_institutions. Нужны для составления фильтров и payload вакансий.",
    dictionariesSchema.shape,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    wrap("hh_dictionaries", dictionariesTool)
  );

  server.tool(
    "hh_suggests",
    "Публичные suggest-эндпоинты HH: areas, professional_roles, positions, companies, organizations, skill_set, fields_of_study, vacancy_search_keyword, registered_companies, areas_leaves, educational_institutions. Используется для автодополнения и нормализации.",
    suggestsSchema.shape,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    wrap("hh_suggests", suggestsTool)
  );

  server.tool(
    "hh_employer_info",
    "Информация о работодателе (employer OAuth): me, get, search, managers_list/get, manager_types, addresses_list/get, departments_list, vacancy_areas, vacancy_branded_templates, blacklisted.",
    employerInfoSchema.shape,
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    wrap("hh_employer_info", employerInfoTool)
  );

  server.tool(
    "hh_employer_vacancies",
    "Вакансии работодателя: search (публичный поиск), get/similar, active_list/archived_list/hidden_list, CRUD (create/update/delete), archive/restore/prolongate/hide/unhide, черновики (drafts_list/get/create/update/delete/publish), stats. Большая часть требует employer OAuth.",
    employerVacanciesSchema.shape,
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    wrap("hh_employer_vacancies", employerVacanciesTool)
  );

  server.tool(
    "hh_employer_negotiations",
    "Отклики, приглашения, переписка и сорсинг работодателя. Главное: invite (POST /negotiations/phone_interview — пригласить кандидата на свою вакансию из найденного резюме). Также: collections, list, get, mark_read, messages_list/send (старый API, deprecated), history, move_to_collection / change_action (одиночное действие), view, templates_list / message_template_get / mail_templates_list / mail_template_update, preference_order_get/set, statistics (vacancy-level) / statistics_manager, active_topics, ignore_list, candidate_test_solution, test_results.",
    employerNegotiationsSchema.shape,
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    wrap("hh_employer_negotiations", employerNegotiationsTool)
  );

  server.tool(
    "hh_employer_resumes",
    "Поиск резюме работодателем (платный) + сорсинг: search, get (требует confirm=true — тратит контакт!), views_list, negotiations_history, saved_searches CRUD (list/get/create/update/delete/move_manager), applicant_comments CRUD (list/add/update/delete — заметки команды о кандидате), mine_invitations, available_resume_search_criteria.",
    employerResumesSchema.shape,
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    wrap("hh_employer_resumes", employerResumesTool)
  );

  server.tool(
    "hh_salary",
    "Аналитика зарплат HH: evaluation (оценка для конкретной вакансии по area + professional_role/experience/employee_level), плюс справочники industries/professional_areas/employee_levels/areas. Полезно при создании вакансий и переговорах об оффере.",
    salarySchema.shape,
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    wrap("hh_salary", salaryTool)
  );

  server.tool(
    "hh_webhooks",
    "Webhook-подписки работодателя для real-time событий (новый отклик, изменение состояния и т.д.): list, subscribe, update, unsubscribe. Требует публичный HTTPS-URL приёмника (например, hiring-bot на Railway).",
    webhooksSchema.shape,
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    wrap("hh_webhooks", webhooksTool)
  );
}
