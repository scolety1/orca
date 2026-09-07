// Phase 3 Wave 2 (3C): OWNER_SUPPLIED_LOCAL_ARTIFACT -- a real acquisition
// path for a caller-supplied local file or already-read content, instead
// of fetching from the web. Reuses the exact same table discovery pipeline
// web-table-source-adapter.mjs's live fetch path already runs
// (extractAndSelectTable: REUSE_DIRECT), so a saved/local HTML table
// snapshot is processed identically to one this codebase acquired live --
// bounded V0 scope, other local content shapes (CSV/JSON/etc.) are
// deliberately NOT built here (see the final report's deferred list).
//
// Provenance is explicit and CALLER-ASSERTED ONLY, never independently
// verified and never inferred: ownerAssertion.assertedBy is required (this
// function throws rather than fabricate a source for a missing assertion),
// and the resulting receipt's ownerProvenance.independentlyVerified is
// hardcoded false (see web-source-acquisition-receipt.mjs). Missing/partial
// metadata (a file that can't be read, content that parses to no table) is
// reported honestly via a distinct ACQUISITION_ERROR receipt -- never a
// fabricated success.
import { readFile } from 'node:fs/promises'
import { isoNow } from './canonical.mjs'
import { extractAndSelectTable } from './web-table-source-adapter.mjs'
import {
  buildOwnerSuppliedArtifactReceipt,
  buildOwnerSuppliedArtifactErrorReceipt
} from './web-source-acquisition-receipt.mjs'

/**
 * `filePath` XOR `content` must be supplied: `filePath` for a caller running
 * where the file is locally accessible (the common desktop case); `content`
 * for a caller (e.g. a remote/SSH-host-side flow, or a future UI upload)
 * that already read the bytes itself and wants to hand them off without a
 * second filesystem read -- both paths converge on the identical receipt
 * shape below. `ownerAssertion.assertedBy` is mandatory: real, explicit
 * provenance, never inferred from the file path or content itself.
 */
export async function acquireOwnerSuppliedLocalArtifact({
  filePath,
  content,
  ownerAssertion,
  tableSelectionHint,
  retentionPolicy = { allowRawRetention: false },
  clock = () => new Date()
}) {
  if (!ownerAssertion?.assertedBy) {
    throw new Error('acquireOwnerSuppliedLocalArtifact requires an explicit ownerAssertion.assertedBy -- provenance for OWNER_SUPPLIED_LOCAL_ARTIFACT must never be fabricated or inferred')
  }
  if ((filePath == null) === (content == null)) {
    throw new Error('acquireOwnerSuppliedLocalArtifact requires exactly one of filePath or content')
  }
  const sourceRef = filePath ?? `inline-content:${ownerAssertion.assertedBy}:${isoNow(clock)}`

  let rawContent
  if (content != null) {
    rawContent = content
  } else {
    try {
      rawContent = await readFile(filePath, 'utf-8')
    } catch (error) {
      return {
        receipt: buildOwnerSuppliedArtifactErrorReceipt({
          sourceRef,
          ownerAssertion,
          failureReason: 'ARTIFACT_READ_FAILED',
          failureDetail: error.message,
          clock
        })
      }
    }
  }

  if (rawContent.trim().length === 0) {
    return {
      receipt: buildOwnerSuppliedArtifactErrorReceipt({
        sourceRef,
        ownerAssertion,
        failureReason: 'ARTIFACT_EMPTY',
        failureDetail: 'supplied content is empty (or whitespace-only) -- nothing to ingest',
        clock
      })
    }
  }

  const { table, schema, selection } = extractAndSelectTable(rawContent, tableSelectionHint)
  if (!table) {
    return {
      receipt: buildOwnerSuppliedArtifactErrorReceipt({
        sourceRef,
        ownerAssertion,
        failureReason: 'NO_TABLES_FOUND',
        failureDetail: sourceRef,
        clock
      }),
      selection
    }
  }

  const receipt = buildOwnerSuppliedArtifactReceipt({ sourceRef, ownerAssertion, rawContent, table, schema, retentionPolicy, clock })
  return { receipt, selection }
}
