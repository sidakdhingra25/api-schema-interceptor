/**
 * Axios adapter – validates axios request/response bodies using SchemaInterceptor.
 * Use enableAxios(axiosInstance, interceptor) to attach; use the returned
 * function to teardown.
 */

import type { SchemaInterceptor } from "../registry";
import type { RouteSchema } from "../types";

/** Axios-like request config (minimal shape we need; avoids hard dependency on axios). */
interface AxiosLikeRequestConfig {
  method?: string;
  url?: string;
  baseURL?: string;
  data?: unknown;
}

/** Axios-like response (minimal shape we need). */
interface AxiosLikeResponse {
  config: AxiosLikeRequestConfig;
  data: unknown;
  status: number;
}

/** Axios-like instance with interceptors (satisfied by axios default or created instance). */
interface AxiosLikeInstance {
  interceptors: {
    request: {
      use(
        onFulfilled?: (config: AxiosLikeRequestConfig) => AxiosLikeRequestConfig | Promise<AxiosLikeRequestConfig>
      ): number;
      eject(id: number): void;
    };
    response: {
      use(
        onFulfilled?: (res: AxiosLikeResponse) => AxiosLikeResponse | Promise<AxiosLikeResponse>,
        onRejected?: (err: unknown) => unknown
      ): number;
      eject(id: number): void;
    };
  };
}

function buildFullUrl(config: AxiosLikeRequestConfig): string {
  const url = config.url ?? "";
  const baseURL = config.baseURL ?? "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (!baseURL) {
    return url || "/";
  }
  const base = baseURL.replace(/\/$/, "");
  const path = url.replace(/^\//, "");
  return path ? `${base}/${path}` : base;
}

function isJsonBody(data: unknown): data is Record<string, unknown> | unknown[] {
  if (data === undefined || data === null) return false;
  if (typeof data === "string") {
    try {
      JSON.parse(data);
      return true;
    } catch {
      return false;
    }
  }
  return typeof data === "object";
}

/**
 * Attach request/response interceptors to an axios instance so that every
 * request and response is validated against the given SchemaInterceptor
 * (same routes, modes, and log store as fetch interception).
 *
 * @param axiosInstance - Your axios instance (default or created with axios.create())
 * @param interceptor - The same SchemaInterceptor from createInterceptor()
 * @returns Teardown function; call it to remove the interceptors (e.g. disableAxios())
 */
export function enableAxios(
  axiosInstance: AxiosLikeInstance,
  interceptor: SchemaInterceptor<Record<string, RouteSchema>>
): () => void {
  const requestId = axiosInstance.interceptors.request.use(
    (config: AxiosLikeRequestConfig) => {
      const method = (config.method ?? "get").toUpperCase();
      const url = buildFullUrl(config);
      const data = config.data;

      if (data !== undefined && isJsonBody(data)) {
        const body = typeof data === "string" ? JSON.parse(data) : data;
        interceptor.validateRequest(method, url, body);
      }

      return config;
    }
  );

  const responseId = axiosInstance.interceptors.response.use(
    (response: AxiosLikeResponse) => {
      const config = response.config;
      const method = (config.method ?? "get").toUpperCase();
      const url = buildFullUrl(config);
      const data = response.data;

      if (data !== undefined && data !== null && typeof data === "object") {
        interceptor.validateResponse(method, url, data, response.status);
      }

      return response;
    },
    (error: unknown) => {
      // Let failed requests (network, 4xx/5xx) propagate; we don't validate error response body here
      return Promise.reject(error);
    }
  );

  return () => {
    axiosInstance.interceptors.request.eject(requestId);
    axiosInstance.interceptors.response.eject(responseId);
  };
}
