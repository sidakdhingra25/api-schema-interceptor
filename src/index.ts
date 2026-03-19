/**
 * api-schema-interceptor
 *
 * Validate API request/response payloads against Zod schemas.
 * Log mismatches, redact sensitive fields, and optionally throw.
 *
 * Usage:
 *   import { createInterceptor } from "api-schema-interceptor"
 *   const interceptor = createInterceptor({ ... })
 *   interceptor.enable()
 */

export { SchemaInterceptor } from "./registry";
export { LogStore, globalLogStore } from "./log-store";
export { enableAxios } from "./adapters/axios";
export type {
  InterceptorConfig,
  InterceptorMode,
  RouteSchema,
  LogEntry,
  ValidationResult,
  FieldError,
  Destination,
} from "./types";

import type { InterceptorConfig, RouteSchema, FieldError } from "./types";
import { SchemaInterceptor } from "./registry";
import { matchRoute, parseRouteKey } from "./path-matcher";
import { validate } from "./validator";

/**
 * Create a new interceptor from a config object.
 */
export function createInterceptor<TRoutes extends Record<string, RouteSchema>>(
  config: InterceptorConfig & { routes: TRoutes }
): SchemaInterceptor<TRoutes> {
  return new SchemaInterceptor<TRoutes>(config);
}

/**
 * Helper to define routes with preserved type information when
 * they are declared in a separate module.
 */
export function defineRoutes<TRoutes extends Record<string, RouteSchema>>(
  routes: TRoutes
): TRoutes {
  return routes;
}

/**
 * Test-time helper: checks whether the interceptor config matches the given
 * method/url, and if so, validates `body` against the route schema.
 *
 * Important:
 * - No logs are produced.
 * - No strict-mode throwing is performed.
 * - Schema selection uses `direction` directly (no fallback).
 */
export function validateMatch(
  interceptor: SchemaInterceptor<any>,
  method: string,
  url: string,
  body: unknown,
  direction: "request" | "response"
): {
  matched: boolean;
  routePattern?: string;
  valid: boolean;
  errors: FieldError[];
} {
  const routeKeys = interceptor.getRegisteredRoutes();
  const match = matchRoute(method, url, routeKeys);

  if (!match) {
    return { matched: false, valid: true, errors: [] };
  }

  const { method: parsedMethod, pattern } = parseRouteKey(match.routeKey);
  const routePattern = `${pattern}`;

  const routeSchema = interceptor.getRoute(match.routeKey);
  const schema = direction === "request" ? routeSchema?.request : routeSchema?.response;
  const errors = validate(schema, body);

  return {
    matched: true,
    routePattern,
    valid: errors.length === 0,
    errors,
  };
}
