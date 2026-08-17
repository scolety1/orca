import { createHash } from 'node:crypto'

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    )
  }
  return value
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value) {
  const bytes = typeof value === 'string' ? value : canonicalJson(value)
  return createHash('sha256').update(bytes, 'utf8').digest('hex')
}

export function deepClone(value) {
  return structuredClone(value)
}

export function assertExpectedRevision(record, expectedRevision) {
  if (expectedRevision !== undefined && record.revision !== expectedRevision) {
    const error = new Error(
      `stale revision: expected ${expectedRevision}, observed ${record.revision}`
    )
    error.code = 'TSF_STALE_REVISION'
    throw error
  }
}

export function isoNow(clock = () => new Date()) {
  return clock().toISOString()
}
