/** Thrown for non-2xx responses; carries the HTTP status so callers can tell 404 apart from transient failures. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Error messages can end up in on-screen toasts — never echo the query string, which may carry role keys. */
const redact = (url: string): string => url.split('?')[0]!;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  let parseFailed = false;
  try {
    data = await res.json();
  } catch {
    parseFailed = true;
  }
  if (!res.ok) {
    const message =
      data !== null && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? ((data as { error: string }).error)
        : `${method} ${redact(url)} failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  // Every endpoint returns a JSON body on success — a malformed or truncated
  // 2xx response must fail loudly, not surface as {} to the caller.
  if (parseFailed) throw new ApiError(`${method} ${redact(url)} returned an unreadable response`, res.status);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};
