# hh-mcp

MCP-сервер для HeadHunter API (hh.kz / hh.ru), сфокусирован на **работодательской** части: свои вакансии, отклики, поиск резюме, профиль и менеджеры. Реализует стандартный MCP-протокол — работает из Claude Code, Claude Desktop, Cursor, Continue, Cline, claude.ai-коннекторов и из любых скриптов через stdio или HTTP.

> **Статус:** v0.1 — employer-side MVP. Applicant-side, webhooks и Railway-дистрибуция — на roadmap.

## Что внутри

Семь tools:

| Tool | Auth | Что делает |
|---|---|---|
| `hh_auth` | OAuth flow | `get_auth_url`, `exchange_code`, `refresh`, `me`, `set_tokens`, `logout`, `status` |
| `hh_dictionaries` | public | `areas`, `professional_roles`, `industries`, `languages`, `metro`, `dictionaries`, `currencies`, `locales`, `educational_institutions` |
| `hh_suggests` | public | autocompletion: `positions`, `areas`, `companies`, `skill_set`, `vacancy_search_keyword`, и т.д. |
| `hh_employer_info` | employer OAuth | `me`, `get`, `managers_list/get`, `addresses_list/get`, `departments`, `vacancy_areas`, `vacancy_branded_templates`, `blacklisted` |
| `hh_employer_vacancies` | employer OAuth | `active_list`/`archived_list`/`hidden_list`, CRUD, `archive/restore/prolongate/hide/unhide`, drafts CRUD + `draft_publish`, `stats`, плюс публичный `search`/`get`/`similar` |
| `hh_employer_negotiations` | employer OAuth | `collections`, `list`, `get`, `messages_list/send`, `history`, `move_to_collection`, `view`, `templates_list`, `statistics`, `active_topics`, `ignore_list` |
| `hh_employer_resumes` | employer OAuth (paid) | `search`, `get` (требует `confirm: true` — тратит контакт!), `views_list`, `mine_invitations`, `saved_searches_*` |

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

- Applicant-side tools (резюме соискателя, отклики на чужие вакансии).
- Webhooks (нужен публичный URL для приёмника).
- Railway-хостинг + curl-installer + DXT (как у [bitrix24-mcp](https://github.com/mardanaltynbekov1104/bitrix24-mcp)).
- Тесты на vitest.
- Авто-генерация типов из `https://api.hh.ru/openapi/specification/public`.

## Связанные проекты

- [bitrix24-mcp](https://github.com/mardanaltynbekov1104/bitrix24-mcp) — MCP для Bitrix24 CRM.

## Лицензия

MIT — см. [LICENSE](LICENSE).
