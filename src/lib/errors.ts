export class HhApiError extends Error {
  status: number;
  endpoint: string;
  body: unknown;

  constructor(opts: { status: number; endpoint: string; message: string; body?: unknown }) {
    super(opts.message);
    this.name = "HhApiError";
    this.status = opts.status;
    this.endpoint = opts.endpoint;
    this.body = opts.body;
  }
}

export function describeHhError(err: unknown): string {
  if (err instanceof HhApiError) {
    let detail = "";
    if (err.body && typeof err.body === "object") {
      const b = err.body as { description?: string; errors?: unknown; detail?: unknown };
      const parts: string[] = [];
      if (b.description) parts.push(b.description);
      if (b.errors) parts.push(JSON.stringify(b.errors));
      if (b.detail) parts.push(JSON.stringify(b.detail));
      detail = (parts.length ? parts.join(" | ") : JSON.stringify(b)).slice(0, 1000);
    }
    return `hh ${err.endpoint} → HTTP ${err.status}: ${err.message}${detail ? ` | ${detail}` : ""}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
