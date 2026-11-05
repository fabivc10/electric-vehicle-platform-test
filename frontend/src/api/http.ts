import type {
  ChargePoint,
  ChargePointCommand,
  ChargePointSnapshot,
  CommandResult,
  Transaction,
} from '@ev/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'HTTP_ERROR', err.message ?? res.statusText);
  }
  return body as T;
};

/** Cliente REST del backend. Único módulo que conoce las rutas HTTP. */
export const api = {
  listChargePoints: () => request<ChargePoint[]>('/charge-points'),
  snapshot: (id: string) => request<ChargePointSnapshot>(`/charge-points/${encodeURIComponent(id)}`),
  rename: (id: string, name: string) =>
    request<ChargePoint>(`/charge-points/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  remove: (id: string) => request<void>(`/charge-points/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  command: (id: string, command: ChargePointCommand) =>
    request<CommandResult>(`/charge-points/${encodeURIComponent(id)}/commands`, {
      method: 'POST',
      body: JSON.stringify(command),
    }),
  transactions: (params: { chargePointId?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.chargePointId) qs.set('chargePointId', params.chargePointId);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<Transaction[]>(`/transactions?${qs}`);
  },
};
