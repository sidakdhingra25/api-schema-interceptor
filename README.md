## API Schema Interceptor

This package helps you validate your API requests and responses against your Zod schemas.
When a call matches a route you registered, it checks the JSON and logs whether it passed or failed.

It is designed to be easy to plug into apps that use `fetch` (and it also has an Axios adapter).

---

## What it does

Here’s what happens, step by step:

| Step | What you do | What the package does |
| --- | --- | --- |
| 1 | You list your API endpoints in `routes` | It keeps a map of which endpoint should be validated |
| 2 | You attach `request` and/or `response` Zod schemas | It knows what “valid JSON” should look like |
| 3 | Your app makes an API call | It watches the JSON traffic (for `fetch`, and Axios if enabled) |
| 4 | The call matches one of your route keys | It checks the JSON against the schema |
| 5 | Validation passes | Nothing “bad” happens; you can still keep logs depending on your mode |
| 6 | Validation fails | It prints a clear console message showing what field is wrong |
| 7 | You set `validate: false` for a route | It ignores that route completely (no validation + no console error for that route) |

---

## Install

Add this package to your app:

```bash
pnpm add api-schema-interceptor
```

You also need **Zod** in your project (it’s a peer dependency—you use it to write your schemas). If you already have Zod, you’re done. If not, add it:

```bash
pnpm add api-schema-interceptor zod
```

---

## React setup (manual)

If you are using React (not Next.js app router), you typically:

1. Create your interceptor config file (example: `lib/api-schemas.ts`)
2. Enable it at app startup (and disable it when you unmount, if you want)

Example config:

```ts
import { createInterceptor } from "api-schema-interceptor";
import { z } from "zod";

const healthSchema = z.object({ status: z.literal("ok") });
const apiErrorSchema = z.object({ error: z.string() });

export const interceptor = createInterceptor({
  mode: "warn",
  warnOnUnmatched: false,
  routes: {
    "GET /api/health": {
      response: z.union([healthSchema, apiErrorSchema]),
    },
    "POST /api/items": {
      request: z.object({ title: z.string() }),
      response: z.union([z.object({ id: z.string(), title: z.string() }), apiErrorSchema]),
    },
  },
});
```

Then enable it in your app root:

```ts
interceptor.enable();
```

---

## Next.js setup (CLI)

### 1. Run the CLI

From your Next.js app folder:

```bash
npx api-schema-interceptor init
```

Follow the prompts (framework + mode). When it finishes, you’ll have the files below and printed instructions for your root layout.

---

### 2. What gets created

| What | Where (typical paths) |
| --- | --- |
| Interceptor config | `lib/api-schemas.ts` **or** `src/lib/api-schemas.ts` |
| Client provider (enables `fetch` validation in the browser) | `components/providers/InterceptorProvider.tsx` **or** `src/components/providers/InterceptorProvider.tsx` |
| Barrel export (only if that file already exists) | `components/providers/index.ts` **or** `src/components/providers/index.ts` |

**Layout:** the CLI does **not** edit `app/layout.tsx` (or `src/app/layout.tsx`). It prints exact copy-paste steps so you stay in control.

---

### 3. Wire the provider in your root layout

1. Import `InterceptorProvider` (use the path the CLI printed for your project).
2. Wrap `{children}` (and any other providers you use) with it.

Example shape:

```tsx
import { InterceptorProvider } from "@/components/providers/InterceptorProvider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <InterceptorProvider>{children}</InterceptorProvider>
      </body>
    </html>
  );
}
```

Your import path may differ (e.g. `@/src/components/...`); follow the CLI output.

---

## How to create your API schema

You define routes inside the `routes` object.
Each route key looks like:

- `"METHOD /path"`
- for example: `"GET /api/health"`, `"POST /api/items"`, `"GET /api/users/:id"`

Each route entry can include:

- `request`: validate the JSON request body (optional)
- `response`: validate the JSON response body (optional)
- `validate`: optional boolean to turn validation on/off for this route
  - default is `true`
  - if `validate: false`, it will not validate and will not log errors for that route

Example:

```ts
const apiErrorSchema = z.object({ error: z.string() });

routes: {
  "GET /api/health": {
    response: z.union([
      z.object({ status: z.literal("ok") }),
      apiErrorSchema,
    ]),
  },
  "POST /api/items": {
    validate: false, // skip validation for this endpoint
    request: z.object({ title: z.string() }),
    response: z.union([z.object({ id: z.string() }), apiErrorSchema]),
  },
}
```

---

## Example full `api-schemas.ts` (all key options)

This example shows the main config fields and how route validation works. The URLs below are generic placeholders—swap them for your own API paths.

