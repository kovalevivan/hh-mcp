# hh-mcp

MCP-сервер для HeadHunter API (hh.kz / hh.ru), сфокусирован на **работодательской** части: свои вакансии, отклики, поиск резюме, профиль и менеджеры. Реализует стандартный MCP-протокол — работает из Claude Code, Claude Desktop, Cursor, Continue, Cline, claude.ai-коннекторов и из любых скриптов через stdio или HTTP.

> **Статус:** v0.1 — employer-side MVP. Applicant-side, webhooks и Railway-дистрибуция — на roadmap.

## Что внутри

Девять tools:

| Tool | Auth | Что делает |
|---|---|---|
| `hh_auth` | OAuth flow | `get_auth_url`, `exchange_code`, `refresh`, `me`, `set_tokens`, `logout`, `status` |
| `hh_dictionaries` | public | `areas`, `professional_roles`, `industries`, `languages`, `metro`, `dictionaries`, `currencies`, `locales`, `educational_institutions` |
| `hh_suggests` | public | autocompletion: `positions`, `areas`, `companies`, `skill_set`, `vacancy_search_keyword`, и т.д. |
| `hh_salary` | public | `evaluation` (оценка зарплаты по area + role + level), словари `industries`/`professional_areas`/`employee_levels`/`areas` |
| `hh_employer_info` | employer OAuth | `me`, `get`, `managers_list/get`, `addresses_list/get`, `departments`, `vacancy_areas`, `vacancy_branded_templates`, `blacklisted` |
| `hh_employer_vacancies` | employer OAuth | `active_list`/`archived_list`/`hidden_list`, CRUD, `archive/restore/prolongate/hide/unhide`, drafts CRUD + `draft_publish`/`draft_duplicates`, `stats`, `visitors`, `available_services`, `upgrade_list`, `related`, `prolongation_info`, `disable_auto_publication`, плюс публичный `search`/`get`/`similar` |
| `hh_employer_negotiations` | employer OAuth | **`invite`** (приглашение кандидата на вакансию), `collections`, `list`, `get`, `mark_read`, `messages_list/send`, `history`, `move_to_collection`/`change_action`, `view`, `templates_list`/`message_template_get`/`mail_templates_list`/`mail_template_update`, `preference_order_get/set`, `statistics`/`statistics_manager`, `active_topics`, `ignore_list`, `candidate_test_solution`/`test_results` |
| `hh_employer_resumes` | employer OAuth (paid) | `search`, `get` (требует `confirm: true` — тратит контакт!), `views_list`, `negotiations_history`, **saved searches CRUD** (`list/get/create/update/delete/move_manager`), **applicant comments CRUD** (`list/add/update/delete` — заметки команды о кандидате), `mine_invitations`, `available_resume_search_criteria` |
| `hh_webhooks` | employer OAuth | `list`, `subscribe`, `update`, `unsubscribe` — real-time события (NEW_NEGOTIATION, NEGOTIATION_FEEDBACK и др.). Требует публичный HTTPS-URL приёмника. |

## Что нужно для запуска

