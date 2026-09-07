// Native Self-Improvement Loop V1, Phase 4: builds the worker's ENTIRE
// instruction set from the finding's own structured fields and the
// authority envelope -- never free-form "improve this" text (mission
// brief's own explicit requirement). Pure string builder, no I/O, fully
// unit-testable against fixture findings/envelopes.
function section(title, body) {
  return `## ${title}\n${body}\n`
}

// json() over prose where a field is itself structured (evidence/
// reproduction are detector-shaped, arbitrary objects per
// self-improvement-finding.mjs) -- never paraphrased/summarized by this
// builder, which would risk silently dropping detail a worker needs.
function json(value) {
  return JSON.stringify(value, null, 2)
}

export function buildWorkerPrompt(finding, envelope) {
  const scopeLine =
    envelope.allowedScope.length > 0
      ? envelope.allowedScope.map((f) => `- ${f}`).join('\n')
      : '(none named by the detector -- stay MINIMAL and explicitly state in your final summary exactly which files you touched and why each was necessary)'

  return [
    section(
      'Bounded repair mission',
      `You are a bounded, autonomous repair worker inside an ISOLATED git worktree. Fix EXACTLY ONE defect, described below. Do not do anything else.`
    ),
    section('Finding', `sourceDetector: ${finding.sourceDetector}\nseverity: ${finding.severity}\naffectedSurface: ${finding.affectedSurface}\nconfidence: ${finding.confidence}`),
    section('Evidence (verbatim, detector-produced)', json(envelope.evidence)),
    section('Reproduction criteria (verbatim -- this is how you and an independent verifier will confirm the fix)', json(envelope.reproduction)),
    section(
      'Allowed scope',
      `You may ONLY modify files inside this area:\n${scopeLine}\n\nDo not touch any file outside this area for any reason.`
    ),
    section(
      'Forbidden surfaces -- NEVER read, write, or reference these under any circumstance',
      [...envelope.forbiddenPathPrefixes.map((p) => `- ${p}`), ...envelope.structurallyForbiddenSurfaces.map((s) => `- ${s.surface}`)].join('\n')
    ),
    section(
      'Required before you finish',
      [
        '1. Run the reproduction criteria above yourself and CONFIRM it now passes -- do not report done otherwise.',
        '2. Run the relevant targeted regression test(s) for the area you touched and confirm they pass.',
        '3. Commit your work with a clear, specific commit message describing exactly what changed and why.',
        '4. NEVER attempt to push, merge, or write to the canonical repository directly -- your commit stays in THIS isolated worktree. An independent verifier and a separate adoption step (outside your control) decide what happens next.',
        '5. If you cannot fix this within the allowed scope, stop and clearly state why in your final summary rather than expanding scope.'
      ].join('\n')
    )
  ].join('\n')
}
