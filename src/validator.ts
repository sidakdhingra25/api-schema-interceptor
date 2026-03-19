import type { AnySchema, FieldError } from "./types";

/**
 * Validate `data` against a schema with a safeParse method.
 * Returns a list of field-level errors (empty if valid).
 */
export function validate(schema: AnySchema | undefined, data: unknown): FieldError[] {
  if (!schema || typeof schema.safeParse !== "function") {
    return [];
  }

  const result = schema.safeParse(data);
  if (result.success || !result.error) return [];

  const typeOfValue = (value: unknown): string => {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    const t = typeof value;
    return t;
  };

  return result.error.errors.map((issue) => {
    // expected:
    // - Zod invalid_type issues carry `expected` (e.g. "string")
    // - Zod invalid_format issues carry `format` (e.g. "email", "uuid")
    // - otherwise we fall back to "unknown" and let the logger use issue.message
    const expected: string =
      typeof issue.expected === "string"
        ? issue.expected
        : typeof issue.format === "string"
          ? issue.format
          : typeof issue.validation === "string"
            ? issue.validation
            : "unknown";

    // received priority (explicit):
    // 1. If Zod provides issue.received, use it directly.
    // 2. Otherwise, infer from the runtime value at `issue.path` (with improved null/array handling).
    // 3. If we still cannot infer, use "unknown".
    //
    // Note: Zod invalid_format issues don't provide received/expected, but we want log output
    // to detect the format case via `received === expected`. So for `format` issues, we set
    // received to the same format label.
    let received: string;

    if (typeof issue.received === "string") {
      received = issue.received;
    } else {
      const receivedValue = issue.path.reduce<unknown>((obj, key) => {
        if (obj !== null && typeof obj === "object") {
          return (obj as Record<string | number, unknown>)[key];
        }
        return undefined;
      }, data);

      const inferred = typeOfValue(receivedValue);
      // For `invalid_format` issues, we intentionally set `received === expected` so
      // the logger can render "invalid format — expected a valid ${expected}".
      received = typeof issue.format === "string" ? issue.format : inferred;
    }

    return {
      path: issue.path as (string | number)[],
      received,
      expected,
      message: issue.message,
    };
  });
}
