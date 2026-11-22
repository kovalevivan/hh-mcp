import { randomUUID } from "node:crypto";
import type { hhRequest } from "../client/hh.js";
import { professionalText, professionalMetadata, splitProfessionalText, type ResumeObject } from "./presentation.js";

export interface DetailOptions { partChars: number; ttlSeconds: number; maxBytes: number; maxEntries: number; }
interface Snapshot { id: string; revision: number; created: number; metadata: ResumeObject; parts: string[]; bytes: number; partChars: number; }

/** Short-lived RAM snapshots only for serving consistent continuation parts; no files or view history. */
export class ResumeDetails {
  private snapshots = new Map<string, Snapshot>();
  constructor(private request: typeof hhRequest, private revision: () => number, private options: DetailOptions, private now = Date.now) {}
  private clean(): void {
    for (const [key, value] of this.snapshots) if (value.revision !== this.revision() || this.now() - value.created >= this.options.ttlSeconds * 1000) this.snapshots.delete(key);
  }
  private response(key: string, snapshot: Snapshot, index: number): ResumeObject {
    const nextCursor = index + 1 < snapshot.parts.length ? `${key}.${index + 1}` : null;
    return { ...snapshot.metadata, text: snapshot.parts[index], part: index + 1, parts_total: snapshot.parts.length,
      has_more: nextCursor !== null, next_cursor: nextCursor,
      next: nextCursor ? { action: "get", resume_id: snapshot.id, cursor: nextCursor } : null };
  }
  async get(id: string, cursor?: string, maxChars?: number): Promise<ResumeObject> {
    if (!id) throw new Error("resume_id is required");
    this.clean();
    if (cursor) {
      const match = /^([a-f0-9-]{36})\.(\d+)$/.exec(cursor), index = Number(match?.[2]);
      const snapshot = match ? this.snapshots.get(match[1]) : undefined;
      if (!snapshot || snapshot.id !== id || !Number.isSafeInteger(index) || index < 1 || index >= snapshot.parts.length) {
        throw new Error("Resume continuation expired or is invalid for this account/resume. Restart action=get without cursor; do not combine parts from different reads.");
      }
      if (maxChars !== undefined && maxChars !== snapshot.partChars) throw new Error("Do not change max_chars while continuing a resume; use next arguments as returned");
      return this.response(match![1], snapshot, index);
    }
    const size = maxChars ?? this.options.partChars;
    if (!Number.isInteger(size) || size < 1000 || size > 20000) throw new Error("max_chars must be an integer from 1000 to 20000");
    const revision = this.revision();
    const resume = await this.request<ResumeObject>("GET", `/resumes/${encodeURIComponent(id)}`);
    if (revision !== this.revision()) throw new Error("HH account changed during resume read; retry with the current account");
    if (resume.id !== id) throw new Error("HH returned an unexpected resume ID");
    const text = professionalText(resume), parts = splitProfessionalText(text, size), key = randomUUID();
    const snapshot: Snapshot = { id, revision, created: this.now(), metadata: professionalMetadata(resume), parts,
      bytes: Buffer.byteLength(text, "utf8"), partChars: size };
    if (parts.length > 1) {
      if (snapshot.bytes > this.options.maxBytes) throw new Error("Resume exceeds the configured continuation memory budget; no text was silently truncated");
      let used = [...this.snapshots.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      while (this.snapshots.size >= this.options.maxEntries || used + snapshot.bytes > this.options.maxBytes) {
        const oldest = this.snapshots.entries().next().value;
        if (!oldest) break;
        used -= oldest[1].bytes; this.snapshots.delete(oldest[0]);
      }
      this.snapshots.set(key, snapshot);
    }
    return this.response(key, snapshot, 0);
  }
}
