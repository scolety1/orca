import { createHash, randomUUID } from "node:crypto";

export const OPERATOR_ACTION_LIFECYCLE_SCHEMA = "tsf_operator_action_lifecycle_v1";
export const OPERATOR_ACTION_TRANSACTION_SCHEMA = "tsf_operator_action_transaction_v1";
export const OPERATOR_ACTION_STATES = Object.freeze(["IDLE", "SUBMITTING", "SUCCESS", "ERROR"]);

const sha256 = value => createHash("sha256").update(String(value)).digest("hex");
const iso = () => new Date().toISOString();
const candidateActions = new Set(["approve-adoption", "approve-local-commit", "reject-and-revise", "submit-revision-feedback", "defer-adoption", "reject-and-end", "reject-adoption", "resume-adoption-review"]);

export function operatorActionIdentity(session, action, body = {}) {
  const candidate = candidateActions.has(action) ? body.candidate_action_binding || {
    candidate_id: body.candidate_id || session.current_candidate_id || null,
    patch_hash: body.patch_hash || null,
    attempt_number: Number(session.attempt_number || 1),
  } : null;
  const material = {
    session_id: session.id,
    mission_id: session.mission_id,
    action,
    source_state: candidateActions.has(action) ? null : session.current_state,
    candidate,
    selection: body.selection || null,
    command: body.command || null,
    decision: body.decision || null,
    confirmation: body.confirmation || null,
    local_commit_binding: body.local_commit_approval?.local_commit_binding || null,
    commit_message: body.local_commit_approval?.commit_message || null,
  };
  return `action-${sha256(JSON.stringify(material)).slice(0, 32)}`;
}

export function beginOperatorAction(session, action, body = {}, observedAt = iso()) {
  const transactionId = operatorActionIdentity(session, action, body), requestId = String(body.action_request_id || `request-${randomUUID().replaceAll("-", "")}`);
  session.operator_action_transactions ||= [];
  let transaction = session.operator_action_transactions.find(item => item.transaction_id === transactionId);
  if (!transaction) {
    transaction = { schema_version: OPERATOR_ACTION_TRANSACTION_SCHEMA, transaction_id: transactionId, action, session_id: session.id, mission_id: session.mission_id, status: "IDLE", request_ids: [], request_count: 0, execution_count: 0, attempts: [], target: candidateActions.has(action) ? body.candidate_action_binding || { candidate_id: body.candidate_id || session.current_candidate_id || null, patch_hash: body.patch_hash || null } : null, publication: "BLOCKED", created_at: observedAt };
    session.operator_action_transactions.push(transaction);
  }
  const duplicateSuccess = transaction.status === "SUCCESS", duplicatePending = transaction.status === "SUBMITTING";
  if (!transaction.request_ids.includes(requestId)) transaction.request_ids.push(requestId);
  transaction.request_count += 1; transaction.last_request_id = requestId; transaction.updated_at = observedAt;
  if (!duplicateSuccess && !duplicatePending) { transaction.status = "SUBMITTING"; transaction.execution_count += 1; transaction.attempts.push({ request_id: requestId, state: "SUBMITTING", observed_at: observedAt }); }
  session.current_action_status = { schema_version: OPERATOR_ACTION_LIFECYCLE_SCHEMA, state: duplicateSuccess ? "SUCCESS" : "SUBMITTING", action, transaction_id: transactionId, request_id: requestId, label: action, detail: duplicateSuccess ? "The exact action already completed; no duplicate was created." : duplicatePending ? "The exact action is already pending; no duplicate execution was started." : "The operator action was accepted for governed processing.", sticky: true, updated_at: observedAt };
  return { transaction, transaction_id: transactionId, request_id: requestId, duplicate_success: duplicateSuccess, duplicate_pending: duplicatePending };
}

export function completeOperatorAction(session, transaction, detail, observedAt = iso()) {
  transaction.status = "SUCCESS"; transaction.result_state = session.current_state; transaction.success_at = observedAt; transaction.updated_at = observedAt; transaction.error = null;
  const attempt = transaction.attempts.at(-1); if (attempt?.state === "SUBMITTING") { attempt.state = "SUCCESS"; attempt.completed_at = observedAt; attempt.result_state = session.current_state; }
  session.current_action_status = { schema_version: OPERATOR_ACTION_LIFECYCLE_SCHEMA, state: "SUCCESS", action: transaction.action, transaction_id: transaction.transaction_id, request_id: transaction.last_request_id, label: transaction.action, detail: detail || "The governed operator action completed.", sticky: true, updated_at: observedAt };
  return transaction;
}

export function failOperatorAction(session, transaction, error, options = {}, observedAt = iso()) {
  const code = error?.code || String(error?.message || "OPERATOR_ACTION_FAILED").match(/TSF_[A-Z0-9_]+/)?.[0] || "OPERATOR_ACTION_FAILED", message = error?.message || "The governed operator action failed.";
  transaction.status = "ERROR"; transaction.error = { code, message, original_project: options.originalProject || "UNCHANGED", candidate: options.candidate || "UNCHANGED", safe_retry: options.safeRetry !== false }; transaction.failed_at = observedAt; transaction.updated_at = observedAt;
  const attempt = transaction.attempts.at(-1); if (attempt?.state === "SUBMITTING") { attempt.state = "ERROR"; attempt.completed_at = observedAt; attempt.error_code = code; }
  session.current_action_status = { schema_version: OPERATOR_ACTION_LIFECYCLE_SCHEMA, state: "ERROR", action: transaction.action, transaction_id: transaction.transaction_id, request_id: transaction.last_request_id, label: transaction.action, detail: message, original_project: transaction.error.original_project, candidate: transaction.error.candidate, safe_retry: transaction.error.safe_retry, sticky: true, updated_at: observedAt };
  return transaction;
}

export function reconcileInterruptedActions(session, observedAt = iso()) {
  let changed = false;
  for (const transaction of session.operator_action_transactions || []) if (transaction.status === "SUBMITTING") { failOperatorAction(session, transaction, Object.assign(new Error("The HQ restarted before this action returned a committed result."), { code: "ACTION_RESULT_INTERRUPTED" }), { originalProject: "UNCHANGED", candidate: "UNCHANGED", safeRetry: true }, observedAt); changed = true; }
  return changed;
}
