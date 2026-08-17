# Provider-Neutral Role Registry

Stable roles:

| Role | Purpose | Boundary |
|---|---|---|
| `PLANNER_DEEP` | Ambiguous, architectural or high-impact decomposition | Planning episode |
| `PLANNER_BALANCED` | Normal bounded planning | Planning episode |
| `WORKER_CHEAP` | Clear low-risk implementation/research | Implementation mission |
| `WORKER_BALANCED` | Ordinary bounded implementation | Implementation mission |
| `WORKER_DEEP` | Difficult implementation | Implementation mission |
| `VERIFIER_INDEPENDENT` | Evidence-based independent review | Review episode; separate session when available |

The registry is implemented in `tsf/routing/provider-role-mappings.v1.json`. Preferred and fallback provider profiles are configuration. Model product names appear only in non-contractual observations/hypotheses, not TSF schemas or state transitions.

Every resolution distinguishes:

- requested provider, agent, model class and effort class;
- observed provider, agent, concrete model and effort;
- assurance (`RECOMMENDED_ONLY` until technically observed/enforced).
