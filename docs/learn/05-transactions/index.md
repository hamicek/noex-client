# Part 5: Transactions

Execute multiple store operations as a single atomic unit.

## Chapters

### [5.1 Atomic Operations](./01-atomic-operations.md)

Understand how transactions work:
- `store.transaction(operations)` — send an array of operations
- Supported ops: get, insert, update, delete, where, findOne, count
- All-or-nothing semantics — either every operation succeeds or the entire transaction is rolled back

### [5.2 Transaction Patterns](./02-patterns.md)

Apply transactions to real-world scenarios:
- Cross-bucket operations — move data atomically between buckets
- Read-modify-write — read current state, compute new state, write back
- Error handling — what happens when a transaction fails

## What You'll Learn

By the end of this section, you'll be able to:
- Compose multi-operation transactions
- Apply common transaction patterns for data consistency
- Handle transaction errors gracefully

---

Start with: [Atomic Operations](./01-atomic-operations.md)
