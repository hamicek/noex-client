// ── Main ─────────────────────────────────────────────────────────

export { NoexClient } from './client.js';

// ── API ──────────────────────────────────────────────────────────

export { StoreAPI } from './api/store.js';
export { BucketAPI } from './api/bucket.js';
export { RulesAPI } from './api/rules.js';
export { AuthAPI } from './api/auth.js';
export { AuditAPI } from './api/audit.js';
export { IdentityAPI } from './api/identity.js';
export { ProceduresAPI } from './api/procedures.js';

// ── Config ───────────────────────────────────────────────────────

export type { ClientOptions, ReconnectOptions } from './config.js';

// ── Types ────────────────────────────────────────────────────────

export type {
  ConnectionState,
  Unsubscribe,
  WelcomeInfo,
  WebSocketLike,
  WebSocketConstructor,
  FilterOperators,
  FilterValue,
  WhereFilter,
  BucketFilter,
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
  InputFieldDef,
  StoreGetStep,
  StoreWhereStep,
  StoreFindOneStep,
  StoreInsertStep,
  StoreUpdateStep,
  StoreDeleteStep,
  StoreCountStep,
  ProcedureAggregateStep,
  RulesEmitStep,
  RulesSetFactStep,
  RulesGetFactStep,
  ProcedureConditionOperator,
  ConditionStep,
  TransformStep,
  ReturnStep,
  ProcedureStep,
  ProcedureConfig,
  ProcedureResult,
  ProcedureSummary,
  IdentityLoginResult,
  IdentityUserInfo,
  IdentityCreateUserInput,
  IdentityUpdateUserInput,
  IdentityListUsersResult,
  IdentityRolePermission,
  IdentityRoleInfo,
  IdentityCreateRoleInput,
  IdentityUpdateRoleInput,
  IdentityAclSubjectType,
  IdentityAclResourceType,
  IdentityGrantInput,
  IdentityRevokeInput,
  IdentityAclEntry,
  IdentityOwnerInfo,
  IdentityEffectiveAccess,
} from './types.js';

// ── Errors ───────────────────────────────────────────────────────

export { NoexClientError, TimeoutError, DisconnectedError } from './errors.js';
