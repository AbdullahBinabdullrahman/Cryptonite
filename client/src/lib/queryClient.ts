import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Use Render backend when deployed, local server in dev
const RENDER_URL = "https://cryptonite-wt0e.onrender.com";
const API_BASE = typeof window !== "undefined" && window.location.hostname !== "localhost"
  ? RENDER_URL
  : "";

// ── In-memory JWT store ───────────────────────────────────────────────────────
// The server sets an HttpOnly cookie (polybot_token) on login.
// That cookie is automatically sent by the browser on every request — including
// after page refreshes — so no client-side persistence is needed here.
// The Bearer token is kept in memory as a secondary auth path (e.g. same-tab
// API calls that need it in headers).

let _authToken: string | null = null;

export function setAuthToken(token: string | null) {
  _authToken = token;
}

export function getAuthToken(): string | null { return _authToken; }

export function clearAuthToken() {
  _authToken = null;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (_authToken) h["Authorization"] = `Bearer ${_authToken}`;
  return h;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: authHeaders(data ? { "Content-Type": "application/json" } : {}),
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",   // sends HttpOnly cookie automatically
  });

  // If the response contains a new token (login/verify), store it in-memory
  if (res.headers.get("content-type")?.includes("application/json")) {
    const clone = res.clone();
    clone.json().then(d => { if (d?.token) setAuthToken(d.token); }).catch(() => {});
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      headers: authHeaders(),
      credentials: "include",   // sends HttpOnly cookie automatically
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
