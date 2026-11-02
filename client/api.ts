export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly setupUrl?: string) { super(message); }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, { cache: "no-store", signal });
}

export async function postJson<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    signal,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = path.startsWith("/api/google-calendar/")
    ? setTimeout(() => { timedOut = true; controller.abort(); }, 20_000)
    : undefined;
  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    const payload = await response.json() as T & { error?: string; code?: string; setupUrl?: string };
    if (!response.ok) throw new ApiError(payload.error ?? `HTTP ${response.status}`, response.status, payload.code, payload.setupUrl);
    return payload;
  } catch (error) {
    if (timedOut) throw new Error("Request timed out. Try Refresh again.");
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}
