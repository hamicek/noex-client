import type {
  ProcedureConfig,
  ProcedureResult,
  ProcedureSummary,
  SendFn,
} from '../types.js';

export class ProceduresAPI {
  constructor(private readonly send: SendFn) {}

  // ── Admin ──────────────────────────────────────────────────────────

  async register(
    procedure: ProcedureConfig,
  ): Promise<{ name: string; registered: boolean }> {
    return this.send('procedures.register', {
      procedure: procedure as unknown as Record<string, unknown>,
    }) as Promise<{ name: string; registered: boolean }>;
  }

  async unregister(name: string): Promise<{ name: string; unregistered: boolean }> {
    return this.send('procedures.unregister', { name }) as Promise<{
      name: string;
      unregistered: boolean;
    }>;
  }

  async update(
    name: string,
    updates: Partial<ProcedureConfig>,
  ): Promise<{ name: string; updated: boolean }> {
    return this.send('procedures.update', {
      name,
      updates: updates as unknown as Record<string, unknown>,
    }) as Promise<{ name: string; updated: boolean }>;
  }

  async get(name: string): Promise<ProcedureConfig> {
    return this.send('procedures.get', { name }) as Promise<ProcedureConfig>;
  }

  async list(): Promise<{ procedures: ProcedureSummary[] }> {
    return this.send('procedures.list', {}) as Promise<{ procedures: ProcedureSummary[] }>;
  }

  // ── Execution ──────────────────────────────────────────────────────

  async call(
    name: string,
    input?: Record<string, unknown>,
  ): Promise<ProcedureResult> {
    return this.send('procedures.call', {
      name,
      input: input ?? {},
    }) as Promise<ProcedureResult>;
  }
}
