import assert from 'node:assert/strict'
import test from 'node:test'
import { beginOperatorAction, completeOperatorAction, reconcileInterruptedActions } from '../domain/operator-action-lifecycle.mjs'

function session() {
  return { id: 's1', mission_id: 'm1', current_state: 'READY_FOR_ADOPTION', current_candidate_id: 'c1', attempt_number: 1 }
}

test('directly reused legacy idempotency helper suppresses duplicate consequential actions', () => {
  const value = session()
  const body = { action_request_id: 'request-1', candidate_id: 'c1', patch_hash: 'patch-1' }
  const first = beginOperatorAction(value, 'approve-adoption', body, '2026-08-17T18:00:00.000Z')
  const pending = beginOperatorAction(value, 'approve-adoption', { ...body, action_request_id: 'request-2' }, '2026-08-17T18:00:01.000Z')
  assert.equal(pending.duplicate_pending, true)
  completeOperatorAction(value, first.transaction, 'adopted', '2026-08-17T18:00:02.000Z')
  const complete = beginOperatorAction(value, 'approve-adoption', { ...body, action_request_id: 'request-3' }, '2026-08-17T18:00:03.000Z')
  assert.equal(complete.duplicate_success, true)
  assert.equal(first.transaction.execution_count, 1)
})

test('directly reused helper fails interrupted actions safely', () => {
  const value = session()
  beginOperatorAction(value, 'approve-adoption', { action_request_id: 'request-1', candidate_id: 'c1' }, '2026-08-17T18:00:00.000Z')
  assert.equal(reconcileInterruptedActions(value, '2026-08-17T18:00:01.000Z'), true)
  assert.equal(value.operator_action_transactions[0].status, 'ERROR')
  assert.equal(value.operator_action_transactions[0].error.safe_retry, true)
})
