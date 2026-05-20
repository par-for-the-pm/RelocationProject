"""
Retention Dashboard Sync
Pulls metrics from Redshift → writes to Google Sheet daily.

Required environment variables (set as GitHub Secrets):
  REDSHIFT_HOST       almighty-evolve-gold.cu7ssmcznz75.ap-south-1.redshift.amazonaws.com
  REDSHIFT_PORT       5439
  REDSHIFT_DB         almighty-evolve
  REDSHIFT_USER       readonlyuser
  REDSHIFT_PASSWORD   <password>
  GOOGLE_SHEET_ID     12jlZo3-xxDhEHlAfHsF9Da00tSo-nA81TYd-enwDLD8
  GOOGLE_CREDENTIALS  <service account JSON, single line>
  ALERT_EMAIL         owner@furlenco.com  (optional)

Local dev: create a .env file with the above keys.
"""

import os
import json
import logging
import smtplib
import traceback
from datetime import date, datetime
from email.mime.text import MIMEText

import psycopg2
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

SHEET_ID   = os.environ["GOOGLE_SHEET_ID"]
SHEET_NAME = "Revive & Thrive - Metrics"
HEADER_ROW = 3    # 1-based row index containing "Jan 2025", "Feb 2025" …
LABEL_COL  = 0    # 0-based column index for metric row labels (column A)

MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun",
              "Jul","Aug","Sep","Oct","Nov","Dec"]

# Row labels — must match the exact text in column A of the sheet.
# Adjust these strings if the sheet wording differs.
ROW_LABELS = {
    "intent_to_return":    "(P) Intent to Return",
    "full_returns":        "(A) Full Returns",
    "partial_returns":     "(B) Partial Returns",
    "pct_full":            "% Full Returns (A/P)",
    "pct_partial":         "% Partial Returns (B/P)",
    "overall_return_pct":  "Overall Return % (A+B/P)",
    "asb":                 "(P) ASB",
    "ufr":                 "UFR",
    "renewal_revenue":     "Renewal Revenue",
    "count_renewals":      "Count of Renewals",
    "arpu":                "ARPU",
    "brpu":                "BRPU",
    "renewed_no_offer":    "Renewed Without Offer",
    "retained":            "Retained (Offer User & Renewed)",
    "swapped_no_action":   "Swapped / No Action Taken",
}

# ── Redshift connection ───────────────────────────────────────────────────────

def get_redshift_conn():
    return psycopg2.connect(
        host=os.environ["REDSHIFT_HOST"],
        port=int(os.environ.get("REDSHIFT_PORT", 5439)),
        dbname=os.environ["REDSHIFT_DB"],
        user=os.environ["REDSHIFT_USER"],
        password=os.environ["REDSHIFT_PASSWORD"],
        connect_timeout=30,
        sslmode="require",
    )

# ── SQL queries ───────────────────────────────────────────────────────────────
#
# TODO: Replace table/column names below with the actual names from your schema.
# Run `\dt *.*` in psql to list tables, or ask the data team.
# Each query must return a single numeric value for the current month.

def query_intent_to_return(cur, first_of_month: str) -> int:
    """(P) Count of Stay & Gift Created — source: retention_efficiency / Q11162 equivalent."""
    # TODO: replace table and column names
    cur.execute("""
        SELECT COUNT(*)
        FROM   <schema>.<orders_or_contracts_table>
        WHERE  order_type   IN ('stay', 'gift')
          AND  created_date >= %s
          AND  created_date <  DATEADD(month, 1, %s::date)
    """, (first_of_month, first_of_month))
    return cur.fetchone()[0] or 0


def query_full_returns(cur, first_of_month: str) -> int:
    """(A) Full Returns — source: Q8007 equivalent."""
    # TODO: replace table and column names
    cur.execute("""
        SELECT COUNT(*)
        FROM   <schema>.<returns_table>
        WHERE  return_type  = 'full'
          AND  start_date   >= %s
          AND  start_date   <  DATEADD(month, 1, %s::date)
    """, (first_of_month, first_of_month))
    return cur.fetchone()[0] or 0


def query_partial_returns(cur, first_of_month: str) -> int:
    """(B) Partial Returns — source: Q8007 equivalent."""
    # TODO: replace table and column names
    cur.execute("""
        SELECT COUNT(*)
        FROM   <schema>.<returns_table>
        WHERE  return_type  = 'partial'
          AND  start_date   >= %s
          AND  start_date   <  DATEADD(month, 1, %s::date)
    """, (first_of_month, first_of_month))
    return cur.fetchone()[0] or 0


