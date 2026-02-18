// ── Main ─────────────────────────────────────────────────────────

export { NoexClient } from './client.js';

// ── API ──────────────────────────────────────────────────────────

export { StoreAPI } from './api/store.js';
export { BucketAPI } from './api/bucket.js';
export { RulesAPI } from './api/rules.js';
export { AuthAPI } from './api/auth.js';
export { AuditAPI } from './api/audit.js';

// ── Config ───────────────────────────────────────────────────────

export type { ClientOptions, ReconnectOptions } from './config.js';

// ── Types ────────────────────────────────────────────────────────

export type {
  ConnectionState,
  Unsubscribe,
  WelcomeInfo,
  WebSocketLike,
  WebSocketConstructor,
  StoreRecord,
  RecordMeta,
  PaginatedResult,
  TransactionOp,
  TransactionResult,
  BucketsInfo,
  StoreStats,
  FieldType,
  GeneratedType,
  FormatType,
  FieldDefinition,
  BucketDefinition,
  BucketSchemaUpdate,
  RuleTrigger,
  ConditionOperator,
  ConditionSource,
  RuleCondition,
  RuleAction,
  RuleInput,
  RuleInfo,
  RuleSummary,
  RuleDetail,
  ValidationIssue,
  ValidationResult,
  RulesEvent,
  RulesStats,
  Fact,
  AuthSession,
  AuditEntry,
  AuditQuery,
  AggregateConfig,
  DeclarativeQueryConfig,
  QueryType,
  QueryInfo,
} from './types.js';

// ── Errors ───────────────────────────────────────────────────────

export { NoexClientError, TimeoutError, DisconnectedError } from './errors.js';
