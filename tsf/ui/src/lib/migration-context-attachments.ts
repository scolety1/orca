// Add Project → Context file attachments (M7 real-migration finding, defect
// 6): pasted text, attachment(s), and drag/drop for migration context.
// Read-only evidence, never mutates the target repository — this only feeds
// into the same `handoffText` the reconciliation logic already treats as
// untrusted prose (repo truth outranks document claims), never a separate
// authority. Bounded extraction: only a capped amount of text per file is
// ever kept, never the raw file re-transmitted wholesale on every turn.
//
// Initial formats: .md/.txt/.json extract as plain text (no dependency
// needed — every browser can read a File as UTF-8 text natively).
// .pdf/.docx are NOT extracted: real text extraction from those binary
// formats needs a parser library (pdf-parse/mammoth or similar), and this
// stabilization pass adds no new runtime dependency without explicit
// justification/approval. Provenance (filename/type/size/hash) is still
// recorded honestly for those files; extraction fails openly rather than
// silently, per "unsupported/malformed fail honestly."
const MAX_EXTRACTED_CHARS = 20000
const SUPPORTED_TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json'])
const KNOWN_UNSUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx'])

export type ExtractionStatus = 'EXTRACTED' | 'TRUNCATED' | 'UNSUPPORTED_FORMAT' | 'MALFORMED' | 'EMPTY'

export interface MigrationContextAttachment {
  id: string
  name: string
  type: string
  size: number
  sha256: string | null
  extractedText: string | null
  extractionStatus: ExtractionStatus
  extractionNote: string | null
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // Web Crypto unavailable in this context (e.g. non-HTTPS/non-localhost
    // origin) — provenance still records name/type/size without a hash
    // rather than failing the whole attachment.
    return null
  }
}

export async function extractAttachmentContext(file: File): Promise<MigrationContextAttachment> {
  const id = `${file.name}:${file.size}:${file.lastModified}`
  const buffer = await file.arrayBuffer()
  const sha256 = await sha256Hex(buffer)
  const ext = extensionOf(file.name)
  const base = { id, name: file.name, type: file.type || ext.replace('.', '') || 'unknown', size: file.size, sha256 }

  if (file.size === 0) {
    return { ...base, extractedText: null, extractionStatus: 'EMPTY', extractionNote: 'The file is empty — nothing to extract.' }
  }

  if (KNOWN_UNSUPPORTED_EXTENSIONS.has(ext)) {
    return {
      ...base,
      extractedText: null,
      extractionStatus: 'UNSUPPORTED_FORMAT',
      extractionNote: `Text extraction for ${ext} files needs an approved parser dependency, not yet installed — filename/size/hash are recorded as evidence, but no content was read. Paste the relevant text directly if it matters for this migration.`
    }
  }

  if (!SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
    return {
      ...base,
      extractedText: null,
      extractionStatus: 'UNSUPPORTED_FORMAT',
      extractionNote: `Unrecognized format (${ext || 'no extension'}) — only .md, .txt, and .json are extracted today. Filename/size/hash are still recorded as evidence.`
    }
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  } catch {
    return { ...base, extractedText: null, extractionStatus: 'MALFORMED', extractionNote: 'Could not decode this file as text.' }
  }

  if (ext === '.json') {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      // Not valid JSON — still surface the raw text (bounded below) rather
      // than discarding it, but flag honestly that it wasn't parsed as JSON.
      return {
        ...base,
        extractedText: text.slice(0, MAX_EXTRACTED_CHARS),
        extractionStatus: 'MALFORMED',
        extractionNote: 'This .json file is not valid JSON — showing its raw text content instead.'
      }
    }
  }

  const truncated = text.length > MAX_EXTRACTED_CHARS
  return {
    ...base,
    extractedText: text.slice(0, MAX_EXTRACTED_CHARS),
    extractionStatus: truncated ? 'TRUNCATED' : 'EXTRACTED',
    extractionNote: truncated ? `Truncated to the first ${MAX_EXTRACTED_CHARS.toLocaleString()} characters.` : null
  }
}
