import type { AnySchema, FieldError, ParseIssue, SafeParseResult } from "./types";

type RawIssue = NonNullable<SafeParseResult["error"]>["errors"][number];

/** Issues from one union branch (Zod 3 ZodError or plain issue list). */
function getBranchIssues(branch: unknown): RawIssue[] {
  if (Array.isArray(branch)) {
    return branch as RawIssue[];
  }
  if (branch && typeof branch === "object") {
    const o = branch as { errors?: RawIssue[]; issues?: RawIssue[] };
    if (Array.isArray(o.issues)) return o.issues;
    if (Array.isArray(o.errors)) return o.errors;
  }
  return [];
}

/**
 * Zod 3: `unionErrors` = one ZodError-like object per branch.
 * Zod 4: on `invalid_union`, `errors` is `Issue[][]` (one issue array per branch).
 */
function getInvalidUnionBranches(issue: RawIssue): RawIssue[][] {
  const rec = issue as Record<string, unknown>;

  const nested = rec.errors;
  if (
    issue.code === "invalid_union" &&
    Array.isArray(nested) &&
    nested.length > 0 &&
    Array.isArray(nested[0])
  ) {
    return nested as RawIssue[][];
  }

  const ue = rec.unionErrors;
  if (Array.isArray(ue) && ue.length > 0) {
    return (ue as unknown[]).map((b) => getBranchIssues(b));
  }

  return [];
}

/**
 * Flatten `invalid_union` into **all** field-level issues from **every** branch
 * (recursively), instead of picking a single "best" branch.
 */
function flattenIssues(issues: RawIssue[]): RawIssue[] {
  const flat: RawIssue[] = [];

  for (const issue of issues) {
    if (issue.code === "invalid_union") {
      const branches = getInvalidUnionBranches(issue);
      if (branches.length > 0) {
        for (const branch of branches) {
          flat.push(...flattenIssues(branch));
        }
        continue;
      }
    }
    flat.push(issue);
  }

  return flat;
}

/** Drop exact duplicates (same path + message) after merging all union branches. */
function dedupeIssues(issues: RawIssue[]): RawIssue[] {
  const seen = new Set<string>();
  const out: RawIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.path.map(String).join(".")}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function issueToFieldError(issue: RawIssue, data: unknown): FieldError {
  const typeOfValue = (value: unknown): string => {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  };

  const expected: string =
    typeof issue.expected === "string"
      ? issue.expected
      : typeof issue.format === "string"
        ? issue.format
        : typeof issue.validation === "string"
          ? issue.validation
          : "unknown";

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
    received = typeof issue.format === "string" ? issue.format : inferred;
  }

  return {
    path: issue.path as (string | number)[],
    received,
    expected,
    message: issue.message,
  };
}

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

  const flattened = dedupeIssues(flattenIssues(result.error.errors));

  return flattened.map((issue) => issueToFieldError(issue, data));
}
