// ─── Retention Dashboard Automation — Configuration ───────────────────────────
//
// ALL secrets (API key, alert email) live in Script Properties, never here.
// Set them once via: Extensions → Apps Script → Project Settings → Script Properties
//
//   Key                        | Example value
//   ─────────────────────────────────────────────────────────────────
//   METABASE_API_KEY           | mb_xxxxxxxxxxxxxxxxxxxx
//   METABASE_USERNAME          | user@furlenco.com   (fallback if no API key)
//   METABASE_PASSWORD          | ••••••••••••••••••• (fallback)
//   ALERT_EMAIL                | owner@furlenco.com
//   RENEWALS_QUESTION_ID       | 12345  (Metabase card ID for Renewals Figures)
//
// ─────────────────────────────────────────────────────────────────────────────

var CONFIG = {
  SPREADSHEET_ID: '12jlZo3-xxDhEHlAfHsF9Da00tSo-nA81TYd-enwDLD8',
  SHEET_NAME: 'Revive & Thrive - Metrics',

  METABASE_BASE_URL: 'https://metabase.furlenco.com',

  // Metabase saved question (card) IDs
  QUESTION_INTENT_TO_RETURN: 11162,   // Retention Efficiency MoM
  QUESTION_RENEWAL_MASTERS: 8007,     // Renewal Masters v4
  // Renewals Figures card ID — set via Script Property RENEWALS_QUESTION_ID
  // or override QUESTION_RENEWALS_FIGURES below after confirming the ID.
  QUESTION_RENEWALS_FIGURES: null,    // resolved at runtime from Script Properties

  // Column header row index (1-based) in the sheet.
  // The row that contains "Jan 2025", "Feb 2025", ... month labels.
  HEADER_ROW: 3,

  // The column that contains metric row labels (A = 1).
  LABEL_COL: 1,

  // Canonical row label strings — must match the text in column A of the sheet.
  // Adjust these if the exact wording differs.
  ROWS: {
    INTENT_TO_RETURN:   '(P) Intent to Return',
    FULL_RETURNS:       '(A) Full Returns',
    PARTIAL_RETURNS:    '(B) Partial Returns',
    PCT_FULL_RETURNS:   '% Full Returns (A/P)',
    PCT_PARTIAL_RETURNS:'% Partial Returns (B/P)',
    OVERALL_RETURN_PCT: 'Overall Return % (A+B/P)',
    ASB:                '(P) ASB',
    UFR:                'UFR',
    RENEWAL_REVENUE:    'Renewal Revenue',
    COUNT_OF_RENEWALS:  'Count of Renewals',
    ARPU:               'ARPU',
    BRPU:               'BRPU',
    RENEWED_NO_OFFER:   'Renewed Without Offer',
    RETAINED:           'Retained (Offer User & Renewed)',
    SWAPPED_NO_ACTION:  'Swapped / No Action Taken',
  },

  // Month short-names used in the column headers (case-insensitive match).
  MONTH_NAMES: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
};
