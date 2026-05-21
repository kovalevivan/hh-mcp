import { describeHhError } from "./errors.js";

export type ToolContent = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function ok(value: unknown, header?: string): ToolContent {
  const text =
    typeof value === "string"
      ? value
      : (header ? header + "\n" : "") + JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

export function fail(message: string): ToolContent {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export function failFromError(err: unknown): ToolContent {
  return fail(describeHhError(err));
}
