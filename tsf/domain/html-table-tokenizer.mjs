// Dependency-free static-HTML <table> extraction. Deliberately scoped to
// table-relevant tags only (table/thead/tbody/tfoot/tr/th/td/caption) rather
// than a full HTML parser, matching this package's zero-dependency
// architecture (see tsf/package.json). A table nested inside a cell is not
// parsed as a separate table -- its rendered text is flattened into the
// containing cell's text, which is a documented V0 simplification.

// The attrs group consumes quoted attribute values as whole units so a
// literal '>' inside e.g. title="a>b" doesn't end the tag early.
const TAG_PATTERN =
  /<\/?\s*(table|thead|tbody|tfoot|tr|th|td|caption)\b((?:[^"'>]|"[^"]*"|'[^']*')*)>/gi
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const codePoint =
        code[1].toLowerCase() === 'x'
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

export function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

// Clamped to the HTML Standard's own colspan/rowspan ceilings (1000 / 65534)
// so a scraped page can't force an unbounded array allocation -- an
// untrusted page setting e.g. colspan="999999999" would otherwise throw an
// uncaught RangeError out of extractTablesFromHtml instead of the structured
// failure receipt the rest of this adapter guarantees.
function getIntAttr(attrsRaw, name, fallback, max) {
  const match = attrsRaw.match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)["']?`, 'i'))
  const value = match ? Number(match[1]) : Number.NaN
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback
}

// Blanks out HTML comments (same length, so positions stay valid for callers
// slicing the original string) so commented-out/mocked-up markup is never
// mistaken for a live table.
export function maskHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (match) => ' '.repeat(match.length))
}

function tokenize(html) {
  const tokens = []
  for (const match of html.matchAll(TAG_PATTERN)) {
    tokens.push({
      tag: match[1].toLowerCase(),
      closing: match[0][1] === '/',
      attrsRaw: match[2] ?? '',
      index: match.index,
      endIndex: match.index + match[0].length
    })
  }
  return tokens
}

function expandBodyRow(cells) {
  const out = []
  for (const cell of cells) {
    for (let i = 0; i < cell.colspan; i++) {
      out.push(cell.text)
    }
  }
  return out
}

function flattenHeaderRows(headerRowsRaw) {
  if (headerRowsRaw.length === 0) {
    return { headers: [], columnCount: 0 }
  }
  const grid = []
  const rowspanCarry = new Map()
  let maxCols = 0
  headerRowsRaw.forEach((row, rowIndex) => {
    grid[rowIndex] = []
    let col = 0
    const placeCarries = () => {
      while (rowspanCarry.has(col)) {
        const carry = rowspanCarry.get(col)
        grid[rowIndex][col] = carry.text
        carry.remaining -= 1
        if (carry.remaining <= 0) {
          rowspanCarry.delete(col)
        }
        col += 1
      }
    }
    placeCarries()
    for (const cell of row.cells) {
      for (let i = 0; i < cell.colspan; i++) {
        placeCarries()
        grid[rowIndex][col] = cell.text
        if (cell.rowspan > 1) {
          rowspanCarry.set(col, { text: cell.text, remaining: cell.rowspan - 1 })
        }
        col += 1
      }
    }
    placeCarries()
    maxCols = Math.max(maxCols, col)
  })
  const headers = []
  for (let c = 0; c < maxCols; c++) {
    const parts = []
    for (let r = 0; r < grid.length; r++) {
      const value = grid[r]?.[c]
      if (value && !parts.includes(value)) {
        parts.push(value)
      }
    }
    headers.push(parts.join(' / ') || `column_${c + 1}`)
  }
  return { headers, columnCount: maxCols }
}

function nestedTableWarning(index, nestedTables) {
  const rowIndexes = [...new Set(nestedTables.map((n) => n.atRowIndex).filter((v) => v !== null))]
  const location =
    rowIndexes.length > 0
      ? ` at row index${rowIndexes.length === 1 ? '' : 'es'} [${rowIndexes.join(', ')}]`
      : ''
  return (
    `NESTED_TABLE_FLATTENED: outer table index ${index} contains ${nestedTables.length} nested <table> ` +
    `element(s)${location}. Behavior applied: flattened to plain text inside the containing cell -- the ` +
    'nested table(s) own rows, columns, and headers were discarded, not extracted separately. This may ' +
    "distort the outer table's inferred schema (a nested table's cell text is merged into one column's value)."
  )
}

function finalizeTable(build, index) {
  const header = flattenHeaderRows(build.headerRowsRaw)
  const bodyRows = build.bodyRowsRaw.map((row) => expandBodyRow(row.cells))
  const columnCount = Math.max(header.columnCount, ...bodyRows.map((row) => row.length), 0)
  const warnings = [...build.warnings]
  bodyRows.forEach((row, rowIndex) => {
    if (row.length !== columnCount) {
      warnings.push(
        `ROW_LENGTH_MISMATCH at body row ${rowIndex}: expected ${columnCount} cells, got ${row.length}`
      )
    }
  })
  if (build.nestedTables.length > 0) {
    warnings.push(nestedTableWarning(index, build.nestedTables))
  }
  return {
    index,
    caption: build.caption,
    headers: header.headers,
    headerRowCount: build.headerRowsRaw.length,
    bodyRows,
    rowCount: bodyRows.length,
    columnCount,
    startIndex: build.startIndex,
    endIndex: build.endIndex,
    warnings
  }
}

/** Extracts every top-level (non-nested) <table> from `html`, in document order. */
export function extractTablesFromHtml(html) {
  html = maskHtmlComments(html)
  const tokens = tokenize(html)
  const tables = []
  let tableDepth = 0
  let build = null
  let section = null // 'thead' | 'tbody' | 'tfoot' | null
  let sawBodyRow = false
  let currentRow = null
  let cellOpen = null
  let captionStart = null
  let rawRowIndex = -1

  const closeDanglingCell = (reason, boundaryIndex) => {
    if (!cellOpen || !currentRow) {
      return
    }
    currentRow.cells.push({
      tag: cellOpen.tag,
      text: stripTags(html.slice(cellOpen.contentStart, boundaryIndex)),
      colspan: cellOpen.colspan,
      rowspan: cellOpen.rowspan
    })
    build.warnings.push(reason)
    cellOpen = null
  }

  for (const token of tokens) {
    if (token.tag === 'table') {
      if (!token.closing) {
        tableDepth += 1
        if (tableDepth === 1) {
          build = {
            startIndex: token.index,
            caption: null,
            headerRowsRaw: [],
            bodyRowsRaw: [],
            warnings: [],
            nestedTables: []
          }
          section = null
          sawBodyRow = false
          rawRowIndex = -1
        } else if (tableDepth === 2 && build) {
          // entering a table nested one level inside our current top-level
          // table -- record where, before its content gets skipped below.
          build.nestedTables.push({
            atRowIndex: rawRowIndex >= 0 ? rawRowIndex : null,
            atCellTag: cellOpen?.tag ?? null
          })
        }
      } else {
        if (tableDepth === 1 && build) {
          closeDanglingCell('UNCLOSED_CELL_AT_TABLE_END_AUTO_CLOSED', token.index)
          build.endIndex = token.endIndex
          tables.push(finalizeTable(build, tables.length))
          build = null
        }
        tableDepth = Math.max(0, tableDepth - 1)
      }
      continue
    }
    if (!build || tableDepth !== 1) {
      continue
    } // outside any table, or inside a nested one

    if (token.tag === 'thead' || token.tag === 'tbody' || token.tag === 'tfoot') {
      section = token.closing ? null : token.tag
      continue
    }
    if (token.tag === 'caption') {
      if (!token.closing) {
        captionStart = token.endIndex
      } else if (captionStart !== null) {
        build.caption = stripTags(html.slice(captionStart, token.index))
        captionStart = null
      }
      continue
    }
    if (token.tag === 'tr') {
      if (!token.closing) {
        currentRow = { cells: [] }
        rawRowIndex += 1
      } else if (currentRow) {
        closeDanglingCell('UNCLOSED_CELL_AT_ROW_END_AUTO_CLOSED', token.index)
        // thead is always a header row and tfoot is never one; a row inside
        // tbody or with no section wrapper (real-world markup often omits
        // thead) is a header only by the leading-all-<th> heuristic.
        const allThCells =
          currentRow.cells.length > 0 && currentRow.cells.every((c) => c.tag === 'th')
        const isHeaderRow =
          section === 'thead' ? true : section === 'tfoot' ? false : !sawBodyRow && allThCells
        if (isHeaderRow) {
          build.headerRowsRaw.push(currentRow)
        } else {
          sawBodyRow = true
          build.bodyRowsRaw.push(currentRow)
        }
        currentRow = null
      }
      continue
    }
    if (token.tag === 'th' || token.tag === 'td') {
      if (!token.closing) {
        if (!currentRow) {
          continue
        }
        closeDanglingCell('UNCLOSED_CELL_AUTO_CLOSED_BY_NEXT_CELL', token.index)
        cellOpen = {
          tag: token.tag,
          contentStart: token.endIndex,
          colspan: getIntAttr(token.attrsRaw, 'colspan', 1, 1000),
          rowspan: getIntAttr(token.attrsRaw, 'rowspan', 1, 65534)
        }
      } else if (cellOpen) {
        currentRow.cells.push({
          tag: cellOpen.tag,
          text: stripTags(html.slice(cellOpen.contentStart, token.index)),
          colspan: cellOpen.colspan,
          rowspan: cellOpen.rowspan
        })
        cellOpen = null
      }
      continue
    }
  }

  return tables
}
