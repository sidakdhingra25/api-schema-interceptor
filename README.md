## API Schema Interceptor

> **v2.0** removes in-memory logging (`getLogs`, `subscribe`, `destinations`, etc.). Output is **console only**. See [CHANGELOG.md](./CHANGELOG.md).

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
| 5 | Validation passes | Nothing is printed for success (only failures produce console output) |
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

For **Vite**, **CRA**, **React Router**, etc. (not Next.js App Router). There is no React component in this package—call **`interceptor.enable()`** once at startup.

### 1. Schema module

```bash
npx api-schema-interceptor init
```

Pick **React**. The CLI creates **`lib/api-schemas.ts`** or **`src/lib/api-schemas.ts`**. Export **`interceptor`** from `createInterceptor({ ... })` (or add that file yourself).

### 2. Enable

Call **`interceptor.enable()`** in your **browser entry file**, right **before** **`createRoot(...).render(...)`** (or **`ReactDOM.render`**).

| Setup | Entry file (typical) |
| --- | --- |
| React (Vite) | `src/main.tsx` / `main.jsx` / `index.tsx` |
| CRA | `src/index.tsx` / `index.js` |

Don’t rely on **`useEffect`** for the first `enable()`—a child may **`fetch`** before that runs. Import **`interceptor`** with a path that resolves from that entry file (e.g. `../lib/api-schemas` or `./lib/api-schemas`).

### 3. Example

```tsx
import { createRoot } from "react-dom/client";
import { interceptor } from "./lib/api-schemas";
import App from "./App";
import "./index.css";

interceptor.enable();

createRoot(document.getElementById("root")!).render(<App />);
```

Fix the import to match your layout. Wrappers (`StrictMode`, router, …) go **inside** `render`; keep **`enable()`** above it.

### 4. `disable()` (optional)

Rarely needed; use for tests or when you restore real **`fetch`**.

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

### What you see when validation fails

When a request/response **does not** match your Zod schema, the package prints a **boxed message** in the browser DevTools console (or terminal). The exact API depends on `mode`:

| `mode` | On failure |
| --- | --- |
| `warn` | **`console.warn`** with the box below |
| `strict` | **`console.error`** with the same box, then it **throws** so execution stops |
| `observe` | **`console.log`** with the same box (no throw) |

**Example shape** (wording depends on the field; this matches how failures are formatted):

```text
┌─ api-schema-interceptor ───────────────────────────────────────────────────────────────────────┐
│ FAIL  GET /api/users/:id  [response]                                                         │
│                                                                                               │
│   ✗  email  invalid format — expected a valid email                                            │
│   ✗  name   field is missing                                                                   │
│                                                                                               │
│ mode: warn · 2 lines / 2 underlying · 12:34:56.789Z                                          │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **`FAIL … [request]`** = the JSON you **sent** didn’t match `request`.
- **`FAIL … [response]`** = the JSON you **received** didn’t match `response`.
- **Footer `K lines / M underlying`:** **`M`** is always the number of validation issues (`FieldError` count). **`K`** is how many `✗` lines were printed inside the box (after optional array aggregation). When issues merge into one line, **`K`** is smaller than **`M`**; when every issue has its own line, **`K`** equals **`M`**.
- **`strict` mode:** the box is printed **first**, then the interceptor **throws** (so you always see the failure in the console before the exception).

Successful validation does not print anything to the console (only failures produce output). If you set `validate: false` on a route, that route is skipped—no box for it.

### Array error aggregation (`consoleAggregation`)

When the same structural problem repeats across **array elements** (for example `0.title`, `1.title`, … with the same expected/received types), the default **`"array"`** mode groups those issues by a key derived from the **path pattern** (numbers become `*`), **`expected`**, and **`received`**—**not** by Zod’s free-form `message`, so groups stay stable.

- **Single numeric segment in the path** (e.g. `*.title`): multiple matching issues print as **one** `✗` line with a short index summary (contiguous ranges or comma-separated indices).
- **More than one numeric segment** (nested arrays, e.g. `*.posts.*.id`): v2.2 does **not** merge those into a single summary line; you get **one line per issue**. Richer nested summaries are **planned**; the source includes a **`// TODO v2: nested aggregation`** marker.

Set **`consoleAggregation: "off"`** if you prefer the older behavior: **one console row per `FieldError`**, with literal paths like `0.title`.

## Tables (simple reference)

### `createInterceptor({ ... })` options

| Option | Type | Default | In plain English |
| --- | --- | --- | --- |
| `mode` | `"observe" \| "warn" \| "strict"` | `"observe"` | **observe** = only notice problems; **warn** = shout in the console; **strict** = stop the app when something is wrong (good for tests) |
| `routes` | `Record<string, RouteSchema>` | required | The list of URLs you care about and the rules for each one |
| `warnOnUnmatched` | `boolean` | `false` | If **on**, you get a heads-up when the app calls a URL you never listed |
| `debug` | `boolean` | `false` | If **on** (and not production), prints extra “which route matched?” lines |
| `consoleAggregation` | `"off" \| "array"` | `"array"` | **`array`** = collapse repeated **same-shape** array element errors into one `✗` line when possible; **`off`** = one line per Zod issue (legacy). |

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
| `LogEntry` | `mode` | Same idea as your global mode (observe / warn / strict) |
| `LogEntry` | `statusCode?` | For responses: the HTTP status number (200, 404, etc.) |

---

## Package exports (what you can use)

The package gives you:

- `createInterceptor(config)` - create an interceptor instance
- `SchemaInterceptor` - the class (mostly for advanced usage / typing)
- `enableAxios(axiosInstance, interceptor)` - validate Axios requests/responses
- `validateMatch(...)` - helper for tests (checks matching + would-validate, without HTTP calls)

---

## Quick reference: common route fields

- `request?: Zod schema`
- `response?: Zod schema`
- `validate?: boolean` (default `true`)

---
