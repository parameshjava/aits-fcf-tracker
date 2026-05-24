"""
Generate one SQL insert script per year sheet from the FCF Excel.

Reads:  FCF Latest one upto 6_07_2020.xlsx  (sheets named 2016 .. 2026)
Writes: scripts/prod/transactions/{year}.sql  (one file per year)

Each yearly file emits, inside a single BEGIN/COMMIT:
  - monthly member contributions  (transaction_id = SEED-{YYYY}-{MM}-{slug})
  - monthly bank interest          (interest_source='bank',  member_id=null)
  - monthly loan interest          (interest_source='loans', member_id=null)

member_id is resolved at INSERT time via:
    (select id from public.members where email = '...')

Email lookup (not slug) so the script survives DB drop+recreate even if
slugs are later renamed.  Aborts with a clear error if the Excel contains
a member name that doesn't appear in the canonical alias map.

Usage:
    python3 scripts/generate-yearly-transactions.py
"""

import os
import re
import sys

import pandas as pd


BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCEL = os.path.join(BASE, "FCF Latest one upto 6_07_2020.xlsx")
OUT_DIR = os.path.join(BASE, "scripts", "prod", "transactions")
os.makedirs(OUT_DIR, exist_ok=True)


# -----------------------------------------------------------------------------
# Canonical member roster — sourced from scripts/prod/03-seed-members.sql
# and scripts/dedupe-members.sql (which captures every Excel-name alias that
# was merged into the canonical row).
#
# Tuple shape: (canonical_slug, email, short_code, [normalized aliases as they
# appear in the Excel sheets]). Aliases are matched case- and
# punctuation-insensitively (see normalize() below).
#
# short_code is a 3-letter unique tag baked into transaction_id so the IDs
# stay grep-able without the full slug.  Codes must be unique across the
# roster (validated below).
# -----------------------------------------------------------------------------
CANONICAL_MEMBERS = [
    ("kothacheruvu-anil-kumar-reddy",       "anil.kothacheruvu@gmail.com",  "ANL", ["kothacheruvu anil kumar reddy", "anil", "kanil kumar reddy"]),
    ("chittiboyina-ramanjaneyulu",          "anjimca48@gmail.com",          "RAM", ["chittiboyina ramanjaneyulu", "c ramanjaneyulu", "chramanjineyulu"]),
    ("chintalapalli-srinith",               "srimca67@gmail.com",           "SNT", ["chintalapalli srinith", "srinith ch", "chsrinath"]),
    ("rallabandi-venkata-narasimha-charlu", "venkat.0082@gmail.com",        "CHL", ["rallabandi venkata narasimha charlu", "narasimha chari", "narasimha cari"]),
    ("bhagavan-das",                        "bagavandas.g@gmail.com",       "DAS", ["bhagavan das", "das"]),
    ("jetty-harikrishna-krishna",           "hkjetti@gmail.com",            "HKR", ["jetty harikrishna krishna", "harikrishna jetty", "jharikrishna"]),
    ("darisiguntla-lakshmi-narayana",       "dlnarayana.mca29@gmail.com",   "DLN", ["darisiguntla lakshmi narayana", "d lakshmi narayana", "dlakshmi narayana"]),
    ("chindukuri-mallikarjuna",             "malli.chindukuri@gmail.com",   "MAL", ["chindukuri mallikarjuna", "malli", "cmallikarjuna"]),
    # Per dedupe-members.sql, "Malli Sunil Kumar" (the row label used in every
    # yearly sheet) is Suneel Kumar — slug `malli-sunil-kumar`, email mallisunilmca69.
    ("malli-sunil-kumar",                   "mallisunilmca69@gmail.com",    "SNL", ["malli sunil kumar", "malli suneel", "suneel kumar"]),
    ("korrakuti-paramesh",                  "paramesh.java5@gmail.com",     "PAR", ["korrakuti paramesh", "paramesh"]),
    ("ponugoti-prasad",                     "prasadnaidu271985@gmail.com",  "PRS", ["ponugoti prasad", "p prasad", "pprasad"]),
    ("bollam-samba-siva-reddy",             "sambamca06@gmail.com",         "SAM", ["bollam samba siva reddy", "samba"]),
    ("biddala-sandeep-kumar-reddy",         "sandeep.mca56@gmail.com",      "SDP", ["biddala sandeep kumar reddy", "sandeep"]),
    ("gopathi-sheshagiri",                  "sheshagiri.gopathi@gmail.com", "SHG", ["gopathi sheshagiri", "sheshagiri"]),
    # "Duggireddy Sreenadh Reddy" is a typo for Srinath in the 2017 sheet.
    ("duggireddy-srinath-reddy",            "sreemca65@gmail.com",          "SRR", ["duggireddy srinath reddy", "duggireddy sreenadh reddy", "srinath reddy"]),
    ("meda-sunil-kumar-reddy",              "sunilreddy.meda@gmail.com",    "MED", ["meda sunil kumar reddy", "meda sunil kumar", "sunil kumar reddy"]),
    ("kollai-venkateswarlu",                "venky.kollai@gmail.com",       "VEN", ["kollai venkateswarlu", "venkateswarlu"]),
    ("oleti-viswanath",                     "viswanath.mca0688@gmail.com",  "VSW", ["oleti viswanath", "o viswanath", "oviswanath"]),
    ("thummalapalli-guru-prasanna-lakshmi", "lakshmi.talk6@gmail.com",      "LXM", ["thummalapalli guru prasanna lakshmi", "lakshmi gpr"]),
    ("prakash-policherla",                  "prakash.mca42@gmail.com",      "PRK", ["prakash policherla", "prakash"]),
    ("panditi-trinath-gupta",               "trinathgupta.p@gmail.com",     "TRN", ["panditi trinath gupta", "trinath"]),
    ("koppavarapu-sudhakar",                "sudhakar487248@gmail.com",     "SUD", ["koppavarapu sudhakar", "sudhakar"]),
]

