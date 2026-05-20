// ─── Metabase API helpers ─────────────────────────────────────────────────────

/**
 * Returns request headers for Metabase.
 * Prefers a static API key (set as Script Property METABASE_API_KEY).
 * Falls back to username/password session auth if no API key is present.
 */
function getMetabaseHeaders_() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('METABASE_API_KEY');

  if (apiKey) {
    return { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };
  }

  // Session-based fallback
  var token = getOrRefreshSessionToken_();
  return { 'X-Metabase-Session': token, 'Content-Type': 'application/json' };
}

/**
 * Obtains a Metabase session token using username/password, caches it in
 * Script Properties for the duration of the run to avoid re-auth on every call.
 */
function getOrRefreshSessionToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('METABASE_SESSION_TOKEN');
  if (cached) return cached;

  var props = PropertiesService.getScriptProperties();
  var username = props.getProperty('METABASE_USERNAME');
  var password = props.getProperty('METABASE_PASSWORD');

  if (!username || !password) {
    throw new Error(
      'Metabase credentials missing. Set METABASE_API_KEY (preferred) or both ' +
      'METABASE_USERNAME and METABASE_PASSWORD in Script Properties.'
    );
  }

  var resp = UrlFetchApp.fetch(CONFIG.METABASE_BASE_URL + '/api/session', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ username: username, password: password }),
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('Metabase session auth failed: ' + resp.getContentText());
  }

  var token = JSON.parse(resp.getContentText()).id;
  // Cache for 55 minutes (session valid for ~1 hour)
  cache.put('METABASE_SESSION_TOKEN', token, 55 * 60);
  return token;
}

/**
 * Executes a saved Metabase card/question and returns the parsed JSON result.
 * @param {number} cardId - Metabase card (question) ID.
 * @param {Array}  parameters - Optional array of Metabase parameter objects.
 * @returns {Object} Raw Metabase query result JSON.
 */
function runMetabaseCard_(cardId, parameters) {
  var url = CONFIG.METABASE_BASE_URL + '/api/card/' + cardId + '/query';
  var payload = {};
  if (parameters && parameters.length > 0) {
    payload.parameters = parameters;
  }

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: getMetabaseHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var code = resp.getResponseCode();
  if (code !== 202 && code !== 200) {
    throw new Error(
      'Metabase card ' + cardId + ' query failed (' + code + '): ' +
      resp.getContentText().substring(0, 500)
    );
  }

  return JSON.parse(resp.getContentText());
}

/**
 * Returns column names from a Metabase query result.
 * @param {Object} result - Raw Metabase result JSON.
 * @returns {string[]}
 */
function getColumnNames_(result) {
  return result.data.cols.map(function(c) { return c.name; });
}

/**
 * Returns all data rows from a Metabase query result as arrays.
 * @param {Object} result - Raw Metabase result JSON.
 * @returns {Array[]}
 */
function getRows_(result) {
  return result.data.rows;
}

/**
 * Finds the index of a column in a Metabase result by name (case-insensitive).
 * Throws if not found.
 */
function colIndex_(cols, name) {
  var lower = name.toLowerCase();
  var idx = cols.findIndex(function(c) { return c.toLowerCase() === lower; });
  if (idx === -1) throw new Error('Column "' + name + '" not found in Metabase result. Available: ' + cols.join(', '));
  return idx;
}

// ─── Domain-specific fetchers ─────────────────────────────────────────────────

/**
 * Fetches Q11162 (Retention Efficiency MoM) and returns the count of
 * "Stay & Gift Created" for the current month.
 * @returns {number}
 */
function fetchIntentToReturn() {
  Logger.log('Fetching Q11162 — Retention Efficiency MoM...');
  var result = runMetabaseCard_(CONFIG.QUESTION_INTENT_TO_RETURN);
  var cols = getColumnNames_(result);
  var rows = getRows_(result);

  // The question tracks intent-to-return counts. We sum all rows that
  // represent the current month (the question already filters by month,
  // so we just sum the count column).
  //
  // Expected column: "count" or "Count" — adjust if schema differs.
  var countIdx;
  try {
    countIdx = colIndex_(cols, 'count');
  } catch(e) {
    // Try common alternatives
    countIdx = cols.findIndex(function(c) {
      return c.toLowerCase().includes('count') || c.toLowerCase().includes('total');
    });
    if (countIdx === -1) throw new Error('Cannot locate count column in Q11162. Columns: ' + cols.join(', '));
  }

  var total = rows.reduce(function(sum, row) {
    return sum + (Number(row[countIdx]) || 0);
  }, 0);

  Logger.log('Q11162 → Intent to Return (P) = ' + total);
  return total;
}

/**
 * Fetches Q8007 (Renewal Masters v4) filtered to start_date = 1st of the
 * current month, and returns { fullReturns, partialReturns }.
 * @returns {{ fullReturns: number, partialReturns: number }}
 */
