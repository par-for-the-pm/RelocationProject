// ─── Retention Dashboard Automation — Entry Points ───────────────────────────
//
// SETUP (one-time, run from Apps Script editor):
//   1. Run setupTrigger()  → creates daily 11 AM IST trigger
//   2. Run configureProperties() → walks through setting required Script Properties
//   3. Run runNow() to verify everything works end-to-end
//
// DAILY FLOW:
//   scheduledRun() (called by trigger)
//     → main() — fetch + compute + write
//     → sendErrorAlert() if anything throws
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manual trigger — run this from the editor to test at any time.
 */
function runNow() {
  Logger.log('=== Retention Dashboard — manual run ===');
  try {
    main();
  } catch (e) {
    Logger.log('ERROR: ' + e.message + '\n' + e.stack);
    sendErrorAlert_(e);
    throw e;
  }
}

/**
 * Called automatically by the time-based trigger at 11 AM IST.
 */
function scheduledRun() {
  Logger.log('=== Retention Dashboard — scheduled run (' + new Date().toISOString() + ') ===');
  try {
    main();
  } catch (e) {
    Logger.log('ERROR: ' + e.message + '\n' + e.stack);
    sendErrorAlert_(e);
  }
}

// ─── Core logic ──────────────────────────────────────────────────────────────

function main() {
  var ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    throw new Error(
      'Sheet "' + CONFIG.SHEET_NAME + '" not found in spreadsheet ' + CONFIG.SPREADSHEET_ID
    );
  }

  // ── 1. Find the current month's column ──────────────────────────────────
  var col = findCurrentMonthColumn(sheet);
  if (!col) {
    throw new Error(
      'Current month column (' + getCurrentMonthLabel() + ') not found in the sheet. ' +
      'Ensure the header row (' + CONFIG.HEADER_ROW + ') contains a cell with "' +
      getCurrentMonthLabel() + '".'
    );
  }

  // ── 2. Fetch raw metrics from Metabase ───────────────────────────────────
  var P  = fetchIntentToReturn();                   // (P) Intent to Return
  var rm = fetchRenewalMasters();                    // (A) Full, (B) Partial
  var A  = rm.fullReturns;
  var B  = rm.partialReturns;
  var rf = fetchRenewalsFigures();                   // ASB, UFR, Revenue, Count
  var ASB            = rf.asb;
  var UFR            = rf.ufr;
  var renewalRevenue = rf.renewalRevenue;
  var countRenewals  = rf.countOfRenewals;

  // ── 3. Compute derived metrics ───────────────────────────────────────────
  var pctFullReturns    = P > 0 ? A / P : null;
  var pctPartialReturns = P > 0 ? B / P : null;
  var overallReturnPct  = P > 0 ? (A + B) / P : null;
  var ARPU = (countRenewals && countRenewals > 0) ? renewalRevenue / countRenewals : null;
  // BRPU formula is TBD — placeholder; update once definition is confirmed.
  var BRPU = null;

  // ── 4. Build row-label → row-index map ───────────────────────────────────
  var rowMap = buildRowMap(sheet);

  // ── 5. Write all values ───────────────────────────────────────────────────
  var R = CONFIG.ROWS;
  var w = writeMetricValue.bind(null, sheet, rowMap, col);

  w(R.INTENT_TO_RETURN,    P);
  w(R.FULL_RETURNS,        A);
  w(R.PARTIAL_RETURNS,     B);
  w(R.PCT_FULL_RETURNS,    pctFullReturns);
  w(R.PCT_PARTIAL_RETURNS, pctPartialReturns);
  w(R.OVERALL_RETURN_PCT,  overallReturnPct);
  w(R.ASB,                 ASB);
  w(R.UFR,                 UFR);
  w(R.RENEWAL_REVENUE,     renewalRevenue);
  w(R.COUNT_OF_RENEWALS,   countRenewals);
  w(R.ARPU,                ARPU);
  w(R.BRPU,                BRPU);
  // Rows below are TBD pending source confirmation — skipped until confirmed.
  // w(R.RENEWED_NO_OFFER, ...);
  // w(R.RETAINED,         ...);
  // w(R.SWAPPED_NO_ACTION,...);

  Logger.log('=== Dashboard updated successfully for ' + getCurrentMonthLabel() + ' ===');
}

