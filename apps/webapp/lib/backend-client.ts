export const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function getAccessToken() {
  if (typeof window === "undefined") return null;
  const token = window.localStorage?.getItem("access_token");
  return token && token.trim().length > 0 ? token : null;
}

export async function backendFetch(path: string, init?: RequestInit) {
  const token = getAccessToken();

  const headers = new Headers(init?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${BACKEND_BASE_URL}${path}`, { ...init, headers });
}

