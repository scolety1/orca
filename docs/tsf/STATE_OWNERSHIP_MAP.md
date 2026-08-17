# Orca / TSF State Ownership Map

| State or fact | Owner | TSF treatment |
|---|---|---|
| Agent process, PTY and terminal output | Orca | Reference by session/terminal identity only |
| Provider launch and observed agent/model | Orca | Record requested versus observed mapping |
| Native session and provider conversation | Orca/provider | Keep sticky identity in TSF session-affinity binding |
| Worktree, branch, head, tree and diff | Orca/Git | Bind capsules, candidate actions and receipts to exact facts |
| Run, task, dispatch and worker runtime state | Orca | Map to TSF high-level mission state; do not copy low-level lifecycle |
| Browser tab/runtime and test process | Orca | Future exact runtime attestation adapter |
| Project portfolio and provenance | TSF | Canonical TSF overlay state |
| Active Fleet and Work Set | TSF | Attention/capacity scope; never repository authority |
| Usage Mode and stable role policy | TSF | Resolve to Orca agent/provider/model/effort configuration |
| Project goal, planner intent and work decomposition | TSF | Compact `TSF_PLAN_CAPSULE_V1` records decisions, not transcripts |
| High-level mission state | TSF | Project Orca facts into DRAFT through COMPLETED/BLOCKED |
| Worker result admission | TSF | `TSF_RESULT_CAPSULE_V1`; exact evidence required |
| Adoption candidate and decision | TSF | Exact binding; Tim authority for real work |
| Stable / Upgrade / Testing / Published | TSF | Metadata bound to Orca/Git candidate identities |
| Receipt Lite and consequential provenance | TSF | Durable hashable decision record |
| Health | TSF projection | Actionable view over Orca, Git, provider and TSF compatibility facts |

Queue state, mission state, portfolio lifecycle, Health, and release track remain separate dimensions.
