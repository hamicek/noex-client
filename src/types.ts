// ── Connection ────────────────────────────────────────────────────

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type Unsubscribe = () => void;

export interface WelcomeInfo {
  readonly version: string;
  readonly serverTime: number;
  readonly requiresAuth: boolean;
}

// ── WebSocket abstraction ────────────────────────────────────────

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onmessage: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

// ── Store ─────────────────────────────────────────────────────────

export type StoreRecord = Record<string, unknown>;

export interface RecordMeta {
  readonly id: string;
  readonly _version: number;
  readonly _createdAt: number;
  readonly _updatedAt: number;
}

export interface PaginatedResult<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly records: (T & RecordMeta)[];
  readonly hasMore: boolean;
  readonly nextCursor?: unknown;
}

// ── Transactions ─────────────────────────────────────────────────

export type TransactionOp =
  | { readonly op: 'get'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'insert'; readonly bucket: string; readonly data: Record<string, unknown> }
  | { readonly op: 'update'; readonly bucket: string; readonly key: unknown; readonly data: Record<string, unknown> }
  | { readonly op: 'delete'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'where'; readonly bucket: string; readonly filter: Record<string, unknown> }
  | { readonly op: 'findOne'; readonly bucket: string; readonly filter: Record<string, unknown> }
  | { readonly op: 'count'; readonly bucket: string; readonly filter?: Record<string, unknown> };

export interface TransactionResult {
  readonly results: ReadonlyArray<{ readonly index: number; readonly data: unknown }>;
}

// ── Store stats ──────────────────────────────────────────────────

export interface BucketsInfo {
  readonly count: number;
  readonly names: readonly string[];
}

export interface StoreStats {
  readonly name: string;
  readonly buckets: BucketsInfo;
  readonly records: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly indexes: {
    readonly total: number;
    readonly perBucket: Readonly<Record<string, number>>;
  };
  readonly queries: {
    readonly defined: number;
    readonly activeSubscriptions: number;
  };
  readonly persistence: {
    readonly enabled: boolean;
  };
  readonly ttl: {
    readonly enabled: boolean;
    readonly checkIntervalMs: number;
  };
}

// ── Rules ────────────────────────────────────────────────────────

export interface RulesEvent {
  readonly id: string;
  readonly topic: string;
  readonly data: Record<string, unknown>;
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly source: string;
}

export interface Fact {
  readonly key: string;
  readonly value: unknown;
  readonly timestamp: number;
  readonly source: string;
  readonly version: number;
}

// ── Rules stats ─────────────────────────────────────────────────

export interface RulesStats {
  readonly rulesCount: number;
  readonly factsCount: number;
  readonly timersCount: number;
  readonly eventsProcessed: number;
  readonly rulesExecuted: number;
  readonly avgProcessingTimeMs: number;
  readonly tracing?: {
    readonly enabled: boolean;
    readonly entriesCount: number;
    readonly maxEntries: number;
  };
  readonly profiling?: {
    readonly totalRulesProfiled: number;
    readonly totalTriggers: number;
    readonly totalExecutions: number;
    readonly totalTimeMs: number;
    readonly avgRuleTimeMs: number;
    readonly slowestRule: { readonly ruleId: string; readonly ruleName: string; readonly avgTimeMs: number } | null;
    readonly hottestRule: { readonly ruleId: string; readonly ruleName: string; readonly triggerCount: number } | null;
  };
  readonly audit?: {
    readonly totalEntries: number;
    readonly memoryEntries: number;
    readonly oldestEntry: number | null;
    readonly newestEntry: number | null;
    readonly entriesByCategory: Readonly<Record<string, number>>;
    readonly subscribersCount: number;
  };
  readonly versioning?: {
    readonly trackedRules: number;
    readonly totalVersions: number;
    readonly dirtyRules: number;
    readonly oldestEntry: number | null;
    readonly newestEntry: number | null;
  };
  readonly baseline?: {
    readonly metricsCount: number;
    readonly totalRecalculations: number;
    readonly anomaliesDetected: number;
  };
}

// ── Rules Admin ─────────────────────────────────────────────────

