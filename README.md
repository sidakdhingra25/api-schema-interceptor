## API Schema Interceptor

**API Schema Interceptor** is a small utility for validating **HTTP requests and responses** against **Zod** schemas, while automatically logging each interaction. It can:

- **Wrap global `fetch`** so all JSON requests/responses are validated.
- **Hook into Axios** via an adapter.
- **Log every validation attempt** with optional **redaction** and multiple **destinations** (console, in‑memory store, dashboard, etc.).
- Run in different **modes**: `"observe"`, `"warn"`, or `"strict"`.

---

## Installation

Install from your package manager (example using `pnpm`):

```bash
pnpm add api-schema-interceptor zod
```

Or with npm:

```bash
npm install api-schema-interceptor zod
```

> **Note**: The actual package name may differ if you have not yet published this library. Adjust the import paths accordingly.

---

## Core Concepts

- **Route schemas**: You define Zod schemas for specific routes (e.g. `"GET /users/:id"`, `"POST /users"`). Each route can have:
  - A **request** schema.
  - A **response** schema.
- **Modes**:
  - **`"observe"`**: Only log validation results, never throw.
  - **`"warn"`**: Log and warn on violations (implementation depends on the log store configuration).
  - **`"strict"`**: Throw an error on schema violation.
- **Redaction**:
  - You can configure a list of keys to redact (e.g. `"password"`, `"token"`) before data is stored or displayed in logs.
- **Destinations**:
  - Logs can be sent to `console`, an in‑memory store (`memory`), or a `dashboard`.

---

## Types Overview

The relevant types are defined in `src/types.ts`:

- **Mode**

```ts
export type InterceptorMode = "observe" | "warn" | "strict";
```

- **Route schema**

```ts
export interface RouteSchema {
  request?: ZodSchema;
  response?: ZodSchema;
}
```

- **Interceptor configuration**

```ts
export interface InterceptorConfig {
  mode?: InterceptorMode;
  routes: Record<string, RouteSchema>;
  redact?: string[];
  destinations?: Destination[];
  sharedStore?: boolean;
  warnOnUnmatched?: boolean;
  debug?: boolean;
  dashboardPort?: number;
}
```

- **Destinations**

```ts
export type Destination = "console" | "memory" | "dashboard";
```

- **Field error**

```ts
export interface FieldError {
  path: (string | number)[];
  expected: string;
  received: string;
  message: string;
}
```

- **Log entry**

```ts
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
```

- **Validation result**

```ts
export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
  /** Only set when a route matched and a log entry was written. */
  log?: LogEntry;
}
```

---

## `SchemaInterceptor` Class

The central class is `SchemaInterceptor` (defined in `src/registry.ts`), which you construct with an `InterceptorConfig`.

### Creating an interceptor

```ts
import { z } from "zod";
import { SchemaInterceptor } from "./src/registry"; // adjust path/import for your build

const routes = {
  "GET /users/:id": {
    response: z.object({
      id: z.string(),
      email: z.string().email(),
    }),
  },
  "POST /users": {
    request: z.object({
      email: z.string().email(),
      password: z.string().min(8),
    }),
    response: z.object({
      id: z.string(),
    }),
  },
};

const interceptor = new SchemaInterceptor({
  routes,
  mode: "strict", // "observe" | "warn" | "strict"
  redact: ["password", "token"],
  destinations: ["console", "memory"],
});
```

### Route management

- **Register a route at runtime**

```ts
interceptor.register("PUT /users/:id", {
  request: z.object({ email: z.string().email().optional() }),
  response: z.object({ id: z.string(), email: z.string().email() }),
});
```

- **Unregister a route**

```ts
interceptor.unregister("PUT /users/:id");
```

- **List registered routes**

```ts
const routesList = interceptor.getRegisteredRoutes();
```

### Manual validation

You can call validation methods directly:

```ts
const reqResult = interceptor.validateRequest(
  "POST",
  "/users",
  { email: "user@example.com", password: "super-secret" }
);

if (!reqResult.valid) {
  console.error("Request violated schema:", reqResult.errors);
}

const resResult = interceptor.validateResponse(
  "POST",
  "/users",
  { id: "123" },
  201
);
```

In `"strict"` mode, the interceptor will throw an error on validation failure; in `"observe"` and `"warn"` modes, it will just log and return a `ValidationResult`.

