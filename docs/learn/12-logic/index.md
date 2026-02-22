# Part 12: Logic Integration

Use the logic engine for computed fields, derived views, constraints, and expressions through the client SDK.

## Chapters

### [12.1 Setup](./01-setup.md)

Access the logic engine from the client:
- `client.logic` namespace (LogicAPI)
- Server requirements — logic must be configured
- `expr` helper for building expressions
- Overview of all logic operations

### [12.2 Computed Fields](./02-computed-fields.md)

Define and manage computed fields:
- `logic.defineComputed(bucket, fields)` — define auto-computed fields
- `logic.dropComputed(bucket)` — remove computed fields
- `logic.listComputed()` — list all configurations
- Store integration — computed values appear after insert/update

### [12.3 Views and Constraints](./03-views-and-constraints.md)

Work with derived views and constraints:
- `logic.defineView(definition)` — create views with joins, filters, grouping
- `logic.queryView(name)` / `logic.explainView(name)` — query and inspect views
- `logic.defineConstraint(constraint)` — enforce business rules on store writes
- Constraint violations as errors

### [12.4 View Subscriptions](./04-view-subscriptions.md)

Subscribe to views and evaluate expressions:
- `logic.subscribeView(name, callback)` — initial data + push updates
- `logic.evaluateExpr(expr, record?)` — standalone expression evaluation
- `expr` helper in detail — all operators by category
- Reconnect recovery for logic subscriptions

## What You'll Learn

By the end of this section, you'll be able to:
- Access the logic engine through `client.logic`
- Build expressions with the `expr` helper
- Define computed fields that auto-compute on insert/update
- Create and query derived views
- Enforce constraints on store writes
- Subscribe to reactive views and receive live updates
- Evaluate expressions standalone

---

Start with: [Setup](./01-setup.md)
