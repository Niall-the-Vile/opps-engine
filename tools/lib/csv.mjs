// tools/lib/csv.mjs
//
// Minimal RFC-4180 CSV parser. Handles quoted fields (including embedded
// commas, embedded quotes escaped as "", and embedded newlines), because
// several source files in this build (Addendum B, CLFS, PPRRVU) carry
// quoted cells with internal commas that a naive split(',') would corrupt.
//
// Deliberately does not know about any particular file's column layout —
// that indexing lives in tools/gen-data.mjs, per the spec's requirement
// that all raw row indexing live in one place.

/**
 * Parse an RFC-4180 CSV string into an array of rows, each an array of
 * field strings. CRLF, LF, and bare CR are all accepted as row terminators
 * outside of quotes.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF or bare CR — treat as one row terminator.
      if (text[i + 1] === '\n') {
        endRow();
        i += 2;
        continue;
      }
      endRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Final field/row, if the text didn't end with a row terminator.
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  // Drop a single trailing wholly-empty row produced by a trailing
  // terminator (e.g. the file ends with \r\n).
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') {
      rows.pop();
    }
  }

  return rows;
}
