import type { SubscriptionManager } from '../subscription/subscription-manager.js';
import type {
  ComputedFieldDefinition,
  ComputedFieldsConfig,
  ConstraintDefinition,
  DerivedViewDefinition,
  DerivedViewExplanation,
  DerivedViewInfo,
  Expression,
  SendFn,
  Unsubscribe,
} from '../types.js';

export class LogicAPI {
  constructor(
    private readonly send: SendFn,
    private readonly subscriptions: SubscriptionManager,
  ) {}

  // ── Computed Fields ──────────────────────────────────────────────

  async defineComputed(
    bucket: string,
    fields: Record<string, ComputedFieldDefinition>,
  ): Promise<void> {
    await this.send('logic.defineComputed', {
      bucket,
      fields: fields as unknown as Record<string, unknown>,
    });
  }

  async dropComputed(bucket: string): Promise<boolean> {
    const result = await this.send('logic.dropComputed', { bucket }) as { dropped: boolean };
    return result.dropped;
  }

  async listComputed(): Promise<ComputedFieldsConfig[]> {
    return this.send('logic.listComputed', {}) as Promise<ComputedFieldsConfig[]>;
  }

  // ── Derived Views ────────────────────────────────────────────────

  async defineView(definition: DerivedViewDefinition): Promise<void> {
    await this.send('logic.defineView', {
      definition: definition as unknown as Record<string, unknown>,
    });
  }

  async dropView(name: string): Promise<boolean> {
    const result = await this.send('logic.dropView', { name }) as { dropped: boolean };
    return result.dropped;
  }

  async queryView(name: string): Promise<Record<string, unknown>[]> {
    return this.send('logic.queryView', { name }) as Promise<Record<string, unknown>[]>;
  }

  async explainView(name: string): Promise<DerivedViewExplanation> {
    return this.send('logic.explainView', { name }) as Promise<DerivedViewExplanation>;
  }

  async listViews(): Promise<DerivedViewInfo[]> {
    return this.send('logic.listViews', {}) as Promise<DerivedViewInfo[]>;
  }

  async subscribeView(
    name: string,
    callback: (data: Record<string, unknown>[]) => void,
  ): Promise<Unsubscribe> {
    const result = await this.send('logic.subscribeView', { name }) as {
      subscriptionId: string;
      data: Record<string, unknown>[];
    };

    this.subscriptions.register({
      id: result.subscriptionId,
      channel: 'logic',
      callback: callback as (data: unknown) => void,
      resubscribe: { type: 'logic.subscribeView', payload: { name } },
    });

    // Deliver initial data synchronously after registration.
    try {
      callback(result.data);
    } catch (err) {
      this.subscriptions.unregister(result.subscriptionId);
      this.send('logic.unsubscribeView', { subscriptionId: result.subscriptionId }).catch(() => {});
      throw err;
    }

    return () => {
      this.subscriptions.unregister(result.subscriptionId);
      this.send('logic.unsubscribeView', { subscriptionId: result.subscriptionId }).catch(() => {});
    };
  }

  async unsubscribeView(subscriptionId: string): Promise<void> {
    this.subscriptions.unregister(subscriptionId);
    await this.send('logic.unsubscribeView', { subscriptionId });
  }

  // ── Constraints ──────────────────────────────────────────────────

  async defineConstraint(constraint: ConstraintDefinition): Promise<void> {
    await this.send('logic.defineConstraint', {
      constraint: constraint as unknown as Record<string, unknown>,
    });
  }

  async dropConstraint(name: string): Promise<boolean> {
    const result = await this.send('logic.dropConstraint', { name }) as { dropped: boolean };
    return result.dropped;
  }

  async listConstraints(): Promise<ConstraintDefinition[]> {
    return this.send('logic.listConstraints', {}) as Promise<ConstraintDefinition[]>;
  }

  // ── Expression (utility) ─────────────────────────────────────────

  async evaluateExpr(
    expr: Expression,
    record?: Record<string, unknown>,
  ): Promise<unknown> {
    const payload: Record<string, unknown> = { expr };
    if (record !== undefined) payload['record'] = record;
    return this.send('logic.evaluateExpr', payload);
  }
}
