# Support case query-plan notes

The support list and overdue-summary queries are tenant-scoped. The active SLA
index is intentionally partial so closed cases and records without an SLA due
date do not enlarge the hot path:

```sql
CREATE INDEX ix_support_cases_open_sla_due
ON support_cases (tenant_id, sla_due_at)
WHERE closed_at IS NULL AND sla_due_at IS NOT NULL;
```

Validate these plans against production-like statistics before changing the
predicate or adding another index:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, case_number, subject, sla_due_at
FROM support_cases
WHERE tenant_id = :tenant_id
  AND closed_at IS NULL
  AND sla_due_at IS NOT NULL
  AND sla_due_at < CURRENT_TIMESTAMP
ORDER BY sla_due_at ASC;

EXPLAIN (ANALYZE, BUFFERS)
SELECT status, count(*)
FROM support_cases
WHERE tenant_id = :tenant_id
  AND closed_at IS NULL
GROUP BY status;
```

The first query should use `ix_support_cases_open_sla_due` when the planner
estimates that the tenant/date predicate is selective. The second is covered by
the tenant/status index. Record a fresh plan when data volume or status
distribution changes materially; do not add a competing partial index without
that evidence.

The current PostgreSQL verification returned an `Index Scan using
ix_support_cases_open_sla_due` for the tenant-scoped overdue-query shape.
