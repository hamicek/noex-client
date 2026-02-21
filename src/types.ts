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

// ── Filter Operators ─────────────────────────────────────────────

export interface FilterOperators {
  readonly $eq?: unknown;
  readonly $neq?: unknown;
  readonly $gt?: number | string;
  readonly $gte?: number | string;
  readonly $lt?: number | string;
  readonly $lte?: number | string;
  readonly $in?: readonly unknown[];
  readonly $nin?: readonly unknown[];
  readonly $contains?: string;
  readonly $startsWith?: string;
  readonly $endsWith?: string;
  readonly $exists?: boolean;
  readonly $between?: readonly [number | string, number | string];
}

export type FilterValue = unknown | FilterOperators;

export interface WhereFilter {
  readonly $or?: readonly WhereFilter[];
  readonly $and?: readonly WhereFilter[];
  readonly [field: string]: FilterValue;
}

export type BucketFilter<T extends Record<string, unknown> = Record<string, unknown>> = {
  readonly [K in keyof T]?: T[K] | FilterOperators;
} & {
  readonly $or?: readonly BucketFilter<T>[];
  readonly $and?: readonly BucketFilter<T>[];
};

// ── Transactions ─────────────────────────────────────────────────

export type TransactionOp =
  | { readonly op: 'get'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'insert'; readonly bucket: string; readonly data: Record<string, unknown> }
  | { readonly op: 'update'; readonly bucket: string; readonly key: unknown; readonly data: Record<string, unknown> }
  | { readonly op: 'delete'; readonly bucket: string; readonly key: unknown }
  | { readonly op: 'where'; readonly bucket: string; readonly filter: WhereFilter }
  | { readonly op: 'findOne'; readonly bucket: string; readonly filter: WhereFilter }
  | { readonly op: 'count'; readonly bucket: string; readonly filter?: WhereFilter }
  | { readonly op: 'insertMany'; readonly bucket: string; readonly data: readonly Record<string, unknown>[] }
  | { readonly op: 'updateMany'; readonly bucket: string; readonly filter: WhereFilter; readonly data: Record<string, unknown> }
  | { readonly op: 'deleteMany'; readonly bucket: string; readonly filter: WhereFilter }
  | { readonly op: 'upsert'; readonly bucket: string; readonly data: Record<string, unknown> };

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

// ── Declarative Queries ─────────────────────────────────────────

export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregateConfig {
  readonly function: AggregateFunction;
  readonly field?: string;
  readonly groupBy?: string | readonly string[];
}

export interface GroupByResult {
  readonly key: Record<string, unknown>;
  readonly value: number;
}

export interface DeclarativeQueryConfig {
  readonly bucket: string;
  readonly filter?: Readonly<WhereFilter>;
  readonly sort?: Readonly<Record<string, 'asc' | 'desc'>>;
  readonly limit?: number;
  readonly offset?: number;
  readonly fields?: readonly string[];
  readonly aggregate?: AggregateConfig;
}

export type QueryType = 'programmatic' | 'declarative';

export interface QueryInfo {
  readonly name: string;
  readonly type: QueryType;
  readonly config?: DeclarativeQueryConfig;
  readonly activeSubscriptions: number;
}

// ── Procedures ──────────────────────────────────────────────────────

export interface InputFieldDef {
  readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  readonly required?: boolean;
  readonly default?: unknown;
}

// ── Procedure Steps ─────────────────────────────────────────────────

export interface StoreGetStep {
  readonly action: 'store.get';
  readonly bucket: string;
  readonly key: string;
  readonly as: string;
}

export interface StoreWhereStep {
  readonly action: 'store.where';
  readonly bucket: string;
  readonly filter: Readonly<WhereFilter>;
  readonly as: string;
}

export interface StoreFindOneStep {
  readonly action: 'store.findOne';
  readonly bucket: string;
  readonly filter: Readonly<WhereFilter>;
  readonly as: string;
}

export interface StoreInsertStep {
  readonly action: 'store.insert';
  readonly bucket: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly as?: string;
}

export interface StoreUpdateStep {
  readonly action: 'store.update';
  readonly bucket: string;
  readonly key: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly as?: string;
}

export interface StoreDeleteStep {
  readonly action: 'store.delete';
  readonly bucket: string;
  readonly key: string;
}

export interface StoreCountStep {
  readonly action: 'store.count';
  readonly bucket: string;
  readonly filter?: Readonly<WhereFilter>;
  readonly as: string;
}

export interface ProcedureAggregateStep {
  readonly action: 'aggregate';
  readonly source: string;
  readonly field: string;
  readonly op: 'sum' | 'avg' | 'min' | 'max' | 'count';
  readonly as: string;
}

