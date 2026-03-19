import type {
  RouteSchema,
  InterceptorConfig,
  InterceptorMode,
  Destination,
  ValidationResult,
  LogEntry,
  FieldError,
  InferRouteTypes,
  InferSchema,
} from "./types";
import { matchRoute, parseRouteKey } from "./path-matcher";
import { validate } from "./validator";
import { redact } from "./redactor";
import { LogStore, globalLogStore } from "./log-store";

let idCounter = 0;
function nextId(): string {
  return `log_${Date.now()}_${++idCounter}`;
}

/**
 * The core interceptor instance returned by createInterceptor().
 * Generic over the routes map for type inference.
 */
export class SchemaInterceptor<TRoutes extends Record<string, RouteSchema>> {
  private routes: Map<string, RouteSchema> = new Map();
  readonly mode: InterceptorMode;
  private redactKeys: string[];
  private destinations: Destination[];
  private store: LogStore;
  private enabled = false;
  private originalFetch?: typeof globalThis.fetch;
  private warnOnUnmatched: boolean;
  private debug: boolean;

  // Phantom field for type inference only; never used at runtime.
  readonly types!: InferRouteTypes<TRoutes>;

  constructor(config: InterceptorConfig & { routes: TRoutes }) {
    this.mode = config.mode ?? "observe";
    this.redactKeys = config.redact ?? [];
    this.destinations = config.destinations ?? ["console", "memory"];
    this.warnOnUnmatched = config.warnOnUnmatched ?? true;
    this.debug = !!config.debug;

    // Per-instance log store by default; opt-in shared store if requested.
    this.store = config.sharedStore ? globalLogStore : new LogStore();

    for (const [key, schema] of Object.entries(config.routes)) {
      this.routes.set(key, schema);
    }
  }

  // ── Route registration at runtime ──────────────────
  register(routeKey: string, schema: RouteSchema) {
    this.routes.set(routeKey, schema);
  }

  unregister(routeKey: string) {
    this.routes.delete(routeKey);
  }

  getRegisteredRoutes(): string[] {
    return [...this.routes.keys()];
  }

  getRoute(routeKey: string): RouteSchema | undefined {
    return this.routes.get(routeKey);
  }

  // ── Validate request or response data ──────────────
  // Typed overload (Phase 3)
  validateRequest<K extends keyof TRoutes>(
    method: string,
    url: string,
    body: InferSchema<TRoutes[K]["request"]>
  ): ValidationResult;
  // Backward-compatible untyped overload
  validateRequest(method: string, url: string, body: unknown): ValidationResult;
  // Implementation
  validateRequest(method: string, url: string, body: unknown): ValidationResult {
    return this.runValidation(method, url, body, "request");
  }

  // Typed overload (Phase 3)
  validateResponse<K extends keyof TRoutes>(
    method: string,
    url: string,
    body: InferSchema<TRoutes[K]["response"]>,
    statusCode?: number
  ): ValidationResult;
  // Backward-compatible untyped overload
  validateResponse(
    method: string,
    url: string,
    body: unknown,
    statusCode?: number
  ): ValidationResult;
  // Implementation
  validateResponse(
    method: string,
    url: string,
    body: unknown,
    statusCode?: number
  ): ValidationResult {
    return this.runValidation(method, url, body, "response", statusCode);
  }

  private runValidation(
    method: string,
    url: string,
    body: unknown,
    direction: "request" | "response",
    statusCode?: number
  ): ValidationResult {
    const routeKeys = [...this.routes.keys()];
    const match = matchRoute(method, url, routeKeys);

    if (!match) {
      if (this.warnOnUnmatched) {
        console.warn(
          `[api-schema-interceptor] No schema registered for ${method.toUpperCase()} ${url}\n` +
            `  Registered routes: ${this.getRegisteredRoutes().join(", ") || "(none)"}\n` +
            `  → If this route should be validated, add it to your routes config.`
        );
      }
      return { valid: true, errors: [] };
    }

    const { method: parsedMethod, pattern } = parseRouteKey(match.routeKey);

    if (this.debug && process.env.NODE_ENV !== "production") {
      console.log(
        `[api-schema-interceptor:debug] ${method.toUpperCase()} ${url} → ${match.routeKey}`
      );
    }

    const schema = this.routes.get(match.routeKey);
    const routeSchema = direction === "request" ? schema?.request : schema?.response;
    const errors: FieldError[] = routeSchema ? validate(routeSchema, body) : [];

    const safeData = this.redactKeys.length
      ? redact(body, this.redactKeys)
      : (body as Record<string, unknown>) ?? {};

    const entry: LogEntry = {
      id: nextId(),
      timestamp: Date.now(),
      method: parsedMethod,
      path: url,
      // route pattern alone (e.g. "/login") so console output is `METHOD ${routePattern}`
      routePattern: `${pattern}`,
      direction,
      valid: errors.length === 0,
      errors,
      data: typeof safeData === "object" && safeData !== null ? safeData as Record<string, unknown> : {},
      mode: this.mode,
      statusCode,
    };

    this.store.push(entry, this.destinations);

    // strict mode throws on validation failure
    if (!entry.valid && this.mode === "strict") {
      const msg = errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      throw new Error(`[api-interceptor] Schema violation on ${method} ${url}: ${msg}`);
    }

    return { valid: entry.valid, errors, log: entry };
  }

  // ── Global fetch interception ──────────────────────
  enable() {
    if (this.enabled) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[api-schema-interceptor] enable() called but interceptor is already enabled. " +
            "Call disable() first if you want to re-enable."
        );
      }
      return;
    }

    if (typeof globalThis.fetch === "undefined") {
      console.warn(
        "[api-schema-interceptor] enable() called but globalThis.fetch is not defined. " +
          "Requires a browser or Node 18+ environment."
      );
      return;
    }

    this.originalFetch = globalThis.fetch;
    const self = this;

    globalThis.fetch = async function interceptedFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const method = init?.method ?? "GET";

      // validate request body — parse and validate in separate steps so strict-mode throws propagate
      if (init?.body) {
        let parsedBody: unknown = null;
        try {
          parsedBody = JSON.parse(
            typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)
          );
        } catch {
          // genuinely non-JSON body — skip validation
        }
        if (parsedBody !== null) {
          self.validateRequest(method, url, parsedBody);
        }
      }

      // call original fetch
      const response = await self.originalFetch!.call(globalThis, input, init);

      // clone response so we can read body without consuming it
      const clone = response.clone();
      let responseData: unknown = null;
      try {
        responseData = await clone.json();
      } catch {
        // non-JSON response — skip validation
      }
      if (responseData !== null) {
        self.validateResponse(method, url, responseData, response.status);
      }

      return response;
    };

    this.enabled = true;
  }

  disable() {
    if (!this.enabled) return;
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = undefined;
    }
    this.enabled = false;
  }

  // ── Access logs ────────────────────────────────────
  getLogs() {
    return this.store.getAll();
  }

  clearLogs() {
    this.store.clear();
  }

  subscribe(fn: (entry: LogEntry) => void) {
    return this.store.subscribe(fn);
  }
}