1. **OAuth-приложение работодателя** на [dev.hh.kz/admin](https://dev.hh.kz/admin) (или dev.hh.ru/admin) — оттуда взять `client_id` и `client_secret`.
2. **Node.js ≥18**.
3. Email для `User-Agent` (HH требует контакт в заголовке).

## Установка

```bash
git clone https://github.com/mardanaltynbekov1104/hh-mcp.git ~/apps/hh-mcp
cd ~/apps/hh-mcp
npm install
cp .env.example .env
# отредактируй .env — поставь HH_CLIENT_ID, HH_CLIENT_SECRET, HH_USER_AGENT
```

## Подключение

### Claude Code / Claude Desktop / Cursor / Continue / Cline (stdio)

`~/.claude/.mcp.json` (или project-level `.mcp.json`, или Cursor `~/.cursor/mcp.json` — формат одинаковый):

```json
{
  "mcpServers": {
    "hh": {
      "command": "npx",
      "args": ["tsx", "/Users/you/apps/hh-mcp/src/index.ts"],
      "env": {
        "HH_CLIENT_ID": "ВАШ_CLIENT_ID",
        "HH_CLIENT_SECRET": "ВАШ_CLIENT_SECRET",
        "HH_USER_AGENT": "hh-mcp/0.1.0 (your@email.com)"
      }
    }
  }
}
```

Перезапусти клиент — должно появиться 7 tools (`hh_auth`, `hh_dictionaries`, …).

### HTTP-режим (claude.ai-коннектор, hiring-bot, кастомные клиенты)

```bash
npm run start:http
# или с авторизацией:
MCP_AUTH_TOKEN=secret npm run start:http
```

- `POST http://localhost:3400/mcp` — Streamable HTTP MCP endpoint.
- `GET  http://localhost:3400/health` — `{"status":"ok"}`.

В claude.ai → Settings → Connectors → Add custom connector → URL `https://your-host/mcp`.

## OAuth-флоу (первый запуск)

1. Запусти MCP, в клиенте вызови `hh_auth action=get_auth_url`.
2. Открой полученный URL в браузере — там будет `https://hh.kz/oauth/authorize?...`.
3. Авторизуйся под аккаунтом работодателя hh.kz/hh.ru.
4. HH редиректит на `redirect_uri`. По умолчанию `urn:ietf:wg:oauth:2.0:oob` — это значит код покажется прямо на странице hh. Скопируй параметр `code`.
5. Вызови `hh_auth action=exchange_code code=<код>` — токены сохранятся в `~/.hh-mcp/tokens.json` (`chmod 600`).
6. Проверь: `hh_auth action=me` — должно вернуть профиль с `employer.id` и `manager.id`.

Дальше все employer-tools работают. На `401` MCP сам сделает refresh.

## Примеры

```
# Поиск вакансий (публично)
hh_employer_vacancies action=search query={"text":"врач-эндокринолог","area":"160","per_page":20}
# area=160 — Алматы. Найти id: hh_dictionaries action=areas или hh_suggests action=areas text="алматы"

# Список своих активных вакансий
hh_employer_vacancies action=active_list

# Отклики по конкретной вакансии
hh_employer_negotiations action=list vacancy_id=12345678

# Ответить кандидату
hh_employer_negotiations action=message_send topic_id=987654 message="Здравствуйте, готов(а) ли вы пройти короткое интервью в Zoom?"

# Подвинуть отклик в «рассматриваем»
hh_employer_negotiations action=move_to_collection topic_id=987654 collection=consider

# Продлить вакансию
hh_employer_vacancies action=prolongate vacancy_id=12345678

# Поиск резюме (employer paid)
hh_employer_resumes action=search query={"text":"эндокринолог","area":"160","experience":"between3And6"}

# Открыть резюме (тратит контакт!)
hh_employer_resumes action=get resume_id=abcdef0123456789 confirm=true

# Пригласить найденного кандидата на свою вакансию (sourcing)
hh_employer_negotiations action=invite resume_id=abc... vacancy_id=12345678 message="Здравствуйте, посмотрите нашу вакансию — кажется, у нас совпадение по навыкам и зарплате. Можем созвониться завтра в 15:00?"

# Сохранить поисковый запрос на регулярный сорсинг
hh_employer_resumes action=saved_search_create query={"text":"эндокринолог","area":"160","experience":"between3And6","period":"7"}

# Записать заметку о кандидате (для команды HR)
hh_employer_resumes action=applicant_comment_add applicant_id=123456789 body={"text":"Очень понравился на скрине, договорились о финальном этапе в пятницу"}

# Подписаться на webhook новых откликов
hh_webhooks action=subscribe body={"webhook_event":"NEW_NEGOTIATION","url":"https://hiring-bot.example.com/hh/webhook","secret_key":"$(openssl rand -hex 16)"}

# Оценка рыночной зарплаты при создании вакансии
hh_salary action=evaluation area_id=160 query={"professional_role":["24"],"employee_level":"middle","experience":"between3And6"}
```

## ENV

| Переменная | Назначение | Обязательна |
|---|---|---|
| `HH_CLIENT_ID` | OAuth client id с dev.hh.kz | да (для employer-tools) |
| `HH_CLIENT_SECRET` | OAuth client secret | да |
| `HH_USER_AGENT` | `hh-mcp/0.1.0 (email@example.com)` — HH требует контакт | да |
| `HH_REDIRECT_URI` | OAuth callback, default `urn:ietf:wg:oauth:2.0:oob` | нет |
| `HH_AUTH_BASE` | default `https://hh.kz` (для hh.ru — `https://hh.ru`) | нет |
| `HH_API_BASE` | default `https://api.hh.ru` | нет |
| `HH_ACCESS_TOKEN` | можно стартовать с готовым токеном | нет |
| `HH_REFRESH_TOKEN` | можно стартовать с готовым refresh | нет |
| `MCP_AUTH_TOKEN` | Bearer для HTTP-режима (защита `/mcp`) | нет |

## Roadmap (v0.2+)

- `hh_chats` — новый chat API HH (`/common/chats/*`), который заменяет deprecated `/negotiations/{id}/messages`. CRUD сообщений, файлы, участники, unread-counter.
- `hh_billing` — `payable_api_method_access`, `payable_api_actions/active` (проверка платных услуг работодателя).
- Applicant-side tools (резюме соискателя, отклики на чужие вакансии, авто-отклики).
- Tests dictionary (`/tests`) и привязка тестов к вакансиям.
- Manager_accounts/mine (управление мульти-аккаунтом менеджера).
- `clickme/statistics` (рекламные кампании HH).
- Railway-хостинг + curl-installer + DXT (как у [bitrix24-mcp](https://github.com/mardanaltynbekov1104/bitrix24-mcp)).
- Тесты на vitest.
- Авто-генерация типов из `https://api.hh.ru/openapi/specification/public`.

## Changelog

**v0.1.1** — sourcing essentials: `hh_employer_negotiations.invite` (приглашение кандидата на вакансию), saved searches CRUD, applicant comments CRUD, `hh_employer_vacancies.visitors`, новые tools `hh_salary` и `hh_webhooks`. 9 tools, 70+ actions, полное покрытие employer workflow кроме нового chat API.

**v0.1.0** — initial release. 7 tools, employer-side baseline.

## Связанные проекты

- [bitrix24-mcp](https://github.com/mardanaltynbekov1104/bitrix24-mcp) — MCP для Bitrix24 CRM.

## Лицензия

MIT — см. [LICENSE](LICENSE).
