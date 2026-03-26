/**
 * PathMatcher – maps concrete URLs like "POST /users/42"
 * to registered patterns like "POST /users/:id"
 */

export function parseRouteKey(key: string): { method: string; pattern: string } {
  const spaceIdx = key.indexOf(" ");
  if (spaceIdx === -1) return { method: "GET", pattern: key };
  return {
    method: key.slice(0, spaceIdx).toUpperCase(),
    pattern: key.slice(spaceIdx + 1),
  };
}

/**
 * Convert a route pattern like `/users/:id/posts/:postId`
 * into a RegExp that matches concrete paths.
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex chars
    .replace(/:(\w+)/g, "([^/]+)"); // :param → capture group
  return new RegExp(`^${escaped}$`);
}

export interface MatchResult {
  routeKey: string;
  params: Record<string, string>;
}

export function matchRoute(
  method: string,
  url: string,
  registeredKeys: string[]
): MatchResult | null {
  const upperMethod = method.toUpperCase();

  // strip origin + query
  let pathname: string;
  try {
    const u = new URL(url, "http://localhost");
    pathname = u.pathname;
  } catch {
    pathname = url.split("?")[0];
  }

  for (const key of registeredKeys) {
    const { method: regMethod, pattern } = parseRouteKey(key);
    if (regMethod !== upperMethod) continue;

    const regex = patternToRegex(pattern);
    const match = pathname.match(regex);
    if (match) {
      // extract named params
      const paramNames = [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]);
      const params: Record<string, string> = {};
      paramNames.forEach((name, i) => {
        params[name] = match[i + 1] ?? "";
      });
      return { routeKey: key, params };
    }
  }

  return null;
}
