import type { LogEntry, Destination } from "./types";

type Subscriber = (entry: LogEntry) => void;

const MAX_ENTRIES = 1000;

/**
 * In-memory log store with pub/sub support.
 * Used by the interceptor core. Each SchemaInterceptor instance
 * should own its own LogStore by default; a global singleton is
 * exported only for explicit shared-store usage.
 */
export class LogStore {
  private entries: LogEntry[] = [];
  private subscribers: Set<Subscriber> = new Set();
  private warnedCap = false;

  push(entry: LogEntry, destinations: Destination[]) {
    // store in memory only when configured
    if (destinations.includes("memory")) {
      this.entries.push(entry);
      this.trim();
    }

    // console output
    if (destinations.includes("console")) {
      this.printToConsole(entry);
    }

    // notify subscribers
    this.subscribers.forEach((fn) => fn(entry));
  }

  private trim() {
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
      if (!this.warnedCap) {
        this.warnedCap = true;
        console.warn(
          "[api-schema-interceptor] Log store reached 1000 entries and is dropping oldest entries. " +
            "Call interceptor.clearLogs() periodically to prevent this."
        );
      }
    }
  }

  getAll(): LogEntry[] {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  get length() {
    return this.entries.length;
  }

  private printToConsole(entry: LogEntry) {
    const mode = entry.mode;
    const ts = new Date(entry.timestamp).toISOString().split("T")[1] ?? "";

    if (entry.valid) {
      if (mode === "warn" || mode === "strict") {
        console.log(
          `✓  ${entry.method} ${entry.routePattern}  [${entry.direction}]  ${ts}`
        );
      }
      return;
    }

    const INNER = 58;
    const top = "┌─ api-schema-interceptor " + "─".repeat(INNER - 24) + "┐";
    const bottom = "└" + "─".repeat(INNER + 2) + "┘";
    const blank = `│ ${" ".repeat(INNER)} │`;
    const line = (s: string) => `│ ${s.slice(0, INNER).padEnd(INNER)} │`;

    const header = `FAIL  ${entry.method} ${entry.routePattern}  [${entry.direction}]`;
    const summary = `mode: ${mode} · ${entry.errors.length} error${entry.errors.length !== 1 ? "s" : ""} · ${ts}`;

    const rows = [
      top,
      line(header),
      blank,
      ...entry.errors.map((err) => {
        const field = err.path.join(".") || "root";
        const human =
          err.received === "undefined"
            ? "field is missing"
            : err.expected === "unknown" || err.received === "unknown"
              ? err.message
              : err.received === err.expected
                ? `invalid format — expected a valid ${err.expected}`
                : `got a ${err.received}, expected a ${err.expected}`;

        return line(`  ✗  ${field}  ${human}`);
      }),
      blank,
      line(summary),
      bottom,
    ];

    const out = rows.join("\n");

    if (mode === "strict") {
      console.error(out);
    } else if (mode === "warn") {
      console.warn(out);
    } else {
      console.log(out);
    }
  }
}

// Global singleton for explicit shared-store usage (config.sharedStore)
export const globalLogStore = new LogStore();
