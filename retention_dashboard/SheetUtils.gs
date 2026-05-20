// ─── Google Sheets helpers ────────────────────────────────────────────────────

/**
 * Scans the header row and returns the 1-based column index for the current
 * month+year (e.g. "May 2026").  Returns null if not found.
 *
 * The header cell text is matched flexibly: it only needs to contain the
 * 3-letter month abbreviation and the 4-digit year (case-insensitive).
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {number|null}
 */
function findCurrentMonthColumn(sheet) {
  var now = new Date();
  var monthLabel = CONFIG.MONTH_NAMES[now.getMonth()];  // e.g. "May"
  var year       = now.getFullYear();                    // e.g. 2026
  var target     = (monthLabel + ' ' + year).toLowerCase(); // "may 2026"

  var lastCol  = sheet.getLastColumn();
  var headerRow = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];

  for (var c = 0; c < headerRow.length; c++) {
    var cell = String(headerRow[c]).toLowerCase().trim();
    if (cell.includes(monthLabel.toLowerCase()) && cell.includes(String(year))) {
      Logger.log('Current month column found: col ' + (c + 1) + ' ("' + headerRow[c] + '")');
      return c + 1; // 1-based
    }
  }

  Logger.log(
    'WARNING: Could not find column for "' + target + '" in header row ' +
    CONFIG.HEADER_ROW + '. Scanned ' + lastCol + ' columns.'
  );
  return null;
}

/**
 * Builds a map of { rowLabel → rowIndex (1-based) } by scanning column A.
 * Matching is case-insensitive and trims whitespace.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Object.<string, number>}
 */
function buildRowMap(sheet) {
  var lastRow = sheet.getLastRow();
  var labelCol = sheet.getRange(1, CONFIG.LABEL_COL, lastRow, 1).getValues();
  var map = {};

  labelCol.forEach(function(row, idx) {
    var text = String(row[0]).trim();
    if (text) {
      map[text.toLowerCase()] = idx + 1; // 1-based
    }
  });

  return map;
}

/**
 * Writes a single value to the intersection of a row (found by label) and
 * a column.  Skips write if the row label is not found in the sheet.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Object} rowMap  - Output of buildRowMap().
 * @param {number} col     - 1-based column index.
 * @param {string} label   - The exact text in column A for this metric row.
 * @param {*}      value   - Value to write (number, string, or null).
 */
function writeMetricValue(sheet, rowMap, col, label, value) {
  if (value === null || value === undefined) {
    Logger.log('SKIP write for "' + label + '" — value is null/undefined');
    return;
  }

  // Try exact match first, then case-insensitive partial match.
  var rowIdx = rowMap[label.toLowerCase()];

  if (!rowIdx) {
    // Partial match: find any map key that contains the label fragment
    var lowerLabel = label.toLowerCase();
    var keys = Object.keys(rowMap);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].includes(lowerLabel) || lowerLabel.includes(keys[i])) {
        rowIdx = rowMap[keys[i]];
        Logger.log('Partial label match: "' + label + '" → row ' + rowIdx);
        break;
      }
    }
  }

  if (!rowIdx) {
    Logger.log('WARNING: Row label not found in sheet: "' + label + '"');
    return;
  }

  sheet.getRange(rowIdx, col).setValue(value);
  Logger.log('Written ' + value + ' → row ' + rowIdx + ', col ' + col + ' ("' + label + '")');
}

/**
 * Returns the current month label as "MMM YYYY" for log messages.
 */
function getCurrentMonthLabel() {
  var now = new Date();
  return CONFIG.MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear();
}
