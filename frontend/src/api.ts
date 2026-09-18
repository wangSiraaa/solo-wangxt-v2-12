export interface ApiError {
  message: string;
  details?: string[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = new Error(data?.message ?? `HTTP ${res.status}`) as Error & {
      details?: string[];
    };
    e.details = data?.details;
    throw e;
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown) =>
    req<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) =>
    req<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
  upload: <T>(path: string, form: FormData) =>
    req<T>(path, { method: 'POST', body: form }),
};

export function fpShort(fp?: string | null, n = 16): string {
  if (!fp) return '—';
  return fp.split(':').slice(0, n).join(':');
}
