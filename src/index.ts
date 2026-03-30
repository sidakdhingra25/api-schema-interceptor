export { SchemaInterceptor } from "./registry";
export { enableAxios } from "./adapters/axios";
export type {
  InterceptorConfig,
  InterceptorMode,
  RouteSchema,
  LogEntry,
  ValidationResult,
  FieldError,
  ConsoleAggregation,
} from "./types";

import type { InterceptorConfig, RouteSchema, FieldError } from "./types";
import { SchemaInterceptor } from "./registry";
import { matchRoute, parseRouteKey } from "./path-matcher";
import { validate } from "./validator";

export function createInterceptor<TRoutes extends Record<string, RouteSchema>>(
  config: InterceptorConfig & { routes: TRoutes }
): SchemaInterceptor<TRoutes> {
  return new SchemaInterceptor<TRoutes>(config);
}

export function defineRoutes<TRoutes extends Record<string, RouteSchema>>(
  routes: TRoutes
): TRoutes {
  return routes;
}

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
  const shouldValidate = routeSchema?.validate ?? true;
  if (!shouldValidate) {
    return { matched: true, routePattern, valid: true, errors: [] };
  }

  const schema = direction === "request" ? routeSchema?.request : routeSchema?.response;
  const errors = validate(schema, body);

  return {
    matched: true,
    routePattern,
    valid: errors.length === 0,
    errors,
  };
}
