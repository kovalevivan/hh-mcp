/** HH form endpoints use repeated fields for arrays, not JSON strings. */
export function formParams(values: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!["string", "number", "boolean"].includes(typeof item)) {
        throw new Error(`Form field ${key} must contain scalar values`);
      }
      form.append(key, String(item));
    }
  }
  return form;
}