# Row labels that aren't canonical members. Rows for these are silently skipped.
#   - "ranga reddy" — donation-only recipient, removed in dedupe-members.sql.
#   - "summary"     — stray header row in the 2026 sheet.
SKIP_ALIASES = {
    "ranga reddy",
    "summary",
}


def normalize(name: str) -> str:
    """Lower-case, collapse non-alphanumerics to single spaces, strip."""
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


# Validate the short codes are unique.
_seen_codes: dict[str, str] = {}
for _slug, _email, _code, _aliases in CANONICAL_MEMBERS:
    if not _code.isupper() or len(_code) != 3:
        raise SystemExit(f"Member code {_code!r} must be 3 uppercase letters.")
    if _code in _seen_codes:
        raise SystemExit(f"Duplicate member code {_code!r} on {_slug} and {_seen_codes[_code]}.")
    _seen_codes[_code] = _slug

# Build the alias → (canonical_slug, email, code) lookup.
ALIAS_LOOKUP: dict[str, tuple[str, str, str]] = {}
for slug, email, code, aliases in CANONICAL_MEMBERS:
    for alias in aliases:
        key = normalize(alias)
        if key in ALIAS_LOOKUP and ALIAS_LOOKUP[key] != (slug, email, code):
            raise SystemExit(f"Duplicate alias '{alias}' maps to two members.")
        ALIAS_LOOKUP[key] = (slug, email, code)


def resolve_member(raw_name: str) -> tuple[str, str, str] | None:
    """Return (canonical_slug, email, short_code) or None if this name should be skipped."""
    norm = normalize(raw_name)
    if norm in SKIP_ALIASES:
        return None
    if norm not in ALIAS_LOOKUP:
        raise SystemExit(
            f"Unknown member name in Excel: {raw_name!r} (normalized: {norm!r}).\n"
            f"Add it to CANONICAL_MEMBERS aliases or SKIP_ALIASES in this script."
        )
    return ALIAS_LOOKUP[norm]


# -----------------------------------------------------------------------------
# Per-year sheet layout.  Mirrors scripts/extract_data.py.
#   start_col    — column index where the first month's value lives
#   month_offset — month index (0-based) the first column represents.
#                  2016 starts in July, so offset = 6.
# -----------------------------------------------------------------------------
YEAR_CONFIG = {
    2016: {"start_col": 1, "month_offset": 6},
    2017: {"start_col": 1, "month_offset": 0},
    2018: {"start_col": 1, "month_offset": 0},
    2019: {"start_col": 1, "month_offset": 0},
    2020: {"start_col": 1, "month_offset": 0},
    2021: {"start_col": 1, "month_offset": 0},
    2022: {"start_col": 1, "month_offset": 0},
    2023: {"start_col": 1, "month_offset": 0},
    2024: {"start_col": 1, "month_offset": 0},
    2025: {"start_col": 1, "month_offset": 0},
    2026: {"start_col": 1, "month_offset": 0},
}


