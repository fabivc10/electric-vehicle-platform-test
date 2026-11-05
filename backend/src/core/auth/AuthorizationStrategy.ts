import type { AuthorizationStatus } from '@ev/shared';

/** Strategy: la política de autorización de idTags es intercambiable. */
export interface AuthorizationStrategy {
  authorize(chargePointId: string, idTag: string): Promise<AuthorizationStatus>;
}

export class AcceptAllAuthorization implements AuthorizationStrategy {
  async authorize(): Promise<AuthorizationStatus> {
    return 'Accepted';
  }
}

export class LocalListAuthorization implements AuthorizationStrategy {
  private readonly allowed: Set<string>;

  constructor(idTags: string[]) {
    this.allowed = new Set(idTags.map((t) => t.toUpperCase()));
  }

  async authorize(_chargePointId: string, idTag: string): Promise<AuthorizationStatus> {
    return this.allowed.has(idTag.toUpperCase()) ? 'Accepted' : 'Invalid';
  }
}