// ─── Error alerting ───────────────────────────────────────────────────────────

function sendErrorAlert_(error) {
  var props     = PropertiesService.getScriptProperties();
  var recipient = props.getProperty('ALERT_EMAIL');
  if (!recipient) {
    Logger.log('No ALERT_EMAIL configured — skipping error email.');
    return;
  }

  var subject = '[Retention Dashboard] Auto-fill failed — ' + getCurrentMonthLabel();
  var body = [
    'The Retention Dashboard auto-fill script encountered an error.',
    '',
    'Time: ' + new Date().toString(),
    'Month: ' + getCurrentMonthLabel(),
    '',
    'Error: ' + error.message,
    '',
    'Stack trace:',
    error.stack || '(no stack)',
    '',
    'Please check the Apps Script execution log for details:',
    'https://script.google.com',
  ].join('\n');

  try {
    MailApp.sendEmail(recipient, subject, body);
    Logger.log('Error alert sent to ' + recipient);
  } catch (mailErr) {
    Logger.log('Failed to send error alert email: ' + mailErr.message);
  }
}

// ─── Setup utilities ──────────────────────────────────────────────────────────

/**
 * Creates a daily time-based trigger at 11:00 AM IST (05:30 UTC).
 * Safe to run multiple times — removes duplicate triggers first.
 */
function setupTrigger() {
  // Remove any existing triggers pointing to scheduledRun to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'scheduledRun') {
      ScriptApp.deleteTrigger(t);
      Logger.log('Removed existing trigger.');
    }
  });

  // Apps Script time-based triggers run in the project's timezone (Asia/Kolkata
  // as set in appsscript.json), so "atHour(11)" means 11 AM IST.
  ScriptApp.newTrigger('scheduledRun')
    .timeBased()
    .everyDays(1)
    .atHour(11)
    .create();

  Logger.log('Daily trigger created: scheduledRun will run at 11:00 AM IST.');
}

/**
 * Interactive helper — run once from the editor to set all required
 * Script Properties via Browser.inputBox prompts.
 *
 * NOTE: Browser dialogs work only when run manually in the Apps Script editor,
 * not from a trigger or API call.
 */
function configureProperties() {
  var props = PropertiesService.getScriptProperties();

  var apiKey = Browser.inputBox(
    'Metabase API Key',
    'Enter your Metabase API key (leave blank to use username/password instead):',
    Browser.Buttons.OK_CANCEL
  );
  if (apiKey && apiKey !== 'cancel') props.setProperty('METABASE_API_KEY', apiKey.trim());

  if (!apiKey || apiKey === 'cancel') {
    var username = Browser.inputBox('Metabase Username', 'Enter your Metabase username:', Browser.Buttons.OK_CANCEL);
    var password = Browser.inputBox('Metabase Password', 'Enter your Metabase password:', Browser.Buttons.OK_CANCEL);
    if (username !== 'cancel') props.setProperty('METABASE_USERNAME', username.trim());
    if (password !== 'cancel') props.setProperty('METABASE_PASSWORD', password.trim());
  }

  var renewalsId = Browser.inputBox(
    'Renewals Figures Question ID',
    'Enter the Metabase card ID for "Renewals Figures" (numeric):',
    Browser.Buttons.OK_CANCEL
  );
  if (renewalsId && renewalsId !== 'cancel') props.setProperty('RENEWALS_QUESTION_ID', renewalsId.trim());

  var alertEmail = Browser.inputBox(
    'Alert Email',
    'Enter the email address to receive error notifications:',
    Browser.Buttons.OK_CANCEL
  );
  if (alertEmail && alertEmail !== 'cancel') props.setProperty('ALERT_EMAIL', alertEmail.trim());

  Browser.msgBox('Configuration saved. Run runNow() to test the script.');
}

/**
 * Prints all current Script Properties to the log (values masked) for debugging.
 */
function listProperties() {
  var props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).forEach(function(k) {
    var v = props[k];
    // Mask secrets in the log
    var display = (k.toLowerCase().includes('key') || k.toLowerCase().includes('password'))
      ? v.substring(0, 4) + '****'
      : v;
    Logger.log(k + ' = ' + display);
  });
}