function fetchRenewalMasters() {
  Logger.log('Fetching Q8007 — Renewal Masters v4...');

  var firstOfMonth = getFirstOfCurrentMonth_();

  // Pass a date parameter if the question exposes one.
  // Metabase parameter format depends on the parameter slug defined in the question.
  // Adjust "start_date" slug to match the actual parameter name in Q8007.
  var parameters = [
    {
      type: 'date/single',
      target: ['variable', ['template-tag', 'start_date']],
      value: firstOfMonth,
    },
  ];

  var result;
  try {
    result = runMetabaseCard_(CONFIG.QUESTION_RENEWAL_MASTERS, parameters);
  } catch(e) {
    // If parameterised call fails (e.g. question has no template tag), retry without params
    Logger.log('Parameterised Q8007 call failed (' + e.message + '), retrying without params...');
    result = runMetabaseCard_(CONFIG.QUESTION_RENEWAL_MASTERS);
  }

  var cols = getColumnNames_(result);
  var rows = getRows_(result);

  // Look for columns whose names hint at full/partial returns.
  var fullIdx = cols.findIndex(function(c) {
    return c.toLowerCase().includes('full') && c.toLowerCase().includes('return');
  });
  var partialIdx = cols.findIndex(function(c) {
    return c.toLowerCase().includes('partial') && c.toLowerCase().includes('return');
  });

  if (fullIdx === -1 || partialIdx === -1) {
    throw new Error(
      'Cannot locate Full/Partial Returns columns in Q8007. ' +
      'Available columns: ' + cols.join(', ') + '. ' +
      'Update fetchRenewalMasters() with the exact column names.'
    );
  }

  var fullReturns = rows.reduce(function(s, r) { return s + (Number(r[fullIdx]) || 0); }, 0);
  var partialReturns = rows.reduce(function(s, r) { return s + (Number(r[partialIdx]) || 0); }, 0);

  Logger.log('Q8007 → Full Returns (A) = ' + fullReturns + ', Partial Returns (B) = ' + partialReturns);
  return { fullReturns: fullReturns, partialReturns: partialReturns };
}

/**
 * Fetches the Renewals Figures question and returns
 * { asb, ufr, renewalRevenue, countOfRenewals }.
 *
 * The card ID is read from Script Property RENEWALS_QUESTION_ID.
 * @returns {{ asb: number, ufr: number, renewalRevenue: number, countOfRenewals: number }}
 */
function fetchRenewalsFigures() {
  var props = PropertiesService.getScriptProperties();
  var cardId = Number(props.getProperty('RENEWALS_QUESTION_ID') || CONFIG.QUESTION_RENEWALS_FIGURES);

  if (!cardId) {
    throw new Error(
      'Renewals Figures card ID not configured. ' +
      'Set RENEWALS_QUESTION_ID in Script Properties.'
    );
  }

  Logger.log('Fetching Renewals Figures (card ' + cardId + ')...');
  var result = runMetabaseCard_(cardId);
  var cols = getColumnNames_(result);
  var rows = getRows_(result);

  function findCol(hints) {
    var idx = cols.findIndex(function(c) {
      var cl = c.toLowerCase();
      return hints.every(function(h) { return cl.includes(h.toLowerCase()); });
    });
    return idx;
  }

  var asbIdx     = findCol(['asb']);
  var ufrIdx     = findCol(['ufr']);
  var revIdx     = findCol(['revenue']);
  var countIdx   = findCol(['count', 'renewal']);

  // Sum across all rows (the question may return one row per period segment)
  function sumCol(idx) {
    if (idx === -1) return null;
    return rows.reduce(function(s, r) { return s + (Number(r[idx]) || 0); }, 0);
  }

  var asb            = sumCol(asbIdx);
  var ufr            = sumCol(ufrIdx);
  var renewalRevenue = sumCol(revIdx);
  var countOfRenewals= sumCol(countIdx);

  // Warn about unmapped columns instead of hard-failing so partial data
  // can still be written to the sheet.
  if (asbIdx === -1)    Logger.log('WARNING: ASB column not found. Available: ' + cols.join(', '));
  if (ufrIdx === -1)    Logger.log('WARNING: UFR column not found.');
  if (revIdx === -1)    Logger.log('WARNING: Renewal Revenue column not found.');
  if (countIdx === -1)  Logger.log('WARNING: Count of Renewals column not found.');

  Logger.log(
    'Renewals Figures → ASB=' + asb + ', UFR=' + ufr +
    ', Revenue=' + renewalRevenue + ', Count=' + countOfRenewals
  );

  return {
    asb: asb,
    ufr: ufr,
    renewalRevenue: renewalRevenue,
    countOfRenewals: countOfRenewals,
  };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Returns "YYYY-MM-01" for the first day of the current month (IST). */
function getFirstOfCurrentMonth_() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  return y + '-' + m + '-01';
}
