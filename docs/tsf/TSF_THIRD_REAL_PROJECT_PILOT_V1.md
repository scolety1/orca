# TSF Orca Third Real Project Pilot V1

## Verdict

`GREEN_TSF_ORCA_THIRD_REAL_PROJECT_READY_FOR_ADOPTION`

The Orca-based TSF safely understood Shopify Catalog QA, selected a bounded mission from current repository truth, implemented it in an isolated candidate, admitted two verifier/browser-driven corrections, independently reverified the exact final candidate, and completed Orca-native product QA. Stable remains unchanged. The mission is stopped at Tim's adoption gate; no push, PR, merge, deployment, publication, Shopify access, or other real-project work occurred.

## Project truth and selected mission

Shopify Catalog QA is a local, read-only Shopify-style catalog auditor. It imports supported catalog snapshots, produces deterministic findings with provenance, lets an operator triage and export, and compares a later re-import against an explicit saved baseline without changing Shopify.

Four accepted missions were already complete: the vertical slice, import/report hardening, re-audit verification, and a 124-scenario adversarial benchmark. Stable began clean on `main` at HEAD `d3b7819aaceea8ef01b06be2ac10a59a863f8200`, tree `143447a37b3369de8df386e045a13f2d7a2825fa`; 75/75 tests, typecheck, lint, and the frozen 124/124 evaluation were GREEN.

The planner selected **Operator-facing audit coverage and uncertainty review**. The engine/report already carried all 16 rules' scope, applicability, abstention, and safe ambiguous/unmatched comparison facts, but the UI exposed only a rules-executed count and an unfiltered list. Exposing that existing truth was more valuable and safer than adding another unvalidated rule.

## Planner, workers, and isolation

- Usage Mode: `BALANCED`
- Run: `run_b00b1bdd428d`
- Planner: task `task_5db1ba49f6f4`, dispatch `ctx_d425df08edfc`, session `term_8372ac33-9403-43f7-9604-ca6f16f7d57e`
- Initial worker: task `task_859d62d5cbc7`, dispatch `ctx_34e4a9705815`, session `term_7c536a08-e38f-449a-a25c-ba86d6386d18`
- Responsive revision worker: task `task_9cd54fa877d2`, dispatch `ctx_749e7e68073c`, session `term_26ee4162-218d-493e-a5fd-8d3fd9511430`
- Independent final verifier: task `task_f6d9252c920e`, dispatch `ctx_798418a19e80`, session `term_77d71b1a-57e9-4b98-9598-68b5ec9978c8`

The packaged WindowsApps Codex launcher was denied on the first planner dispatch. Orca fenced that exact failed attempt, and the configured TSF safe-provider launcher completed the retry. All product work occurred in Orca worktrees; the accepted source checkout did not move.

## Candidate

- Branch: `tsf-shopify-pilot-m5-candidate`
- Worktree: `C:\Users\codex-agent\orca\workspaces\shopify-catalog-qa\tsf-shopify-pilot-m5-candidate`
- HEAD: `0a8133bfc103c302e72fdf70dd47aef9fa7b41a6`
- Tree: `c406f512f734c39a5824201016ee586fd9e04b3c`
- Product source tree: `7de46042a99748e97bf0b57c605f7834828d0909`
- Status: clean

Changed paths:

- `src/styles.css`
- `src/ui/CatalogQaApp.tsx`
- `src/ui/RuleCoverage.tsx`
- `tests/mission5-ui.test.tsx`

The candidate shows all 16 registry rules with scope, applies-when, abstains-when, per-run finding counts, honest execution wording, future skipped reasons, comparison status filters, a prominent uncertainty queue, reason/method/confidence, baseline/current evidence, accessible empty states, and keyboard-safe selection. Audit/import/comparison/report/persistence/download semantics are unchanged.

## Correction and verification loop

The initial independent code verifier found no source defect. The first Orca browser pass then found a real 321px min-content overflow: the list was 217px wide but scrolled to 290px and clipped long rule IDs. The bounded worker fixed intrinsic sizing and wrapping without weakening vertical scrolling.

A fresh verifier proved the product fix but rejected the first CSS regression guard because it encoded declaration order. The guard was replaced with an order-independent declaration map, and the same independent verifier returned final GREEN on the exact candidate. This is useful TSF evidence: neither passing tests nor an earlier verifier result overrode contrary live product evidence.

## Tests and product QA

- Focused Mission 5: 4/4 PASS
- Full Vitest: 13 files, 79/79 PASS
- Adversarial evaluation: 124/124, 58 TP, 0 FP, 0 FN
- TypeScript: PASS
- ESLint: PASS
- Production build: PASS
- `git diff --check`: PASS
- Candidate/verifier status: clean

Orca-native product QA used the checked-in Mission 2 baseline report and bundled Healthy Store fixture on loopback only. At 321×920 it showed 16 honest coverage rows and a 17-item `Cannot confidently match` queue with reason, `no safe match`, `unmatched` confidence, baseline evidence, and explicit current-absence caveat. There were zero alert surfaces. The corrected comparison list measured `clientWidth = scrollWidth = 217px`; all 17 rows were 217px, long IDs used `overflow-wrap: anywhere`, and vertical overflow remained `auto`.

Orca's CDP screenshot timed out because the headless-served desktop window did not retain operating-system focus. Accessibility snapshots and live DOM geometry remained available, so this did not block the product check; the limitation is recorded rather than hidden.

## Release and authority state

- Stable: unchanged at `d3b7819a...`, tree `143447a3...`
- Upgrade: exact candidate `0a8133bf...`, tree `c406f512...`
- Testing: GREEN
- Published: unchanged
- Mission: `READY_FOR_ADOPTION`
- Adoption: pending Tim; no merge performed
- Receipt chain tip: `f8f7a6ea5c5a52d3df2b536a2af850372ec10228f0d0a2bde961f0d7360e300f`

## Capability feedback

This third, materially different repository reconfirmed bounded project registration, one-project Work Set enforcement, Balanced provider-neutral roles, planner/worker/verifier separation, sticky task sessions, exact source/candidate binding, Stable/Upgrade/Testing separation, false-success rejection, lightweight receipts, and Orca-native browser evidence. It does not promote any pending capability or claim dirty-worktree, live-Shopify, deployment, manual-test-session UI, or provider-diversity parity.

## Recommendation

The exact candidate is ready for Tim's adoption decision. If adopted later, revalidate the exact HEAD/tree and use the repository's normal safe local integration path. Do not push, publish, deploy, or begin another real-project mission under this pilot authorization.