def query_renewals_figures(cur, first_of_month: str) -> dict:
    """ASB, UFR, Renewal Revenue, Count of Renewals — source: Renewals Figures."""
    # TODO: replace table and column names.
    # ASB  = Active Subscriber Base (count of active subscribers at start of month)
    # UFR  = count of unique first-time renewers
    # This may need to be split into separate queries depending on your schema.
    cur.execute("""
        SELECT
            COUNT(DISTINCT subscriber_id)                        AS asb,
            COUNT(CASE WHEN is_first_renewal = 1 THEN 1 END)    AS ufr,
            SUM(renewal_amount)                                  AS renewal_revenue,
            COUNT(*)                                             AS count_renewals
        FROM   <schema>.<renewals_table>
        WHERE  renewal_date >= %s
          AND  renewal_date <  DATEADD(month, 1, %s::date)
    """, (first_of_month, first_of_month))
    row = cur.fetchone()
    return {
        "asb":             row[0] or 0,
        "ufr":             row[1] or 0,
        "renewal_revenue": float(row[2] or 0),
        "count_renewals":  row[3] or 0,
    }


def query_renewed_without_offer(cur, first_of_month: str) -> int:
    """Renewed Without Offer — confirm source before enabling."""
    # TODO: uncomment and implement once source confirmed
    raise NotImplementedError("Renewed Without Offer: source table TBD")


def query_retained(cur, first_of_month: str) -> int:
    """Retained (Offer User & Renewed) — confirm source before enabling."""
    raise NotImplementedError("Retained: source table TBD")


def query_swapped_no_action(cur, first_of_month: str) -> int:
    """Swapped / No Action Taken — confirm source before enabling."""
    raise NotImplementedError("Swapped / No Action: source table TBD")

# ── Fetch all metrics ─────────────────────────────────────────────────────────

def fetch_metrics(first_of_month: str) -> dict:
    log.info("Connecting to Redshift …")
    conn = get_redshift_conn()
    try:
        with conn.cursor() as cur:
            log.info("Fetching Intent to Return (P) …")
            P = query_intent_to_return(cur, first_of_month)

            log.info("Fetching Full Returns (A) …")
            A = query_full_returns(cur, first_of_month)

            log.info("Fetching Partial Returns (B) …")
            B = query_partial_returns(cur, first_of_month)

            log.info("Fetching Renewals Figures …")
            rf = query_renewals_figures(cur, first_of_month)
    finally:
        conn.close()

    # Calculated fields
    pct_full    = round(A / P, 4) if P else None
    pct_partial = round(B / P, 4) if P else None
    overall_pct = round((A + B) / P, 4) if P else None
    arpu        = round(rf["renewal_revenue"] / rf["count_renewals"], 2) if rf["count_renewals"] else None
    # BRPU formula TBD — set to None until definition confirmed
    brpu        = None

    metrics = {
        "intent_to_return":   P,
        "full_returns":       A,
        "partial_returns":    B,
        "pct_full":           pct_full,
        "pct_partial":        pct_partial,
        "overall_return_pct": overall_pct,
        "asb":                rf["asb"],
        "ufr":                rf["ufr"],
        "renewal_revenue":    rf["renewal_revenue"],
        "count_renewals":     rf["count_renewals"],
        "arpu":               arpu,
        "brpu":               brpu,
        # TBD metrics — uncomment once sources are confirmed:
        # "renewed_no_offer": ...,
        # "retained":         ...,
        # "swapped_no_action"...,
    }

    log.info("Metrics fetched: %s", metrics)
    return metrics

# ── Google Sheets helpers ─────────────────────────────────────────────────────

