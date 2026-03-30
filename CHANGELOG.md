# Changelog

## 2.2.1

**Behavior**

- Successful validations no longer emit a **✓** line in `warn` / `strict` / `observe` — only failures are logged.

## 2.2.0

**Features**

- **`consoleAggregation`** on `InterceptorConfig` (default **`"array"`**): collapses repeated **single-level** array validation failures that share the same structural key (`pattern` + `expected` + `received`) into one boxed console line, with an index summary (ranges or sparse lists).
- **`"off"`** restores one console row per `FieldError` (legacy layout).
- FAIL box footer now reports **`K lines / M underlying`**: **`M`** is always `entry.errors.length`; **`K`** counts every `✗` line printed (aggregated rows and per-error fallbacks).

**Notes**

- Paths with **more than one numeric segment** (nested arrays) are not merged in this release; they print one line per error. A **`// TODO v2: nested aggregation`** marker in `log-store.ts` documents the follow-up.

**API**

- **`printToConsole(entry, consoleAggregation)`** (internal) — second argument required when calling from forked code.

## 2.1.0

**Breaking changes**

- Removed `LogEntry.data` (it was never shown in console output after v2.0).
- Removed `redact` from `InterceptorConfig` and deleted the internal `redactor` module.

## 2.0.0

**Breaking changes**

- Removed in-memory log retention: `destinations`, `sharedStore`, `Destination` type.
- Removed `interceptor.getLogs()`, `interceptor.clearLogs()`, `interceptor.subscribe()`.
- Removed exports: `LogStore`, `globalLogStore`.
- Validation output is **console only** via the existing boxed `printToConsole` behavior. Strict mode still **prints the box, then throws** (unchanged order).

Migration: delete any config or code using the removed APIs; rely on the browser/terminal console for validation output.