---

## Global `fetch` Interception

`SchemaInterceptor` can wrap **global `fetch`** so that all JSON request and response bodies are validated according to your configured routes.

### Enabling fetch interception

```ts
interceptor.enable();
```

This:

- Stores the original `globalThis.fetch`.
- Replaces it with a wrapper that:
  - Attempts to parse `init.body` as JSON (string or `ArrayBuffer`) and validate it via `validateRequest`.
  - Calls the original `fetch`.
  - Clones the response, attempts `clone.json()`, and validates the parsed data via `validateResponse`.

Non‑JSON bodies (request or response) are ignored for validation.

### Disabling fetch interception

```ts
interceptor.disable();
```

This restores the original `globalThis.fetch` and marks the interceptor as disabled.

---

## Axios Adapter

For Axios, the package includes an adapter in `src/adapters/axios.ts`, re‑exported from `src/adapters/index.ts`:

```ts
import { enableAxios } from "./src/adapters"; // adjust path/import
```

### Enabling Axios interception

```ts
import axios from "axios";
import { enableAxios } from "./src/adapters";
import { SchemaInterceptor } from "./src/registry";

const axiosInstance = axios.create({ baseURL: "https://api.example.com" });

const interceptor = new SchemaInterceptor({
  routes,
  mode: "strict",
  redact: ["password"],
});

const teardownAxios = enableAxios(axiosInstance, interceptor);
```

`enableAxios`:

- Adds a **request interceptor**:
  - Resolves the full URL from `baseURL` and `url`.
  - If `config.data` looks like JSON (string or object), parses (if needed) and calls `validateRequest`.
- Adds a **response interceptor**:
  - For object responses, calls `validateResponse` with the final URL, method, response data, and status.
- In `"strict"` mode, schema violations raise errors at the interception points.

The function returns a **teardown function**:

```ts
teardownAxios(); // ejects both request and response interceptors
```

---

## Logging and Observability

When **a registered route matches**, each request/response validation generates a `LogEntry` and is pushed according to `destinations`. Unmatched URLs do **not** create log entries (optional `warnOnUnmatched` console warning only). You can access logs through the `SchemaInterceptor` instance (`getLogs()` reads that instance’s `LogStore`, or `globalLogStore` when `sharedStore: true`).

### Access logs

```ts
const logs = interceptor.getLogs();
```

Each log is a `LogEntry`:

- HTTP method and path.
- Matched route pattern.
- Direction (`"request"` or `"response"`).
- Whether it was valid.
- The list of `FieldError` items (if any).
- Redacted payload snapshot.
- Mode and optional HTTP status code.

### Clear logs

```ts
interceptor.clearLogs();
```

### Subscribe to new logs

```ts
const unsubscribe = interceptor.subscribe((entry) => {
  if (!entry.valid) {
    console.warn("Schema violation:", entry);
  }
});

// later
unsubscribe();
```

---

## Validation Behavior and Modes

- **`"observe"`**
  - No thrown errors due to schema mismatch.
  - All validation attempts are logged.
  - Suitable for production rollout or discovery phases.

- **`"warn"`**
  - Same as `"observe"`, but intended for emitting warnings through the configured destinations (e.g. console).
  - Implementation details live in `logStore.push`.

- **`"strict"`**
  - Throws an error on the first schema violation for:
    - `validateRequest` / `validateResponse` calls.
    - Intercepted `fetch` requests.
    - Intercepted Axios requests/responses.
  - Best used in tests and development to fail fast when APIs deviate from the contract.

---

## Example: End‑to‑End Setup

```ts
import { z } from "zod";
import axios from "axios";
import { SchemaInterceptor } from "./src/registry";
import { enableAxios } from "./src/adapters";

const routes = {
  "GET /users/:id": {
    response: z.object({
      id: z.string(),
      email: z.string().email(),
    }),
  },
  "POST /users": {
    request: z.object({
      email: z.string().email(),
      password: z.string().min(8),
    }),
    response: z.object({
      id: z.string(),
    }),
  },
};

const interceptor = new SchemaInterceptor({
  routes,
  mode: "strict",
  redact: ["password"],
  destinations: ["console", "memory"],
});

// Global fetch interception
interceptor.enable();

// Axios interception
const axiosInstance = axios.create({ baseURL: "https://api.example.com" });
const teardownAxios = enableAxios(axiosInstance, interceptor);

// Use fetch
await fetch("/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "user@example.com", password: "secret123" }),
});

// Use Axios
const res = await axiosInstance.get("/users/123");

// Inspect logs
console.log(interceptor.getLogs());

// Clean up
teardownAxios();
interceptor.disable();
```

