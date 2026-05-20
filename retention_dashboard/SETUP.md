# Retention Dashboard — Setup Guide

## Option A: Copy-paste into Apps Script editor (quickest)

1. Open [Google Apps Script](https://script.google.com) → **New project**
2. Name it **Retention Dashboard Automation**
3. Delete the default `Code.gs` content
4. Create these files (use the **+** button next to **Files**):

| File name | Source file in this repo |
|---|---|
| `Code.gs` | `retention_dashboard/Code.gs` |
| `Config.gs` | `retention_dashboard/Config.gs` |
| `Metabase.gs` | `retention_dashboard/Metabase.gs` |
| `SheetUtils.gs` | `retention_dashboard/SheetUtils.gs` |

5. Replace `appsscript.json` with the contents of `retention_dashboard/appsscript.json`
   (enable **View → Show appsscript.json manifest file** first)

---

## Option B: Deploy via clasp (recommended for version control)

```bash
npm install -g @google/clasp
clasp login
cp retention_dashboard/.clasp.json.template retention_dashboard/.clasp.json
# Edit .clasp.json: replace <APPS_SCRIPT_PROJECT_ID> with your script ID
cd retention_dashboard
clasp push
```

---

## One-time configuration (run in the editor)

### Step 1 — Set Script Properties

Go to **Project Settings → Script Properties** and add:

| Key | Value | Required? |
|---|---|---|
| `METABASE_API_KEY` | `mb_xxxx...` (preferred) | Either this… |
| `METABASE_USERNAME` | `you@furlenco.com` | …or these two |
| `METABASE_PASSWORD` | your Metabase password | …or these two |
| `RENEWALS_QUESTION_ID` | numeric card ID for "Renewals Figures" | **Required** |
| `ALERT_EMAIL` | `owner@furlenco.com` | Recommended |

Or run `configureProperties()` from the editor for an interactive wizard.

### Step 2 — Create the daily trigger

Run `setupTrigger()` from the editor once.  
This registers a trigger: **every day at 11:00–12:00 AM IST**.

### Step 3 — Smoke test

Run `runNow()` and check **Execution log** for any errors.

---

## Pending items before full operation

| # | Item | Who |
|---|---|---|
| 1 | Confirm Metabase API key or supply username/password | Infra/Data team |
| 2 | Provide card ID for "Renewals Figures" question | Data team |
| 3 | Confirm exact column names in Q8007 for Full/Partial Returns | Data team |
| 4 | Confirm BRPU formula | Business owner |
| 5 | Confirm source for "Renewed Without Offer", "Retained", "Swapped / No Action" | Business owner |
| 6 | Verify exact row label text in the sheet matches `Config.gs → ROWS` | Anyone with sheet access |

---

## Adjusting row labels

If the script logs `WARNING: Row label not found`, the text in `Config.gs → ROWS`
doesn't match what's in column A of the sheet.  Open the sheet, copy the exact
cell text (including punctuation/special chars), and update the matching entry in
`CONFIG.ROWS`.

## Adjusting the header row

If month columns are not in row 3, update `CONFIG.HEADER_ROW` in `Config.gs`.