def get_sheets_service():
    creds_json = os.environ["GOOGLE_CREDENTIALS"]
    creds_info = json.loads(creds_json)
    creds = Credentials.from_service_account_info(
        creds_info,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def find_current_month_col(svc, today: date) -> int | None:
    """Returns 0-based column index of current month in header row, or None."""
    month_label = MONTH_ABBR[today.month - 1]  # e.g. "May"
    year        = str(today.year)               # e.g. "2026"

    result = svc.spreadsheets().values().get(
        spreadsheetId=SHEET_ID,
        range=f"'{SHEET_NAME}'!{HEADER_ROW}:{HEADER_ROW}",
    ).execute()

    headers = result.get("values", [[]])[0]
    for idx, cell in enumerate(headers):
        cell_str = str(cell).lower().strip()
        if month_label.lower() in cell_str and year in cell_str:
            log.info("Month column found: index %d ('%s')", idx, cell)
            return idx

    log.warning("Month column for '%s %s' not found in header row %d", month_label, year, HEADER_ROW)
    return None


def build_row_map(svc) -> dict[str, int]:
    """Returns {label_lower: 0-based row index} for all non-empty cells in column A."""
    result = svc.spreadsheets().values().get(
        spreadsheetId=SHEET_ID,
        range=f"'{SHEET_NAME}'!A:A",
    ).execute()

    rows = result.get("values", [])
    row_map = {}
    for i, row in enumerate(rows):
        if row:
            text = str(row[0]).strip()
            if text:
                row_map[text.lower()] = i   # 0-based
    return row_map


def find_row(row_map: dict, label: str) -> int | None:
    """Finds row index by exact then partial match against row_map keys."""
    lower = label.lower()
    if lower in row_map:
        return row_map[lower]
    # Partial match
    for key, idx in row_map.items():
        if lower in key or key in lower:
            log.info("Partial label match: '%s' → '%s' row %d", label, key, idx)
            return idx
    log.warning("Row label not found in sheet: '%s'", label)
    return None


def write_metrics_to_sheet(svc, metrics: dict, today: date):
    col_idx = find_current_month_col(svc, today)
    if col_idx is None:
        raise RuntimeError(
            f"Cannot write — column for {MONTH_ABBR[today.month-1]} {today.year} not found in sheet."
        )

    row_map = build_row_map(svc)
    updates = []   # list of (row_idx, col_idx, value)

    for key, value in metrics.items():
        if value is None:
            log.info("SKIP '%s' — value is None", key)
            continue
        label = ROW_LABELS.get(key)
        if not label:
            continue
        row_idx = find_row(row_map, label)
        if row_idx is not None:
            updates.append((row_idx, col_idx, value))

    if not updates:
        log.warning("No rows matched — nothing written. Check ROW_LABELS vs sheet column A.")
        return

    # Build batch update request
    def row_col_to_a1(r, c):
        col_letter = ""
        c += 1  # 1-based
        while c:
            c, rem = divmod(c - 1, 26)
            col_letter = chr(65 + rem) + col_letter
        return f"'{SHEET_NAME}'!{col_letter}{r + 1}"

    data = [
        {"range": row_col_to_a1(r, c), "values": [[v]]}
        for r, c, v in updates
    ]

    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=SHEET_ID,
        body={"valueInputOption": "USER_ENTERED", "data": data},
    ).execute()

    log.info("Written %d cells to sheet.", len(updates))
    for r, c, v in updates:
        log.info("  row=%d col=%d value=%s", r + 1, c + 1, v)

# ── Entry point ───────────────────────────────────────────────────────────────

def run():
    today          = date.today()
    first_of_month = today.replace(day=1).isoformat()   # "YYYY-MM-01"
    log.info("=== Retention Dashboard Sync — %s ===", today)

    metrics = fetch_metrics(first_of_month)

    log.info("Connecting to Google Sheets …")
    svc = get_sheets_service()
    write_metrics_to_sheet(svc, metrics, today)

    log.info("=== Sync complete ===")


def send_alert(error: Exception):
    recipient = os.environ.get("ALERT_EMAIL")
    if not recipient:
        return
    sender = os.environ.get("ALERT_SENDER_EMAIL", recipient)
    subject = f"[Retention Dashboard] Sync failed — {date.today().strftime('%b %Y')}"
    body = (
        f"The daily Retention Dashboard sync failed.\n\n"
        f"Time: {datetime.utcnow().isoformat()} UTC\n"
        f"Error: {error}\n\n"
        f"Traceback:\n{traceback.format_exc()}"
    )
    smtp_host = os.environ.get("SMTP_HOST")
    if not smtp_host:
        log.warning("No SMTP_HOST configured — cannot send alert email.")
        return
    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"]    = sender
        msg["To"]      = recipient
        with smtplib.SMTP(smtp_host, int(os.environ.get("SMTP_PORT", 587))) as s:
            s.starttls()
            s.login(os.environ.get("SMTP_USER", sender), os.environ["SMTP_PASSWORD"])
            s.send_message(msg)
        log.info("Alert email sent to %s", recipient)
    except Exception as mail_err:
        log.error("Failed to send alert: %s", mail_err)


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        log.error("Sync failed: %s", e)
        log.error(traceback.format_exc())
        send_alert(e)
        raise
