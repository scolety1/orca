// Phase 1 (UI_DOGFOOD_AGENT_V0): a real UI_DOGFOOD eval pack, exercising
// ui-dogfood-finding.mjs's real severity/auto-fix-eligibility/dedup/
// iteration-policy rules. Deliberately pure/synthetic inputs (no browser,
// no Electron) so this stays fast and dependency-free in `node --test`,
// mirroring ESTIMATOR_BASICS_PACK's own fixed-input convention -- the real
// browser-driven proof lives in the Playwright integration test instead
// (tests/e2e/ui-dogfood-orca-self.spec.ts).
export const UI_DOGFOOD_BASICS_PACK = {
  packId: 'ui-dogfood-basics',
  version: 1,
  category: 'UI_DOGFOOD',
  description:
    'Exercises the real UI_DOGFOOD finding taxonomy: severity, auto-fix eligibility, dedup, and iterate-while-improving policy.',
  cases: [
    {
      id: 'a-broken-core-flow-interaction-scores-p0-and-is-auto-fix-eligible',
      description:
        'A broken interaction that blocks the core flow is the most urgent, objectively bounded case.',
      input: {
        kind: 'SCORE_ONE',
        finding: {
          category: 'BROKEN_INTERACTION',
          surfaceId: 'settings-general',
          description: 'Save button does nothing on click',
          blocksCoreFlow: true
        }
      },
      assertions: [
        { type: 'EQUALS', path: 'severity', value: 'P0' },
        { type: 'EQUALS', path: 'autoFixEligible', value: true }
      ]
    },
    {
      id: 'subjective-aesthetic-findings-are-never-auto-fix-eligible',
      description:
        'Subjective redesign opinions are recommend-only, regardless of anything else about the finding.',
      input: {
        kind: 'SCORE_ONE',
        finding: {
          category: 'SUBJECTIVE_AESTHETIC',
          surfaceId: 'settings-appearance',
          description: 'The accent color could feel more premium',
          blocksCoreFlow: true
        }
      },
      assertions: [
        { type: 'EQUALS', path: 'severity', value: 'P3' },
        { type: 'EQUALS', path: 'autoFixEligible', value: false }
      ]
    },
    {
      id: 'accessibility-defect-with-explicit-objective-flag-is-auto-fix-eligible',
      description:
        'A provably bounded a11y defect (e.g. no accessible name) is objective and eligible.',
      input: {
        kind: 'SCORE_ONE',
        finding: {
          category: 'ACCESSIBILITY_DEFECT',
          surfaceId: 'settings-terminal',
          description: 'Icon-only button has no accessible name',
          objective: true
        }
      },
      assertions: [{ type: 'EQUALS', path: 'autoFixEligible', value: true }]
    },
    {
      id: 'accessibility-defect-without-the-objective-flag-is-recommend-only',
      description:
        'An a11y judgment call never becomes an autonomous fix just because it shares the category.',
      input: {
        kind: 'SCORE_ONE',
        finding: {
          category: 'ACCESSIBILITY_DEFECT',
          surfaceId: 'settings-terminal',
          description: 'Contrast could be higher for secondary text',
          objective: false
        }
      },
      assertions: [{ type: 'EQUALS', path: 'autoFixEligible', value: false }]
    },
    {
      id: 'the-same-defect-seen-on-two-viewports-deduplicates-into-one-finding',
      description:
        'Real duplicate detections across a viewport sweep collapse to one finding with both viewports recorded.',
      input: {
        kind: 'DEDUPLICATE',
        findings: [
          {
            category: 'CLIPPED_CONTENT',
            surfaceId: 'settings-notifications',
            description: 'Toggle row overflows its card',
            viewport: 'desktop'
          },
          {
            category: 'CLIPPED_CONTENT',
            surfaceId: 'settings-notifications',
            description: 'Toggle row overflows its card',
            viewport: 'mobile'
          }
        ]
      },
      assertions: [
        { type: 'EQUALS', path: 'length', value: 1 },
        { type: 'EQUALS', path: '0.occurrences', value: 2 },
        { type: 'EQUALS', path: '0.affectsAllViewports', value: true }
      ]
    },
    {
      id: 'a-clean-fix-with-no-regressions-and-nothing-left-stops-iterating',
      description:
        'Once every finding is resolved and nothing new appeared, the iterate-while-improving loop stops.',
      input: {
        kind: 'ITERATION_POLICY',
        before: [
          { category: 'DEAD_LINK', surfaceId: 'settings-general', description: 'Docs link 404s' }
        ],
        after: [],
        iterationCount: 1,
        maxIterations: 3
      },
      assertions: [{ type: 'EQUALS', path: 'shouldIterateAgain', value: false }]
    },
    {
      id: 'a-fix-that-introduces-a-new-regression-always-earns-another-pass',
      description:
        'A regression from a fix earns another iteration even when overall net improvement is positive.',
      input: {
        kind: 'ITERATION_POLICY',
        before: [
          { category: 'DEAD_LINK', surfaceId: 'settings-general', description: 'Docs link 404s' },
          { category: 'DEAD_LINK', surfaceId: 'settings-general', description: 'Support link 404s' }
        ],
        after: [
          {
            category: 'CONSOLE_ERROR',
            surfaceId: 'settings-general',
            description: 'TypeError: cannot read undefined'
          }
        ],
        iterationCount: 1,
        maxIterations: 3
      },
      assertions: [{ type: 'EQUALS', path: 'shouldIterateAgain', value: true }]
    },
    {
      id: 'the-iteration-cap-always-wins-even-with-a-real-regression-outstanding',
      description:
        'maxIterations is a hard ceiling -- never exceeded no matter how much improvement remains available.',
      input: {
        kind: 'ITERATION_POLICY',
        before: [
          { category: 'DEAD_LINK', surfaceId: 'settings-general', description: 'Docs link 404s' }
        ],
        after: [
          {
            category: 'CONSOLE_ERROR',
            surfaceId: 'settings-general',
            description: 'New regression'
          }
        ],
        iterationCount: 3,
        maxIterations: 3
      },
      assertions: [{ type: 'EQUALS', path: 'shouldIterateAgain', value: false }]
    }
  ]
}
