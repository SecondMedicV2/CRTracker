export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// FastAPI sends validation problems as a list of {msg}; everything else as a plain string.
function readable(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d?.msg).filter(Boolean).join("; ") || "Please check what you entered.";
  return "Something went wrong. Please try again.";
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/v1${path}`, {
      method: init.method ?? "GET",
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith("/auth/login") && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login"; // session expired
    throw new ApiError(401, "Your session has ended. Please sign in again.");
  }
  if (!r.ok) throw new ApiError(r.status, readable(data.detail));
  return data;
}
