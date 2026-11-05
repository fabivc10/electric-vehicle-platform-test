import { randomUUID } from 'node:crypto';
import type { ActivityDirection, ActivityEntry } from '@ev/shared';
import type { EventBus } from '../events/EventBus.js';
import type { ActivityRepository } from '../ports/repositories.js';

export interface ActivityInput {
  chargePointId: string;
  direction: ActivityDirection;
  action: string;
  summary: string;
  message?: string;
  ok?: boolean;
}

/** Registra el tráfico de alto nivel que se muestra en el panel "Eventos OCPP". */
export class ActivityLog {
  constructor(
    private readonly repo: ActivityRepository,
    private readonly bus: EventBus,
  ) {}

  async record(input: ActivityInput): Promise<ActivityEntry> {
    const entry: ActivityEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ok: true,
      ...input,
    };
    await this.repo.append(entry);
    this.bus.publish({ type: 'activity', entry });
    return entry;
  }

  list(chargePointId: string, limit = 50) {
    return this.repo.list(chargePointId, limit);
  }
}
