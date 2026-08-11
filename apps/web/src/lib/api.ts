import type { Capabilities, UserRole } from '@constack/shared-types';

let csrfToken = '';
export function setCsrfToken(token: string) {
  csrfToken = token;
}

export interface SessionResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
    organizationId: string;
    role: UserRole;
    csrfToken: string;
  };
  csrfToken: string;
  oidcEnabled?: boolean;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('content-type', 'application/json');
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase()) && csrfToken)
    headers.set('x-csrf-token', csrfToken);
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'include' });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    throw new Error(
      Array.isArray(payload.message)
        ? payload.message.join(', ')
        : (payload.message ?? `Request failed (${response.status})`),
    );
  }
  return response.json() as Promise<T>;
}

export type { Capabilities };
