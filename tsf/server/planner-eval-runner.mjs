// M9 wave 3: turns one PLANNER eval case's fixed input into a real actual
// output by ACTUALLY calling the real capability it measures
// (buildProjectContextCapsule, generateWbs) -- never a fabricated or
// hand-typed stand-in for what the real call would produce. Pure glue;
// no domain logic lives here (matches this program's established
// wbs-generation.mjs/estimate-http-routes.mjs split).
import { buildProjectContextCapsule } from './live-planner.mjs'
import { generateWbs } from './wbs-generation.mjs'
import { addMemoryRecord, emptyProjectMemory } from '../domain/project-memory.mjs'

export async function runPlannerEvalCase(evalCase, clock = () => new Date()) {
  const { input } = evalCase
  if (input.kind === 'CAPSULE') {
    let memory = emptyProjectMemory()
    if (input.lessonText) {
      memory = addMemoryRecord(
        memory,
        {
          class: 'EXPERIENCE',
          statement: input.lessonText,
          source: { kind: 'RESULT_CAPSULE', ref: 'planner-eval-fixture' }
        },
        clock
      )
    }
    return buildProjectContextCapsule(input.project, memory)
  }
  if (input.kind === 'WBS') {
    const wbsResult = await generateWbs({
      projectId: input.repoEvidence.projectId,
      repoEvidence: input.repoEvidence
    })
    return wbsResult.ok
      ? { taskCount: wbsResult.wbs.length, taskIds: wbsResult.wbs.map((task) => task.id) }
      : { taskCount: 0, taskIds: [], wbsError: wbsResult.reason }
  }
  throw new Error(`unknown planner eval case input kind: ${input.kind}`)
}

// Runs every case in a normalized pack, returning the real
// caseId -> actualOutput map runEvalPack (evaluation-pack.mjs) expects.
export async function runPlannerEvalPack(pack, clock = () => new Date()) {
  const actualOutputsByCaseId = {}
  for (const evalCase of pack.cases) {
    actualOutputsByCaseId[evalCase.id] = await runPlannerEvalCase(evalCase, clock)
  }
  return actualOutputsByCaseId
}