def sql_text(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def parse_year(year: int, config: dict, df: pd.DataFrame):
    """Return (contributions, bank_interest, loan_interest) for one year sheet.

    contributions  — list of (email, short_code, display_name, month_1based, amount)
    bank_interest  — list of (month_1based, amount)
    loan_interest  — list of (month_1based, amount)
    """
    del year  # only used for caller-side logging
    start_col = config["start_col"]
    month_offset = config.get("month_offset", 0)
    num_cols = df.shape[1]
    max_months = min(num_cols - start_col, 12 - month_offset)

    contributions: list[tuple[str, str, str, int, float]] = []
    bank_interest: list[tuple[int, float]] = []
    loan_interest: list[tuple[int, float]] = []

    for i in range(1, min(26, df.shape[0])):
        row = df.iloc[i]
        if pd.isna(row.iloc[0]):
            continue
        raw = str(row.iloc[0]).strip()
        if not raw:
            continue
        clean = raw.replace("  ", " ").strip()
        norm = normalize(clean)

        # Total row — skip (we re-derive totals from the inserts).
        if norm == "total":
            continue

        # Bank interest row.
        if "bank intrest" in norm or "bank interest" in norm:
            for j in range(max_months):
                cell = row.iloc[start_col + j]
                amt = float(cell) if pd.notna(cell) and cell != "" else 0.0
                if amt > 0:
                    bank_interest.append((month_offset + j + 1, amt))
            continue

        # Loan interest row.
        if (
            "loan intrest" in norm
            or "loan interest" in norm
            or "loans intrest" in norm
            or "loans interest" in norm
        ):
            for j in range(max_months):
                cell = row.iloc[start_col + j]
                amt = float(cell) if pd.notna(cell) and cell != "" else 0.0
                if amt > 0:
                    loan_interest.append((month_offset + j + 1, amt))
            continue

        # Member contribution row.
        resolved = resolve_member(clean)
        if resolved is None:
            continue
        _slug, email, code = resolved

        for j in range(max_months):
            cell = row.iloc[start_col + j]
            amt = float(cell) if pd.notna(cell) and cell != "" else 0.0
            if amt > 0:
                month = month_offset + j + 1
                contributions.append((email, code, clean, month, amt))

    return contributions, bank_interest, loan_interest


def render_sql(
    year: int,
    contributions: list,
    bank_interest: list,
    loan_interest: list,
) -> str:
    total = len(contributions) + len(bank_interest) + len(loan_interest)
    contribution_sum = sum(amt for *_, amt in contributions)
    bank_sum = sum(amt for _, amt in bank_interest)
    loan_sum = sum(amt for _, amt in loan_interest)

    lines: list[str] = []
    lines.append("-- =============================================================================")
    lines.append(f"-- FCF Tracker — {year} transactions seed")
    lines.append(f"-- Source: '{year}' sheet of FCF Latest one upto 6_07_2020.xlsx")
    lines.append("--")
    lines.append("-- Generated by scripts/generate-yearly-transactions.py — do not hand-edit.")
    lines.append("-- Re-running is safe: every INSERT uses ON CONFLICT (transaction_id) DO NOTHING.")
    lines.append("--")
    lines.append(f"-- Rows: {total}  ({len(contributions)} contributions + "
                 f"{len(bank_interest)} bank-int + {len(loan_interest)} loan-int)")
    lines.append(f"-- Totals: contributions=₹{contribution_sum:,.2f}  "
                 f"bank_interest=₹{bank_sum:,.2f}  loan_interest=₹{loan_sum:,.2f}")
    lines.append("--")
    lines.append("-- member_id is resolved at INSERT time via the canonical email so this")
    lines.append("-- works even after a clean DB rebuild (UUIDs change; emails don't).")
    lines.append("-- =============================================================================")
    lines.append("")
    lines.append("begin;")
    lines.append("")

    if contributions:
        lines.append(f"-- 1) Member contributions ({len(contributions)} rows)")
        lines.append("insert into public.transactions")
        lines.append("  (transaction_id, amount, contribution_type, interest_source, member_id, transaction_date, description) values")
        rows = []
        for email, code, display, month, amount in contributions:
            tid = f"SEED-{year}-{month:02d}-{code}"
            date = f"{year}-{month:02d}-15"
            mem_expr = f"(select id from public.members where email = {sql_text(email)})"
            rows.append(
                f"  ({sql_text(tid)}, {amount:.2f}, 'contribution', null, "
                f"{mem_expr}, {sql_text(date)}, {sql_text(display)})"
            )
        lines.append(",\n".join(rows) + "\non conflict (transaction_id) do nothing;")
        lines.append("")

    if bank_interest:
        lines.append(f"-- 2) Bank interest ({len(bank_interest)} rows)")
        lines.append("insert into public.transactions")
        lines.append("  (transaction_id, amount, contribution_type, interest_source, member_id, transaction_date, description) values")
        rows = []
        for month, amount in bank_interest:
            tid = f"SEED-BANK-{year}-{month:02d}"
            date = f"{year}-{month:02d}-28"
            rows.append(
                f"  ({sql_text(tid)}, {amount:.2f}, 'interest', 'bank', null, "
                f"{sql_text(date)}, 'Bank interest credited')"
            )
        lines.append(",\n".join(rows) + "\non conflict (transaction_id) do nothing;")
        lines.append("")

    if loan_interest:
        lines.append(f"-- 3) Loan interest ({len(loan_interest)} rows)")
        lines.append("insert into public.transactions")
        lines.append("  (transaction_id, amount, contribution_type, interest_source, member_id, transaction_date, description) values")
        rows = []
        for month, amount in loan_interest:
            tid = f"SEED-LOAN-{year}-{month:02d}"
            date = f"{year}-{month:02d}-28"
            rows.append(
                f"  ({sql_text(tid)}, {amount:.2f}, 'interest', 'loans', null, "
                f"{sql_text(date)}, 'Loan interest collected')"
            )
        lines.append(",\n".join(rows) + "\non conflict (transaction_id) do nothing;")
        lines.append("")

    lines.append("commit;")
    lines.append("")
    lines.append("-- Sanity check (uncomment to run after insert):")
    lines.append("-- select contribution_type, interest_source, count(*), sum(amount)")
    lines.append("--   from public.transactions")
    lines.append(f"--  where transaction_date >= '{year}-01-01' and transaction_date < '{year + 1}-01-01'")
    lines.append("--  group by 1, 2 order by 1, 2;")
    lines.append("")
    return "\n".join(lines)


def main():
    if not os.path.exists(EXCEL):
        sys.exit(f"Excel not found: {EXCEL}")
    xls = pd.ExcelFile(EXCEL)
    available_sheets = set(xls.sheet_names)

    summary_rows = []
    for year, config in sorted(YEAR_CONFIG.items()):
        sheet = str(year)
        if sheet not in available_sheets:
            print(f"  {year}: sheet missing — skipped")
            continue

        df = pd.read_excel(EXCEL, sheet_name=sheet, header=None)
        contributions, bank_interest, loan_interest = parse_year(year, config, df)

        sql = render_sql(year, contributions, bank_interest, loan_interest)
        out_path = os.path.join(OUT_DIR, f"{year}.sql")
        with open(out_path, "w") as f:
            f.write(sql)

        contribution_sum = sum(amt for *_, amt in contributions)
        bank_sum = sum(amt for _, amt in bank_interest)
        loan_sum = sum(amt for _, amt in loan_interest)
        summary_rows.append((year, len(contributions), len(bank_interest), len(loan_interest),
                             contribution_sum, bank_sum, loan_sum))
        print(f"  {year}: {len(contributions)} contrib + {len(bank_interest)} bank-int + "
              f"{len(loan_interest)} loan-int  →  {os.path.relpath(out_path, BASE)}")

    print()
    print(f"{'Year':<6}{'Contrib':>9}{'BankInt':>9}{'LoanInt':>9}"
          f"{'ContribSum':>14}{'BankSum':>12}{'LoanSum':>12}")
    for row in summary_rows:
        y, c, b, l, cs, bs, ls = row
        print(f"{y:<6}{c:>9}{b:>9}{l:>9}{cs:>14,.0f}{bs:>12,.0f}{ls:>12,.0f}")


if __name__ == "__main__":
    main()
