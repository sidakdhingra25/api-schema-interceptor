import type { ConsoleAggregation, FieldError, LogEntry } from "./types";

/** Human-readable issue text (shared by aggregated and verbose console rows). */
function humanMessage(err: FieldError): string {
  if (err.received === "undefined") {
    return "field is missing";
  }
  if (err.expected === "unknown" || err.received === "unknown") {
    return err.message;
  }
  if (err.received === err.expected) {
    return `invalid format — expected a valid ${err.expected}`;
  }
  return `got a ${err.received}, expected a ${err.expected}`;
}

function pathToPattern(path: (string | number)[]): string {
  if (path.length === 0) return "root";
  return path.map((seg) => (typeof seg === "number" ? "*" : String(seg))).join(".");
}

function normKeyPart(s: string): string {
  return s.trim();
}

function groupingKey(err: FieldError): string {
  const pattern = pathToPattern(err.path);
  const e = normKeyPart(err.expected);
  const r = normKeyPart(err.received);
  return `${pattern}\0${e}\0${r}`;
}

function numericIndices(path: (string | number)[]): number[] {
  return path.filter((p): p is number => typeof p === "number");
}

/** Single index position when the path has exactly one numeric segment (v1 aggregation). */
function singleNumericIndex(path: (string | number)[]): number | null {
  const nums = numericIndices(path);
  return nums.length === 1 ? nums[0]! : null;
}

function groupErrorsByKey(errors: FieldError[]): FieldError[][] {
  const map = new Map<string, FieldError[]>();
  const order: string[] = [];
  for (const err of errors) {
    const k = groupingKey(err);
    if (!map.has(k)) {
      order.push(k);
      map.set(k, []);
    }
    map.get(k)!.push(err);
  }
  return order.map((k) => map.get(k)!);
}

/** Merge consecutive indices into ranges; non-consecutive stay comma-separated. */
function formatIndicesForDisplay(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (i === j) {
      parts.push(String(sorted[i]));
    } else {
      parts.push(`${sorted[i]}\u2013${sorted[j]}`);
    }
    i = j + 1;
  }
  return parts.join(", ");
}

function shouldAggregateGroup(group: FieldError[]): boolean {
  if (group.length < 2) return false;
  return group.every((e) => numericIndices(e.path).length === 1);
}

/**
 * Prints validation result to the browser or Node console (boxed output).
 * Called for every matched route validation before strict-mode throws.
 */
export function printToConsole(entry: LogEntry, consoleAggregation: ConsoleAggregation): void {
  const mode = entry.mode;

  if (entry.valid) {
    return;
  }

  const ts = new Date(entry.timestamp).toISOString().split("T")[1] ?? "";

  /** Inner width between box borders (wide enough for aggregated array rows). */
  const INNER = 100;
  const top = "┌─ api-schema-interceptor " + "─".repeat(INNER - 24) + "┐";
  const bottom = "└" + "─".repeat(INNER + 2) + "┘";
  const blank = `│ ${" ".repeat(INNER)} │`;
  const line = (s: string) => `│ ${s.slice(0, INNER).padEnd(INNER)} │`;

  const header = `FAIL  ${entry.method} ${entry.routePattern}  [${entry.direction}]`;
  const mUnderlying = entry.errors.length;

  const bodyLines: string[] = [];
  if (consoleAggregation === "off") {
    for (const err of entry.errors) {
      const field = err.path.join(".") || "root";
      bodyLines.push(line(`  ✗  ${field}  ${humanMessage(err)}`));
    }
  } else {
    const groups = groupErrorsByKey(entry.errors);
    for (const group of groups) {
      if (group.length === 1) {
        const err = group[0]!;
        const field = pathToPattern(err.path);
        bodyLines.push(line(`  ✗  ${field}  ${humanMessage(err)}`));
        continue;
      }

      if (shouldAggregateGroup(group)) {
        const err0 = group[0]!;
        const pattern = pathToPattern(err0.path);
        const indices = group.map((e) => singleNumericIndex(e.path)).filter((n): n is number => n !== null);
        const human = humanMessage(err0);
        const idxStr = formatIndicesForDisplay(indices);
        const suffix = ` ·  repeated for indices ${idxStr} (${group.length}×)`;
        bodyLines.push(line(`  ✗  ${pattern}  ${human}${suffix}`));
      } else {
        // TODO v2: nested aggregation — richer multi-index summaries for paths with
        // more than one numeric segment in `FieldError.path`.
        for (const err of group) {
          const field = err.path.join(".") || "root";
          bodyLines.push(line(`  ✗  ${field}  ${humanMessage(err)}`));
        }
      }
    }
  }

  const kLines = bodyLines.length;
  const summary = `mode: ${mode} · ${kLines} line${kLines !== 1 ? "s" : ""} / ${mUnderlying} underlying · ${ts}`;

  const rows = [
    top,
    line(header),
    blank,
    ...bodyLines,
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
