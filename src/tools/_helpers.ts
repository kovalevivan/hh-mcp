import { hhRequest } from "../client/hh.js";

/**
 * Get current employer_id from /me. Used as fallback when caller didn't pass employer_id.
 */
export async function getCurrentEmployerId(): Promise<string> {
  const me = (await hhRequest("GET", "/me")) as { employer?: { id?: string } };
  const id = me.employer?.id;
  if (!id) throw new Error("employer_id not found in /me — нужен авторизованный работодатель");
  return id;
}

/**
 * Resolve {employer_id, manager_id} from /me when caller didn't pass them.
 */
export async function getCurrentEmployerAndManager(): Promise<{
  employer_id: string;
  manager_id: string;
}> {
  const me = (await hhRequest("GET", "/me")) as {
    employer?: { id?: string };
    manager?: { id?: string };
  };
  const employer_id = me.employer?.id;
  const manager_id = me.manager?.id;
  if (!employer_id) throw new Error("employer_id not found in /me");
  if (!manager_id) throw new Error("manager_id not found in /me");
  return { employer_id, manager_id };
}