export type RuleTrigger =
  | { readonly type: 'event'; readonly topic: string }
  | { readonly type: 'fact'; readonly pattern: string }
  | { readonly type: 'timer'; readonly name: string }
  | { readonly type: 'temporal'; readonly pattern: Record<string, unknown> };

export type ConditionOperator =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'not_in'
  | 'contains' | 'not_contains'
  | 'matches'
  | 'exists' | 'not_exists';

export type ConditionSource =
  | { readonly type: 'fact'; readonly pattern: string }
  | { readonly type: 'event'; readonly field: string }
  | { readonly type: 'context'; readonly key: string }
  | { readonly type: 'lookup'; readonly name: string; readonly field?: string };

export interface RuleCondition {
  readonly source: ConditionSource;
  readonly operator: ConditionOperator;
  readonly value: unknown;
}

export type RuleAction =
  | { readonly type: 'set_fact'; readonly key: string; readonly value: unknown }
  | { readonly type: 'delete_fact'; readonly key: string }
  | { readonly type: 'emit_event'; readonly topic: string; readonly data?: Record<string, unknown> }
  | { readonly type: 'set_timer'; readonly timer: Record<string, unknown> }
  | { readonly type: 'cancel_timer'; readonly name: string }
  | { readonly type: 'call_service'; readonly service: string; readonly method: string; readonly args?: readonly unknown[] }
  | { readonly type: 'log'; readonly level: 'debug' | 'info' | 'warn' | 'error'; readonly message: string }
  | { readonly type: 'conditional'; readonly conditions: readonly RuleCondition[]; readonly then: readonly RuleAction[]; readonly else?: readonly RuleAction[] };

export interface RuleInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly tags: readonly string[];
  readonly group?: string;
  readonly trigger: RuleTrigger;
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly RuleAction[];
  readonly lookups?: readonly Record<string, unknown>[];
}

export interface RuleInfo {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface RuleSummary {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly version: number;
  readonly tags: readonly string[];
  readonly group?: string;
}

export interface RuleDetail {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly version: number;
  readonly tags: readonly string[];
  readonly group?: string;
  readonly trigger: RuleTrigger;
  readonly conditions: readonly RuleCondition[];
  readonly actions: readonly RuleAction[];
  readonly lookups?: readonly Record<string, unknown>[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

// ── Audit ────────────────────────────────────────────────────────

export interface AuditEntry {
  readonly timestamp: number;
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly operation: string;
  readonly resource: string;
  readonly result: 'success' | 'error';
  readonly error?: string;
  readonly details?: Record<string, unknown>;
  readonly remoteAddress: string;
}

export interface AuditQuery {
  readonly userId?: string;
  readonly operation?: string;
  readonly result?: 'success' | 'error';
  readonly from?: number;
  readonly to?: number;
  readonly limit?: number;
}

// ── Auth ─────────────────────────────────────────────────────────

export interface AuthSession {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly expiresAt?: number;
}

// ── Store Admin ─────────────────────────────────────────────────

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'date';

export type GeneratedType = 'uuid' | 'cuid' | 'autoincrement' | 'timestamp';

export type FormatType = 'email' | 'url' | 'iso-date';

export interface FieldDefinition {
  readonly type: FieldType;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly generated?: GeneratedType;
  readonly enum?: readonly unknown[];
  readonly format?: FormatType;
  readonly min?: number;
  readonly max?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly ref?: string;
  readonly unique?: boolean;
}

export interface BucketDefinition {
  readonly key?: string;
  readonly schema: Readonly<Record<string, FieldDefinition>>;
  readonly indexes?: readonly string[];
  readonly ttl?: number | string;
  readonly persistent?: boolean;
  readonly maxSize?: number;
}

export interface BucketSchemaUpdate {
  readonly addFields?: Readonly<Record<string, FieldDefinition>>;
  readonly addIndexes?: readonly string[];
  readonly ttl?: number | string | null;
}

// ── Internal ──────────────────────────────────────────────────────

export type SendFn = (type: string, payload: Record<string, unknown>) => Promise<unknown>;

// ── Protocol ─────────────────────────────────────────────────────

export interface ServerMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}