export interface RulesEmitStep {
  readonly action: 'rules.emit';
  readonly topic: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface RulesSetFactStep {
  readonly action: 'rules.setFact';
  readonly key: string;
  readonly value: unknown;
}

export interface RulesGetFactStep {
  readonly action: 'rules.getFact';
  readonly key: string;
  readonly as: string;
}

export type ProcedureConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'exists' | 'not_exists';

export interface ConditionStep {
  readonly action: 'if';
  readonly condition: {
    readonly ref: string;
    readonly operator: ProcedureConditionOperator;
    readonly value?: unknown;
  };
  readonly then: readonly ProcedureStep[];
  readonly else?: readonly ProcedureStep[];
}

export interface TransformStep {
  readonly action: 'transform';
  readonly source: string;
  readonly operation: 'map' | 'filter' | 'pick' | 'pluck';
  readonly args: unknown;
  readonly as: string;
}

export interface ReturnStep {
  readonly action: 'return';
  readonly value: unknown;
}

export type ProcedureStep =
  | StoreGetStep
  | StoreWhereStep
  | StoreFindOneStep
  | StoreInsertStep
  | StoreUpdateStep
  | StoreDeleteStep
  | StoreCountStep
  | ProcedureAggregateStep
  | RulesEmitStep
  | RulesSetFactStep
  | RulesGetFactStep
  | ConditionStep
  | TransformStep
  | ReturnStep;

export interface ProcedureConfig {
  readonly name: string;
  readonly description?: string;
  readonly input?: Readonly<Record<string, InputFieldDef>>;
  readonly steps: readonly ProcedureStep[];
  readonly transaction?: boolean;
  readonly timeoutMs?: number;
}

export interface ProcedureResult {
  readonly success: boolean;
  readonly result?: unknown;
  readonly results: Readonly<Record<string, unknown>>;
}

export interface ProcedureSummary {
  readonly name: string;
  readonly description: string | undefined;
  readonly stepsCount: number;
}

// ── Identity ─────────────────────────────────────────────────────

export interface IdentityLoginResult {
  readonly token: string;
  readonly expiresAt: number;
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly displayName?: string;
    readonly roles: readonly string[];
  };
}

export interface IdentityUserInfo {
  readonly id: string;
  readonly username: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly enabled: boolean;
  readonly metadata?: Record<string, unknown>;
  readonly _createdAt: number;
  readonly _updatedAt: number;
}

export interface IdentityCreateUserInput {
  readonly username: string;
  readonly password: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly enabled?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface IdentityUpdateUserInput {
  readonly displayName?: string | null;
  readonly email?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}

export interface IdentityListUsersResult {
  readonly users: readonly IdentityUserInfo[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface IdentityRolePermission {
  readonly allow: string | readonly string[];
  readonly buckets?: readonly string[];
  readonly topics?: readonly string[];
}

export interface IdentityRoleInfo {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly system: boolean;
  readonly permissions: readonly IdentityRolePermission[];
  readonly _createdAt: number;
  readonly _updatedAt: number;
}

export interface IdentityCreateRoleInput {
  readonly name: string;
  readonly description?: string;
  readonly permissions?: readonly IdentityRolePermission[];
}

export interface IdentityUpdateRoleInput {
  readonly description?: string;
  readonly permissions?: readonly IdentityRolePermission[];
}

export type IdentityAclSubjectType = 'user' | 'role';
export type IdentityAclResourceType = 'bucket' | 'topic' | 'procedure' | 'query';

export interface IdentityGrantInput {
  readonly subjectType: IdentityAclSubjectType;
  readonly subjectId: string;
  readonly resourceType: IdentityAclResourceType;
  readonly resourceName: string;
  readonly operations: readonly string[];
}

export interface IdentityRevokeInput {
  readonly subjectType: IdentityAclSubjectType;
  readonly subjectId: string;
  readonly resourceType: IdentityAclResourceType;
  readonly resourceName: string;
  readonly operations?: readonly string[];
}

export interface IdentityAclEntry {
  readonly subjectType: IdentityAclSubjectType;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly operations: readonly string[];
  readonly isOwner: boolean;
}

export interface IdentityOwnerInfo {
  readonly userId: string;
  readonly username: string;
  readonly resourceType: IdentityAclResourceType;
  readonly resourceName: string;
}

export interface IdentityEffectiveAccess {
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly roles: readonly string[];
  };
  readonly resources: ReadonlyArray<{
    readonly resourceType: IdentityAclResourceType;
    readonly resourceName: string;
    readonly operations: readonly string[];
    readonly isOwner: boolean;
  }>;
}

// ── Logic ─────────────────────────────────────────────────────────

/** Expression — a literal, field reference ($field), or operator. */
export type Expression =
  | number
  | string
  | boolean
  | null
  | ExpressionOperator;

/** Operator — an object with exactly one $-prefixed key. */
export type ExpressionOperator = {
  readonly [key: `$${string}`]: Expression | readonly Expression[];
};

export interface ComputedFieldDefinition {
  readonly depends: readonly string[];
  readonly expr: Expression;
}

export interface ComputedFieldsConfig {
  readonly bucket: string;
  readonly fields: Record<string, ComputedFieldDefinition>;
}

export interface OrderBySpec {
  readonly field: string;
  readonly direction?: 'asc' | 'desc';
}

export interface DerivedViewDefinition {
  readonly name: string;
  readonly from: Record<string, string>;
  readonly join?: Record<string, string>;
  readonly where?: Record<string, unknown>;
  readonly groupBy?: string | readonly string[];
  readonly select: Record<string, string | Expression>;
  readonly reactive?: boolean;
  readonly orderBy?: readonly OrderBySpec[];
  readonly limit?: number;
}

export interface DerivedViewInfo {
  readonly name: string;
  readonly from: Record<string, string>;
  readonly reactive: boolean;
  readonly resultCount: number;
}

export interface DerivedViewExplanation {
  readonly name: string;
  readonly sources: Record<string, string>;
  readonly joins: Record<string, string>;
  readonly filters: Record<string, unknown>;
  readonly groupBy: readonly string[];
  readonly select: Record<string, string | Expression>;
  readonly dependencies: readonly string[];
}

export interface ConstraintDefinition {
  readonly name: string;
  readonly on: string;
  readonly expr: Expression;
  readonly message: string;
  readonly scope?: 'record' | 'group';
  readonly groupBy?: string;
  readonly operations?: readonly ('insert' | 'update' | 'delete')[];
}

// ── Internal ──────────────────────────────────────────────────────

export type SendFn = (type: string, payload: Record<string, unknown>) => Promise<unknown>;

// ── Protocol ─────────────────────────────────────────────────────

export interface ServerMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}
