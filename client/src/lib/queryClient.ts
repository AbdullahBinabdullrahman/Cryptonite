import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Use Render backend when deployed, local server in dev
const RENDER_URL = "https://cryptonite-wt0e.onrender.com";
const API_BASE = typeof window !== "undefined" && window.location.hostname !== "localhost"
  ? RENDER_URL
  : "";

// ── Persistent JWT store (localStorage) ──────────────────────────────────────
// Token is persisted to localStorage so it survives page refreshes and tab closes.
// The JWT has a 30-day TTL — server validates expiry on every request.
// On refresh the cached token is loaded immediately and sent to /api/auth/me.

const LS_KEY = "polybot_auth_token";

// Boot: load token from localStorage immediately when this module is imported
let _authToken: string | null = (() => {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
})();

export function setAuthToken(token: string | null) {
  _authToken = token;
  try {
    if (token) localStorage.setItem(LS_KEY, token);
    else       localStorage.removeItem(LS_KEY);
  } catch { /* private/incognito mode or storage full — ignore */ }
}

export function getAuthToken(): string | null { return _authToken; }

export function clearAuthToken() {
  _authToken = null;
  try { localStorage.removeItem(LS_KEY); } catch { }
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
    credentials: "include",
  });

  // If the response contains a new token (login/verify), store it
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
      credentials: "include",
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
