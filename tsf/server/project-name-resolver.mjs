// Resolves which real project(s) a free-text Command message refers to,
// against the actual project catalog -- never a fabricated/guessed list.
// Used when /api/chat is called with projectId: null (Command's global
// scope) to compute which project(s), if any, a message targets.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokenize(s) {
  return String(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// Bounded, hand-rolled token-overlap scoring -- no new dependency, matching
// this codebase's own stated convention (see migration-context-attachments.ts's
// header) of not pulling in a library without explicit justification.
const FUZZY_CONFIDENCE_FLOOR = 0.6

export function resolveProjectsFromText(message, projects) {
  const lowerMessage = message.toLowerCase()
  const messageTokens = new Set(tokenize(message))

  const exact = []
  const fuzzy = []

  for (const project of projects) {
    const idPattern = new RegExp(`\\b${escapeRegExp(project.id.toLowerCase())}\\b`)
    if (idPattern.test(lowerMessage)) {
      exact.push({ project, matchedOn: 'id', confidence: 1 })
      continue
    }
    const namePattern = new RegExp(`\\b${escapeRegExp(project.displayName.toLowerCase())}\\b`)
    if (namePattern.test(lowerMessage)) {
      exact.push({ project, matchedOn: 'displayName', confidence: 0.95 })
      continue
    }
    const nameTokens = tokenize(project.displayName)
    if (nameTokens.length === 0) {
      continue
    }
    const overlap = nameTokens.filter((token) => messageTokens.has(token)).length
    const ratio = overlap / nameTokens.length
    if (overlap > 0 && ratio >= FUZZY_CONFIDENCE_FLOOR) {
      fuzzy.push({ project, matchedOn: 'fuzzy', confidence: ratio })
    }
  }

  // Ambiguous only when there's no exact signal at all and more than one
  // fuzzy candidate -- an exact id/displayName match is always trusted,
  // however much unrelated fuzzy noise exists alongside it.
  const ambiguous = exact.length === 0 && fuzzy.length > 1

  return { matches: [...exact, ...fuzzy], ambiguous }
}
