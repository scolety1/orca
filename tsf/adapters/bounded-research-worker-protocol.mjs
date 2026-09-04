// Provider-independent BoundedResearchWorker protocol. Mirrors this
// codebase's established adapter envelope ({ok:true,...} | {ok:false,
// reason, detail} -- see tsf/adapters/security-scanner-adapter.mjs) rather
// than inventing a new shape. No ParallelWorker/ExaWorker/TavilyWorker/
// GPTResearcherWorker exists yet -- only this protocol and the
// deterministic fake implementation are built in this wave.
//
// A conforming worker exposes exactly:
//   dispatch(request: BoundedResearchRequest) =>
//     Promise<{ok:true, workerRunRef} | {ok:false, reason, detail}>
//   fetchResult(workerRunRef) =>
//     Promise<{ok:true, status:'PENDING'}
//            | {ok:true, status:'READY', result: BoundedResearchResult}
//            | {ok:false, reason, detail}>
export function assertBoundedResearchWorker(worker) {
  if (typeof worker?.dispatch !== 'function' || typeof worker?.fetchResult !== 'function') {
    throw new Error('a BoundedResearchWorker must expose async dispatch(request) and fetchResult(workerRunRef)')
  }
}
