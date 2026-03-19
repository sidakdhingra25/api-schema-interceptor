// ── Modes ──────────────────────────────────────────────
export type InterceptorMode = "observe" | "warn" | "strict";

// ── Schema abstraction (version-agnostic) ─────────────

/** One issue from `safeParse` error lists; may appear inside union branches. */
export type ParseIssue = {
  path: (string | number)[];
  message: string;
  code?: string;
  expected?: unknown;
  received?: unknown;
  format?: unknown;
  validation?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  /**
   * Zod 3 `invalid_union`: one entry per branch; each is ZodError-like (`issues` / `errors`).
   */
  unionErrors?: ReadonlyArray<{
    errors?: ParseIssue[];
    issues?: ParseIssue[];
  }>;
};

export interface SafeParseResult {
  success: boolean;
  data?: unknown;
  error?: {
    errors: ParseIssue[];
  };
}

export interface AnySchema {
  safeParse(data: unknown): SafeParseResult;
}

// ── Route schema definition ───────────────────────────
export interface RouteSchema {
  request?: AnySchema;
  response?: AnySchema;
}

// ── Config the user passes to createInterceptor ───────
export interface InterceptorConfig {
  mode?: InterceptorMode;
  routes: Record<string, RouteSchema>;
  redact?: string[];
  destinations?: Destination[];
  sharedStore?: boolean;
  warnOnUnmatched?: boolean;
  debug?: boolean;
}

export type Destination = "console" | "memory" | "dashboard";

// ── Validation result returned per field ──────────────
export interface FieldError {
  path: (string | number)[];
  expected: string;
  received: string;
  message: string;
}

// ── A single log entry ───────────────────────────────
export interface LogEntry {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  routePattern: string;
  direction: "request" | "response";
  valid: boolean;
  errors: FieldError[];
  data: Record<string, unknown>;
  mode: InterceptorMode;
  statusCode?: number;
}

// ── Inference helpers (Phase 3 uses these) ────────────

// Use Zod's internal _output field (stable across v3/v4) without importing Zod types.
export type InferSchema<T> = T extends { _output: infer O } ? O : unknown;

export type InferRouteTypes<TRoutes extends Record<string, RouteSchema>> = {
  [K in keyof TRoutes]: {
    request: InferSchema<TRoutes[K]["request"]>;
    response: InferSchema<TRoutes[K]["response"]>;
  };
};

// ── Validation outcome ───────────────────────────────
export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
  /** Present only when a route matched and a log entry was produced. */
  log?: LogEntry;
}