```ts
import { createInterceptor } from "api-schema-interceptor";
import { z } from "zod";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

const apiErrorSchema = z.object({
  error: z.string(),
});

export const interceptor = createInterceptor({
  // How strict it should be when validation fails
  mode: "warn", // "observe" | "warn" | "strict"

  // If true, you get a console warning when a route doesn't exist in your schema
  warnOnUnmatched: true,

  // Hide these keys before logging
  redact: ["password", "token"],

  // Where to send logs
  destinations: ["console", "memory"],

  // Share one memory store across multiple interceptors (optional)
  sharedStore: true,

  // Extra debug logs for route matching (in non-production)
  debug: true,

  routes: {
    // Validated endpoint (default behavior): GET user by id
    "GET /api/users/:id": {
      // validate defaults to true
      response: z.union([userSchema, apiErrorSchema]),
    },

    // Skipped endpoint: matched, but no validation + no warn/error logs
    "POST /api/login": {
      validate: false, // opt out for this endpoint
      request: z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
      response: z.object({
        accessToken: z.string(),
        expiresIn: z.number(),
      }),
    },
  },
});
```

## Tables (simple reference)

### `createInterceptor({ ... })` options

| Option | Type | Default | In plain English |
| --- | --- | --- | --- |
| `mode` | `"observe" \| "warn" \| "strict"` | `"observe"` | **observe** = only notice problems; **warn** = shout in the console; **strict** = stop the app when something is wrong (good for tests) |
| `routes` | `Record<string, RouteSchema>` | required | The list of URLs you care about and the rules for each one |
| `warnOnUnmatched` | `boolean` | `false` | If **on**, you get a heads-up when the app calls a URL you never listed |
| `redact` | `string[]` | `[]` | Field names (like `password`) that should be hidden in logs |
| `destinations` | `("console" \| "memory")[]` | `["console","memory"]` | **console** = print to the browser/terminal; **memory** = keep a copy you can read in code |
| `sharedStore` | `boolean` | `false` | If **on**, every interceptor instance shares the same saved logs |
| `debug` | `boolean` | `false` | If **on** (and not production), prints extra “which route matched?” lines |

### Route entry options (each `routes["METHOD /path"]` object)

| Field | Type | Default | In plain English |
| --- | --- | --- | --- |
| `request` | Zod schema | `undefined` | Rules for the JSON **you send** (optional) |
| `response` | Zod schema | `undefined` | Rules for the JSON **you get back** (optional) |
| `validate` | `boolean` | `true` | **false** = “don’t check this URL and don’t complain in the console for it” |

### Validation/log result types

| Type | Field | In plain English |
| --- | --- | --- |
| `ValidationResult` | `valid` | **true** = the JSON matched your rules |
| `ValidationResult` | `errors` | What went wrong, field by field (empty when all good) |
| `ValidationResult` | `log?` | One full record of that check (only when a route matched) |
| `FieldError` | `path` | Which part of the JSON was wrong (e.g. `user.email`) |
| `FieldError` | `expected` / `received` | What you asked for vs what actually came back |
| `FieldError` | `message` | Short human sentence about the problem |
| `LogEntry` | `method` / `path` / `routePattern` | Which call this was (GET/POST, full URL, and the pattern you registered) |
| `LogEntry` | `direction` | **request** = outgoing body, **response** = incoming body |
| `LogEntry` | `valid` + `errors` | Pass or fail, plus the list of issues |
| `LogEntry` | `data` | A copy of the JSON after hiding redacted fields |
| `LogEntry` | `mode` | Same idea as your global mode (observe / warn / strict) |
| `LogEntry` | `statusCode?` | For responses: the HTTP status number (200, 404, etc.) |

---

## Reading logs saved in `memory`

If you set `destinations: ["console", "memory"]`, the interceptor will keep a copy of every matched validation result in RAM.

### Get the logs

```ts
const logs = interceptor.getLogs();
console.log(logs); // LogEntry[]
```

Tip: the latest entry is at the end of the array:

```ts
const last = interceptor.getLogs().at(-1);
console.log(last);
```

### Watch logs as they happen

```ts
const stop = interceptor.subscribe((entry) => {
  console.log("New log:", entry);
});

// later
stop();
```

### Clear the in-memory logs

```ts
interceptor.clearLogs();
```

### If you used `sharedStore: true`

When `sharedStore` is enabled, the same saved logs can be shared between multiple interceptor instances.
You can still use `interceptor.getLogs()`, or (optionally) read the shared store directly:

```ts
import { globalLogStore } from "api-schema-interceptor";
const logs = globalLogStore.getAll();
```

---

## Package exports (what you can use)

The package gives you:

- `createInterceptor(config)` - create an interceptor instance
- `SchemaInterceptor` - the class (mostly for advanced usage / typing)
- `LogStore` and `globalLogStore` - where logs are stored (in memory)
- `enableAxios(axiosInstance, interceptor)` - validate Axios requests/responses
- `validateMatch(...)` - helper for tests (checks matching + would-validate, without HTTP calls)

---

## Quick reference: common route fields

- `request?: Zod schema`
- `response?: Zod schema`
- `validate?: boolean` (default `true`)

---