---

## Development Notes

- The package uses **Zod** for validation and a central `logStore` (see `src/log-store.ts`) to manage log entries and destinations.
- Route matching and normalization are handled by utilities in `src/path-matcher.ts`.
- Redaction is provided by `src/redactor.ts`.

If you extend the library (e.g. new adapters, dashboard integrations), prefer reusing the same `SchemaInterceptor` instance so that all logs and behavior remain centralized.

# api-schema-interceptor

Validate API request and response payloads against Zod schemas. Log mismatches, redact sensitive fields, and optionally throw—without changing how your app uses `fetch`.

---

## Table of contents

- [Overview](#overview)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Quick start](#quick-start)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Path matching](#path-matching)
- [Modes](#modes)
- [Destinations & redaction](#destinations--redaction)
- [Integration guides](#integration-guides)
- [Limitations & caveats](#limitations--caveats)

---

## Overview

**api-schema-interceptor** is middleware that:

1. **Registers** expected request/response shapes per endpoint (e.g. `POST /login` expects `email` + `password` in, and `accessToken` out).
2. **Intercepts** `fetch()` calls: before sending it validates the request body (if JSON), and after receiving it validates the response body (if JSON).
3. **Logs** every validation as PASS or FAIL with field-level errors.
4. **Redacts** sensitive fields (e.g. `password`, `token`) before logging.
5. **Behaves** by mode: **observe** (log only), **warn** (log + console warning), or **strict** (throw on failure).

It does **not** replace or wrap your API client—it patches `globalThis.fetch` so existing `fetch()` calls are validated automatically. No overhead when no route matches.

- **Peer dependency:** [Zod](https://zod.dev) for schemas.
- **Environments:** Browser and Node 18+ (where `fetch` exists).
- **TypeScript:** Full typings; export types for config and logs.

---

## How it works

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Your app: fetch(url, { method: "POST", body: JSON.stringify(data) })   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Interceptor (enabled)                                                   │
│  1. Parse request body (if JSON) → validate against route's request    │
│  2. Push log entry (PASS/FAIL) to logStore + optional console           │
│  3. Call original fetch()                                               │
│  4. Clone response, parse body (if JSON) → validate route's response     │
│  5. Push log entry again; in strict mode throw if validation failed    │
│  6. Return original response to caller                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Route key** = `"METHOD /path"` or `"METHOD /path/:id"`. Only the **pathname** of the URL is matched (host and query are ignored).
- **Validation** runs only when the (method, pathname) matches a registered route and the route has a `request` and/or `response` Zod schema.
- **Non-JSON** bodies are skipped (no validation, no error).
- **Log store:** each interceptor has its **own** `LogStore` by default; set `sharedStore: true` to use the exported **`globalLogStore`** singleton. Capacity is capped (1000 entries, oldest dropped, one warning). Use `getLogs()`, `clearLogs()`, or `subscribe(callback)` on the instance (or `globalLogStore` when shared).

---

## Installation

```bash
npm install api-schema-interceptor zod
# or
pnpm add api-schema-interceptor zod
# or
yarn add api-schema-interceptor zod
```

**Requirement:** `zod` must be installed in your app (peer dependency).

---

## Quick start

**1. Create a config module** (e.g. `lib/api-interceptor.ts`):

```ts
import { createInterceptor } from "api-schema-interceptor";
import { z } from "zod";

export const interceptor = createInterceptor({
  mode: "warn",
  routes: {
    "POST /login": {
      request: z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
      response: z.object({
        accessToken: z.string().min(1),
      }),
    },
    "GET /api/users/:id": {
      response: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
      }),
    },
  },
  redact: ["password", "accessToken", "token"],
  destinations: ["console", "memory"],
});
```

If your routes live in a separate module and you want the route keys to stay
type-safe, use `defineRoutes`:

```ts
import { createInterceptor, defineRoutes } from "api-schema-interceptor";
import { z } from "zod";

export const routes = defineRoutes({
  "POST /login": {
    request: z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }),
    response: z.object({
      accessToken: z.string().min(1),
    }),
  },
});

export const interceptor = createInterceptor({
  mode: "warn",
  routes,
  redact: ["password", "accessToken"],
  destinations: ["console", "memory"],
});
```

**2. Enable the interceptor** once (e.g. at app bootstrap or in a root React component):

```ts
import { interceptor } from "./lib/api-interceptor";

interceptor.enable();
```

**3. Use `fetch` as usual.** Validations run automatically; check the console or `interceptor.getLogs()` for PASS/FAIL and field errors.

---

## Implemented Features
- **Fetch interception (JSON only)**: when a request/response body is valid JSON and the route matches, the interceptor validates it and logs the result.
- **Route matching by method + pathname**: URLs are matched against registered keys like `"POST /login"`; query/host are ignored.
- **Warn on unmatched routes** (`warnOnUnmatched`, default `true`): if there is no matching schema, the interceptor emits a `console.warn` and does **not** create a log entry.
- **Request vs response validation**: request bodies are validated against the route’s `request` schema, response bodies against the route’s `response` schema (direction-aware).
- **Strict / warn / observe modes**:
  - `"observe"`: log only
  - `"warn"`: log + `console.warn` on failures
  - `"strict"`: log + `console.error`, then throw on the first validation failure
- **Human-friendly field errors**:
  - missing field → `field is missing`
  - type mismatch → `got a <type>, expected a <type>`
  - format mismatch (e.g. `.email()`) → `invalid format — expected a valid <format>`
- **Axios adapter** (`enableAxios`) using the same interceptor behavior.
- **Optional shared log store** (`sharedStore: true`) via `globalLogStore` and a 1000-entry capacity cap.
- **Test helper** `validateMatch(...)` to check “does this route match and would it validate?” without HTTP, logs, or throwing.

## Console Output Examples
Below are the real console shapes you should expect when something does not match.

### 1) Path does not match any registered route
If `warnOnUnmatched` is enabled, you’ll get a warning and **no** failure box, because no log entry is written:

```text
[api-schema-interceptor] No schema registered for POST /unknown
  Registered routes: GET /health
  → If this route should be validated, add it to your routes config.
```

### 2) Request validation failure (direction: `request`)
Example (bad request body for `"POST /login"`):

```text
┌─ api-schema-interceptor ──────────────────────────────────────┐
│ FAIL  POST /login  [request]                                  │
│                                                                │
│   ✗  email      invalid format — expected a valid email       │
│   ✗  password   field is missing                            │
│                                                                │
│ mode: warn · 2 errors · 12:34:56.789                        │
└────────────────────────────────────────────────────────────────┘
```

### 3) Response validation failure (direction: `response`)
Example (bad response body for `"POST /login"`):

```text
┌─ api-schema-interceptor ──────────────────────────────────────┐
│ FAIL  POST /login  [response]                                 │
│                                                                │
│   ✗  accessToken   got a number, expected a string          │
│                                                                │
│ mode: warn · 1 error · 12:34:56.789                         │
└────────────────────────────────────────────────────────────────┘
```

## API reference

### Package exports

| Export                      | Type                                               | Description                                            |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `createInterceptor(config)` | `(config: InterceptorConfig) => SchemaInterceptor` | Creates a new interceptor instance.                    |
| `SchemaInterceptor`         | `class`                                            | The interceptor class (for typing or subclassing).     |
| `globalLogStore`           | `LogStore`                                         | Shared log store when `config.sharedStore` is true.    |
| `LogStore`                 | `class`                                            | In-memory store; one per interceptor by default.       |
| `enableAxios(axios, interceptor)` | `(instance, interceptor) => () => void` | Attach validation to an axios instance; returns teardown. |
| `InterceptorConfig`         | `interface`                                        | Config passed to `createInterceptor`.                  |
| `InterceptorMode`           | `"observe" \| "warn" \| "strict"`                  | Validation behavior.                                   |
| `RouteSchema`               | `interface`                                        | `{ request?: ZodSchema; response?: ZodSchema }`.       |
| `LogEntry`                  | `interface`                                        | One validation log entry.                              |
| `ValidationResult`          | `interface`                                        | Return type of `validateRequest` / `validateResponse`. |
| `FieldError`                | `interface`                                        | One field-level error.                                 |
| `validateMatch(...)`       | `function`                                        | Test helper to validate a payload for a matched route (direction-aware). |
| `Destination`               | `"console" \| "memory" \| "dashboard"`             | Where to send logs.                                    |

---

### `createInterceptor(config)`

Creates and returns a `SchemaInterceptor` instance. Does not enable interception; call `.enable()` when ready.

```ts
function createInterceptor(config: InterceptorConfig): SchemaInterceptor;
```

---

### `SchemaInterceptor`

#### Constructor (internal)

Called via `createInterceptor(config)`. Options come from `InterceptorConfig` (see [Configuration](#configuration)).

#### Instance methods

| Method                                             | Signature                                                                               | Description                                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enable()`                                         | `() => void`                                                                            | Patches `globalThis.fetch` so all subsequent `fetch()` calls are validated. No-op if already enabled or if `fetch` is undefined.                                                         |
| `disable()`                                        | `() => void`                                                                            | Restores the original `fetch`; stops interception.                                                                                                                                       |
| `validateRequest(method, url, body)`               | `(method: string, url: string, body: unknown) => ValidationResult`                      | Validates a request body against the matching route’s `request` schema. Pushes a log entry and, in strict mode, may throw. Use when you are not using global fetch (e.g. custom client). |
| `validateResponse(method, url, body, statusCode?)` | `(method: string, url: string, body: unknown, statusCode?: number) => ValidationResult` | Same for response body and route’s `response` schema.                                                                                                                                    |
| `register(routeKey, schema)`                       | `(routeKey: string, schema: RouteSchema) => void`                                       | Registers or overwrites a route at runtime.                                                                                                                                              |
| `unregister(routeKey)`                             | `(routeKey: string) => void`                                                            | Removes a route.                                                                                                                                                                         |
| `getRegisteredRoutes()`                            | `() => string[]`                                                                        | Returns all registered route keys.                                                                                                                                                       |
| `getLogs()`                                        | `() => LogEntry[]`                                                                      | Returns a copy of all entries from the shared log store.                                                                                                                                 |
| `clearLogs()`                                      | `() => void`                                                                            | Clears the log store.                                                                                                                                                                    |
| `subscribe(fn)`                                    | `(fn: (entry: LogEntry) => void) => () => void`                                         | Subscribes to new log entries. Returns an unsubscribe function.                                                                                                                          |

**Note:** `getLogs()`, `clearLogs()`, and `subscribe` use this instance’s `LogStore`. Pass `sharedStore: true` in config to share **`globalLogStore`** across instances.

---

### Types

#### `InterceptorConfig`

```ts
interface InterceptorConfig {
  mode?: InterceptorMode; // default "observe"
  routes: Record<string, RouteSchema>;
  redact?: string[]; // default []
  destinations?: Destination[]; // default ["console", "memory"]
  sharedStore?: boolean; // default false — use globalLogStore when true
  warnOnUnmatched?: boolean; // default true — console.warn when no route matches
  debug?: boolean; // log route match line in non-production
  dashboardPort?: number; // reserved for future use
}
```

#### `RouteSchema`

```ts
interface RouteSchema {
  request?: ZodSchema; // request body (JSON)
  response?: ZodSchema; // response body (JSON)
}
```

#### `InterceptorMode`

- **`"observe"`** – Log only; never throw. Failures appear as log entries and, if `console` is a destination, as a single log line.
- **`"warn"`** – Same as observe, but failures are printed with `console.warn` and field-level errors listed.
- **`"strict"`** – On validation failure, logs then **throws** an error. Use in tests or CI to fail on contract violations.

#### `LogEntry`

```ts
interface LogEntry {
  id: string;
  timestamp: number;
  method: string;
  path: string; // full URL as received
  routePattern: string; // e.g. "/login" (the registered path pattern)
  direction: "request" | "response";
  valid: boolean;
  errors: FieldError[];
  data: Record<string, unknown>; // redacted payload
  mode: InterceptorMode;
  statusCode?: number; // response only
}
```

#### `FieldError`

```ts
interface FieldError {
  path: (string | number)[];
  expected: string;
  received: string;
  message: string;
}
```

#### `ValidationResult`

```ts
interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
  /** Only set when a route matched and a log entry was written. */
  log?: LogEntry;
}
```

#### `Destination`

- **`"console"`** – Print PASS/FAIL lines (and in warn/strict, field errors) to the console.
- **`"memory"`** – Store entries in this interceptor’s `LogStore` (or `globalLogStore` if `sharedStore: true`).
- **`"dashboard"`** – Reserved for future use.

---

## Configuration

| Option         | Type                          | Default                 | Description                                                                                                  |
| -------------- | ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `mode`         | `InterceptorMode`             | `"observe"`             | Whether to only log, or also warn/throw.                                                                     |
| `routes`       | `Record<string, RouteSchema>` | required                | Map of route key → request/response Zod schemas.                                                             |
| `redact`       | `string[]`                    | `[]`                    | Keys to mask (case-insensitive) in logged payloads; value becomes `"[REDACTED]"`. Nested objects are walked. |
| `destinations` | `Destination[]`               | `["console", "memory"]` | Where to send logs.                                                                                          |
| `sharedStore`  | `boolean`                     | `false`                 | If true, use `globalLogStore` so multiple instances share logs.                                              |
| `warnOnUnmatched` | `boolean`                  | `true`                  | Console warning when fetch hits an unregistered route (no log entry).                                         |
| `debug`        | `boolean`                     | `false`                 | Extra match logging when `NODE_ENV !== "production"`.                                                        |

**Route key format:** `"METHOD /path"` or `"METHOD /path/:param"`. Method is case-insensitive. Path is pathname only (no origin, query is stripped for matching). Examples:

- `"GET /api/users"`
- `"POST /login"`
- `"GET /api/users/:id"`
- `"PUT /api/users/:id/profile"`

---

## Path matching

- The URL is normalized to a **pathname** (e.g. `http://localhost:9999/login` → `/login`; query is removed for matching).
- Route keys are **`METHOD pathname`** with optional **`:param`** segments.
- **`:param`** matches any single path segment (no `/`). Example: `GET /api/users/:id` matches `GET /api/users/42` and `GET https://api.example.com/api/users/42`.
- First matching route wins. Order of registration is the order in the `routes` object.

---

## Modes

| Mode      | Log entry | Console (failure)              | Throws on failure |
| --------- | --------- | ------------------------------ | ----------------- |
| `observe` | Yes       | One line                       | No                |
| `warn`    | Yes       | `console.warn` + field errors  | No                |
| `strict`  | Yes       | `console.error` + field errors | **Yes**           |

Passing validations: in `observe` mode, PASS lines are not printed; in `warn` and `strict`, they are printed with `console.log`.

---

## Destinations & redaction

- **console** – Human-readable PASS/FAIL lines (and errors in warn/strict).
- **memory** – When listed in `destinations`, entries are stored in this interceptor’s `LogStore` (or `globalLogStore` if `sharedStore: true`), up to 1000 entries then oldest dropped.
- **redact** – Keys listed here (e.g. `password`, `accessToken`) are replaced with `"[REDACTED]"` in the `data` field of `LogEntry` and in any logged payload. Matching is case-insensitive and recurs into nested objects.

---

## Integration guides

### Next.js (App Router)

**1. Config** – e.g. `lib/api-interceptor.ts`:

```ts
import { createInterceptor } from "api-schema-interceptor";
import { z } from "zod";

export const interceptor = createInterceptor({
  mode: "warn",
  routes: {
    /* ... */
  },
  redact: ["password", "token", "accessToken"],
  destinations: ["console", "memory"],
});
```

**2. Client-only enable** – Create a client component, e.g. `components/InterceptorProvider.tsx`:

```tsx
"use client";

import { interceptor } from "@/lib/api-interceptor";
import { useEffect } from "react";

export function InterceptorProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    interceptor.enable();
    return () => interceptor.disable();
  }, []);
  return <>{children}</>;
}
```

**3. Layout** – Wrap your app in the provider (e.g. in `app/layout.tsx`):

```tsx
import { InterceptorProvider } from "@/components/InterceptorProvider";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <InterceptorProvider>{children}</InterceptorProvider>
      </body>
    </html>
  );
}
```

Only **client-side** `fetch` is intercepted. For **server-side** (RSC, Route Handlers), enable in `instrumentation.ts` (see below).

---

### Next.js – server-side (optional)

To validate `fetch` in Node (RSC, Route Handlers, etc.):

**1. Enable instrumentation** in `next.config.js`:

```js
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
};
```

**2. Root-level `instrumentation.ts`** (next to `app/` or `pages/`):

```ts
import { interceptor } from "./lib/api-interceptor";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    interceptor.enable();
  }
}
```

---

### Axios

To validate **axios** request/response bodies with the same routes and config, use `enableAxios`. No need to install axios as a dependency of this package—pass your app’s axios instance.

```ts
import axios from "axios";
import { createInterceptor, enableAxios } from "api-schema-interceptor";
import { z } from "zod";

const interceptor = createInterceptor({
  mode: "warn",
  routes: {
    "POST /login": {
      request: z.object({ email: z.string().email(), password: z.string().min(1) }),
      response: z.object({ accessToken: z.string() }),
    },
  },
  redact: ["password", "accessToken"],
  destinations: ["console", "memory"],
});

// Optional: also intercept fetch
interceptor.enable();

// Attach to axios (default or custom instance)
const disableAxios = enableAxios(axios, interceptor);

// Later, to remove axios interceptors:
// disableAxios();
```

- **Request:** Validates `config.data` when it’s JSON (object or parseable string). Uses `config.method`, and builds full URL from `config.baseURL` + `config.url`.
- **Response:** Validates `response.data` when it’s an object. Same path matching as fetch (pathname only).
- **Teardown:** Call the returned function to remove the axios interceptors; the `SchemaInterceptor` and fetch patching are unchanged.

---

### Vanilla JS / other frameworks

- **Single entry point:** Where your app boots (e.g. `main.ts`, `index.tsx`), import your interceptor config and call `interceptor.enable()` once.
- **React (non-Next):** Same as Next client: one component or `useEffect` in the root that runs `interceptor.enable()` on mount and `interceptor.disable()` on unmount.
- **Vue / Svelte / Angular:** Call `interceptor.enable()` in the app initialization (e.g. before mounting the root component).

---

### Using without patching `fetch` or axios

For other HTTP clients (e.g. `XMLHttpRequest`, custom wrappers), call `validateRequest` and `validateResponse` manually:

```ts
const result = interceptor.validateRequest(
  "POST",
  "https://api.example.com/login",
  requestBody,
);
if (!result.valid) {
  console.error(result.errors);
}

// after receiving response:
const responseResult = interceptor.validateResponse(
  "POST",
  url,
  responseData,
  response.status,
);
```

Log entries are pushed when you call `validateRequest` or `validateResponse` **and** a route matches (same as fetch). Use `enable()` for `fetch`, `enableAxios(axios, interceptor)` for axios, or call the validate methods from your custom client for the same logging and strict-mode behavior.

---

## Local development (linking)

To use the package from a local path without publishing:

```bash
# From your app directory
pnpm link /absolute/path/to/api-schema-interceptor
# or
npm link /absolute/path/to/api-schema-interceptor
```

Or in `package.json`:

```json
"dependencies": {
  "api-schema-interceptor": "file:../api-schema-interceptor"
}
```

After changing the interceptor source, run `pnpm build` (or `npm run build`) in the interceptor package so the app uses updated `dist/`.

---

## Zod compatibility

- The package expects **Zod** (or any schema with a `safeParse` method) for route schemas.
- **`zod` is a peer dependency** (`>=3.20.0 <5`); install it in your app. The library does not bundle Zod at runtime.

---

## Limitations & caveats

- **`fetch`** is intercepted via `enable()`. **Axios** is supported via `enableAxios(axiosInstance, interceptor)`. Other clients (`XMLHttpRequest`, etc.) need `validateRequest`/`validateResponse` called manually or a custom adapter.
- **JSON only.** Request/response bodies that are not parsed as JSON are skipped (no validation, no error).
- **Pathname only.** Matching uses the URL pathname; host and query are ignored. Different hosts with the same pathname share one route.
- **Single global fetch.** Only one interceptor should call `enable()` at a time; behavior is undefined if multiple wrappers stack.
- **Log stores are per instance** unless you set `sharedStore: true` (then they share `globalLogStore`, max 1000 entries).
- **`dashboard` destination** is reserved; behavior is not implemented yet.
- **Browser and Node 18+.** Requires `globalThis.fetch`. In Node, ensure the interceptor is enabled in the same process that runs the `fetch` calls (e.g. via instrumentation in Next).

---

## License

ISC
