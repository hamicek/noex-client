import type { SubscriptionManager } from '../subscription/subscription-manager.js';
import type {
  Fact,
  RuleDetail,
  RuleInfo,
  RuleInput,
  RuleSummary,
  RulesEvent,
  RulesStats,
  SendFn,
  Unsubscribe,
  ValidationResult,
} from '../types.js';

export class RulesAPI {
  constructor(
    private readonly send: SendFn,
    private readonly subscriptions: SubscriptionManager,
  ) {}

  // ── Events ────────────────────────────────────────────────────────

  async emit(
    topic: string,
    data?: Record<string, unknown>,
    correlationId?: string,
    causationId?: string,
  ): Promise<RulesEvent> {
    const payload: Record<string, unknown> = { topic };
    if (data !== undefined) payload['data'] = data;
    if (correlationId !== undefined) {
      payload['correlationId'] = correlationId;
      if (causationId !== undefined) payload['causationId'] = causationId;
    }
    return this.send('rules.emit', payload) as Promise<RulesEvent>;
  }

  // ── Facts ─────────────────────────────────────────────────────────

  async setFact(key: string, value: unknown): Promise<Fact> {
    return this.send('rules.setFact', { key, value } as Record<string, unknown>) as Promise<Fact>;
  }

  async getFact(key: string): Promise<unknown | null> {
    return this.send('rules.getFact', { key });
  }

  async deleteFact(key: string): Promise<boolean> {
    const result = await this.send('rules.deleteFact', { key }) as { deleted: boolean };
    return result.deleted;
  }

  async queryFacts(pattern: string): Promise<Fact[]> {
    return this.send('rules.queryFacts', { pattern }) as Promise<Fact[]>;
  }

  async getAllFacts(): Promise<Fact[]> {
    return this.send('rules.getAllFacts', {}) as Promise<Fact[]>;
  }

  // ── Subscriptions ─────────────────────────────────────────────────

  async subscribe(
    pattern: string,
    callback: (event: RulesEvent, topic: string) => void,
  ): Promise<Unsubscribe> {
    const result = await this.send('rules.subscribe', { pattern }) as {
      subscriptionId: string;
    };

    this.subscriptions.register({
      id: result.subscriptionId,
      channel: 'event',
      callback: (data: unknown) => {
        const { topic, event } = data as { topic: string; event: RulesEvent };
        callback(event, topic);
      },
      resubscribe: { type: 'rules.subscribe', payload: { pattern } },
    });

    return () => {
      this.subscriptions.unregister(result.subscriptionId);
      this.send('rules.unsubscribe', { subscriptionId: result.subscriptionId }).catch(() => {});
    };
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.subscriptions.unregister(subscriptionId);
    await this.send('rules.unsubscribe', { subscriptionId });
  }

  // ── Admin ──────────────────────────────────────────────────────────

  async registerRule(rule: RuleInput): Promise<RuleInfo> {
    return this.send('rules.registerRule', {
      rule: rule as unknown as Record<string, unknown>,
    }) as Promise<RuleInfo>;
  }

  async unregisterRule(ruleId: string): Promise<{ ruleId: string; unregistered: boolean }> {
    return this.send('rules.unregisterRule', { ruleId }) as Promise<{
      ruleId: string;
      unregistered: boolean;
    }>;
  }

  async updateRule(
    ruleId: string,
    updates: Partial<RuleInput>,
  ): Promise<{ id: string; version: number; updatedAt: number }> {
    return this.send('rules.updateRule', {
      ruleId,
      updates: updates as unknown as Record<string, unknown>,
    }) as Promise<{ id: string; version: number; updatedAt: number }>;
  }

  async enableRule(ruleId: string): Promise<{ ruleId: string; enabled: boolean }> {
    return this.send('rules.enableRule', { ruleId }) as Promise<{
      ruleId: string;
      enabled: boolean;
    }>;
  }

  async disableRule(ruleId: string): Promise<{ ruleId: string; enabled: boolean }> {
    return this.send('rules.disableRule', { ruleId }) as Promise<{
      ruleId: string;
      enabled: boolean;
    }>;
  }

  async getRule(ruleId: string): Promise<RuleDetail> {
    return this.send('rules.getRule', { ruleId }) as Promise<RuleDetail>;
  }

  async getRules(): Promise<{ rules: RuleSummary[] }> {
    return this.send('rules.getRules', {}) as Promise<{ rules: RuleSummary[] }>;
  }

  async validateRule(rule: Record<string, unknown>): Promise<ValidationResult> {
    return this.send('rules.validateRule', { rule }) as Promise<ValidationResult>;
  }

  // ── Stats ──────────────────────────────────────────────────────────

  async stats(): Promise<RulesStats> {
    return this.send('rules.stats', {}) as Promise<RulesStats>;
  }
}
