# TSF Weird Talent Matcher Capability Design V1

## Verdict

`RED_WEIRD_TALENT_MATCHER_ARCHITECTURE_UNSAFE`

The mission precisely reconstructed the blocker, selected explicit content-bound concept admission (option D), and produced a five-file proof candidate. The proof is not safe to resume or adopt: independent verification found that the asserted authority is a forgeable string protected only by an unkeyed content hash. A caller able to supply matcher assertions can mint a current-looking `curator-reviewed-binding` or `controlled-proof-fixture` assertion and regain the strongest concept signal.

## Blocking invariant and root cause

`EXPLICIT_CONTENT_BOUND_CONCEPT_ADMISSION`: curated concept membership is admitted matcher evidence. Self-authored Talent Card text may contribute bounded lexical evidence, but must not create, refresh, or upgrade concept eligibility and must not by itself reach Strong or Excellent.

Stable enforces this indirectly through curated `concept.talentIds`. The rejected second-pilot candidate supplied self-authored fields and an opaque local ID but no independently admitted concept membership, while its intended test required Strong/Excellent. Weakening the capability floor or deriving membership from copied phrases would let a claimant manufacture the matcher's strongest signal.

## Options

| Option | Summary | Score | Disposition |
| --- | --- | ---: | --- |
| A | Display only until evidence exists | 37 | Safe but low usefulness |
| B | Lexical low-assurance lane | 35 | Sound fallback; cannot reach Strong |
| C | Phrase/schema feasibility auto-admits | 29 | Rejected; copied text mints authority |
| D | Draft → validated → explicitly match-eligible | 42 | Planner recommendation |
| E | External curator-only ledger | 38 | Safer authority boundary, operationally heavier |

The verifier proves that D is incomplete unless admission originates at a trusted boundary outside untrusted matcher input. E, or a D implementation backed by an equivalent trusted store/capability/signature boundary, must be designed before another candidate.

## Designed contract and settled semantics

`TSF_CONCEPT_ELIGIBILITY_V1` binds card ID, concept ID, registry version/hash, capability-content hash, policy version, admission basis, authority, conceptual-fit assurance, and separately reported real-world assurance. Missing, malformed, unsupported, stale, conflicting, or mismatched assertions fail closed. Capability edits invalidate admission; logistics edits retain capability admission but force current compatibility evaluation. Pending or stale completions never become current, and retry identity is content-addressed.

Canonical hashes are schema-specific semantic SHA-256 values: UTF-8, NFC, normalized line endings, sorted object keys and set-valued arrays, no absolute paths, and no source-byte/path dependence. This part of the proof passed Windows/portable hash tests.

## Proof candidate

- Stable: `ef0e232888b0fe1689ab7433e3f1333807d3b00d`, tree `669dc8c4492bee2b264f9a8f90952e3bf05c7f99`
- Worker commit: `6cb57f3a4768713be3ac680a9a3d95e850958905`
- Corrected integration candidate: `3af1b4a4ab2e6913cc34e5513f11b49930bcca7a`
- Candidate tree: `1548274a9ba4d37bda8acb2fffe7a075eae0a4da`
- Scope: exactly `conceptEligibility.ts/.test.ts`, `concepts.ts`, and `matchEngineV2.ts/.test.ts`
- Worker validation: focused 50/50, required regression 45/45, full 88/88, typecheck, lint, build, and diff checks passed

The existing blocked candidate `148ef43730fd876c90adbeaf82f93e0b3c8a3e86` remains preserved and rejected. The corrected proof candidate is also not adoptable.

## Independent verifier

Verifier task/dispatch: `task_0c535d317b23` / `ctx_7fb458f1a91a`. It confirmed exact binding, clean status, and five-file scope, then stopped before executing tests as required when it found a new architectural concern.

Answers:

1. Deterministic computation is preserved, but admission integrity is not.
2. Yes. An untrusted caller can reproduce unkeyed hashes and forge an allowed authority/basis string.
3. Honest stale hashes are rejected, but a hostile caller can recompute current hashes.
4. Abstention is preserved for lexical-only input but can be bypassed with a forged valid-looking admission.
5. Diagnostics are legible, yet the provenance they display is not trustworthy.
6. The implementation stayed inside the exact blocker and did not change thresholds, weights, or calibration.

## Capability feedback and gates

- Matcher feasibility: advanced and precisely bounded; not proven safe end-to-end.
- Settled dependency semantics: designed and mechanically tested for content staleness; trusted settlement authority remains pending.
- Windows-normalized evidence hashing: proven for this bounded semantic hashing module.
- Safe provider dispatch: exercised through the TSF wrapper; first-class reliable dispatch is not proven.
- Discovery-root enforcement: manually respected; runtime enforcement not proven.
- Browser ownership gating: not relevant to this non-UI proof and not proven.

The second real-project pilot cannot safely resume from this candidate. Phase 2 onboarding remains blocked. No browser run was warranted, and no push, merge, adoption, deployment, or publication occurred.
