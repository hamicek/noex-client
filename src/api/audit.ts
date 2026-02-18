import type { AuditEntry, AuditQuery, SendFn } from '../types.js';

export class AuditAPI {
  constructor(private readonly send: SendFn) {}

  async query(filter?: AuditQuery): Promise<AuditEntry[]> {
    const payload: Record<string, unknown> = {};

    if (filter !== undefined) {
      if (filter.userId !== undefined) payload['userId'] = filter.userId;
      if (filter.operation !== undefined) payload['operation'] = filter.operation;
      if (filter.result !== undefined) payload['result'] = filter.result;
      if (filter.from !== undefined) payload['from'] = filter.from;
      if (filter.to !== undefined) payload['to'] = filter.to;
      if (filter.limit !== undefined) payload['limit'] = filter.limit;
    }

    const result = await this.send('audit.query', payload) as { entries: AuditEntry[] };
    return result.entries;
  }
}
