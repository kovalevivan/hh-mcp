import { z } from "zod";
import type { hhRequest } from "../client/hh.js";
import { compact, fail, failFromError, type ToolContent } from "../lib/result.js";
import { accountScope, currentEmployer, readVacancy, requireVacancyEmployer, employerFailure } from "../employer/scope.js";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().min(1).max(20000).refine((value) => value.trim().length > 0);
const host = z.enum(["hh.ru", "rabota.by", "hh1.az", "hh.uz", "hh.kz", "headhunter.ge", "headhunter.kg"]);

export const chatsSchema = z.object({
  action: z.enum(["list", "messages", "participants", "unread"]),
  chat_id: id.optional().describe("ID чата из list, не ID отклика"),
  page: z.number().int().min(0).max(50).optional(),
  per_page: z.number().int().min(1).max(20).optional(),
  filter_unread: z.boolean().optional(),
  filter_has_text_message: z.boolean().optional(),
  vacancy_status: z.enum(["all", "with", "without"]).optional(),
  vacancy_ids: z.array(z.string().max(128).regex(/^\d+$/)).max(100).optional(),
  start_message_id: id.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  order: z.enum(["prev", "next"]).optional(),
  host: host.optional(),
  locale: z.enum(["RU", "EN"]).optional(),
}).strict();

export const chatStartSchema = z.object({
  resume_id: id.describe("ID/хэш выбранного резюме из HH"),
  confirm: z.boolean().default(false).describe("true только после согласия пользователя создать чат с этим кандидатом; действуют ограничения HH"),
}).strict();

export const chatSendSchema = z.object({
  chat_id: id,
  recipient_id: id.describe("ID участника APPLICANT из hh_chats participants"),
  recipient_name: z.string().min(1).max(500).describe("Имя соискателя из participants; показывается пользователю при подтверждении"),
  text: text.describe("Полный согласованный с пользователем текст сообщения"),
  idempotency_key: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
    .describe("UUID для одного сообщения. При повторе сохраняй этот ключ, chat_id и текст; после 409 не создавай новый ключ"),
  reply_to_message_id: id.optional(),
  confirm: z.boolean().default(false).describe("true только для подтверждённого пользователем получателя и точного текста"),
}).strict();

interface Participant {
  id: string;
  name: string;
  role: string | null;
}
interface ChatState {
  id: string;
  type: string;
  chat_states: { write_message_state: { allowed: boolean; reason?: string | null } };
}
interface ChatList { items: unknown[]; found: number; page: number; pages: number; per_page: number }

/** HH owns delivery idempotency; no generated key or automatic fallback can duplicate a message. */
export function createChatTools(request: typeof hhRequest) {
  return {
    async read(raw: z.input<typeof chatsSchema>): Promise<ToolContent> {
      try {
        const input = chatsSchema.parse(raw);
        const scope = { host: input.host, locale: input.locale };
        switch (input.action) {
          case "list": {
            const profile = await currentEmployer(request);
            for (const vacancyId of input.vacancy_ids ?? []) {
              requireVacancyEmployer(profile, await readVacancy(request, vacancyId));
            }
            const response = await request<ChatList>("GET", "/common/chats", { query: {
              ...scope, page: input.page ?? 0, per_page: input.per_page ?? 10,
              filter_unread: input.filter_unread,
              filter_has_text_message: input.filter_has_text_message,
              vacancy_status: input.vacancy_status,
              filter_with_vacancy_ids: input.vacancy_ids ? `[${input.vacancy_ids.join(",")}]` : undefined,
            } });
            return compact({ ...response, account: accountScope(profile),
              diagnostic_note: "Пустой список относится к подключённому работодателю и текущему менеджеру HH. Он не доказывает отсутствие откликов, переписки в другом кабинете или ограничение тарифа. Для откликов используйте hh_applications collections/list с обязательным vacancy_id.",
            });
          }
          case "unread": {
            const profile = await currentEmployer(request);
            return compact({ ...await request<{ unread_chats_count: string }>("GET", "/common/chats/counters/unread", { query: scope }), account: accountScope(profile) });
          }
          case "participants":
          case "messages": {
            if (!input.chat_id) return fail("Укажите chat_id из списка чатов HH.");
            const query = input.action === "messages" ? {
              ...scope, limit: input.limit ?? 10, order: input.order ?? "prev",
              start_message_id: input.start_message_id,
            } : scope;
            return compact(await request("GET", `/common/chats/${encodeURIComponent(input.chat_id)}/${input.action}`, { query }));
          }
        }
      } catch (error) {
        return employerFailure(error);
      }
    },
    async start(raw: z.input<typeof chatStartSchema>): Promise<ToolContent> {
      try {
        const input = chatStartSchema.parse(raw);
        if (!input.confirm) return fail("Сначала получите согласие пользователя на создание чата с выбранным кандидатом. Затем передайте confirm=true.");
        // Never combine creation and delivery: the message has its own reviewable call.
        return compact(await request("POST", "/common/chats/without_vacancy", {
          body: { resume_hash: input.resume_id },
        }));
      } catch (error) {
        return failFromError(error);
      }
    },
    async send(raw: z.input<typeof chatSendSchema>): Promise<ToolContent> {
      try {
        const input = chatSendSchema.parse(raw);
        if (!input.confirm) return fail("Сначала покажите получателя и полный текст пользователю и получите подтверждение. Затем передайте confirm=true.");
        const path = `/common/chats/${encodeURIComponent(input.chat_id)}`;
        const [chat, participants] = await Promise.all([
          request<ChatState>("GET", `${path}/messages`, { query: { limit: 1, order: "prev" } }),
          request<{ items: Participant[] }>("GET", `${path}/participants`),
        ]);
        if (chat.id !== input.chat_id || !["NEGOTIATION", "COMMON"].includes(chat.type)) {
          return fail("Не удалось подтвердить чат с кандидатом. Проверьте chat_id и участников.");
        }
        const applicants = participants.items.filter((participant) => participant.role === "APPLICANT");
        if (applicants.length !== 1 || applicants[0].id !== input.recipient_id || applicants[0].name !== input.recipient_name) {
          return fail("Получатель не совпадает с участником чата. Повторно проверьте participants и согласуйте получателя.");
        }
        if (chat.chat_states?.write_message_state?.allowed !== true) {
          return fail(`HH не разрешает писать в этот чат: ${chat.chat_states?.write_message_state?.reason ?? "отправка недоступна"}.`);
        }
        const response = await request<{ id: string }>("POST", `${path}/messages`, { body: {
          text: input.text,
          idempotency_key: input.idempotency_key,
          is_automated: true,
          ...(input.reply_to_message_id ? { reply_to_message_id: input.reply_to_message_id } : {}),
        } });
        return compact({ status: "sent", chat_id: input.chat_id, message_id: response.id,
          idempotency_key: input.idempotency_key });
      } catch (error) {
        return failFromError(error);
      }
    },
  };
}
