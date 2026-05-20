"""
Extract Excel data to JSON for seeding the FCF Tracker app.
Usage: python3 scripts/extract_data.py
Output: src/data/seed.json
"""
import json
import os
import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCEL = os.path.join(BASE, "FCF Latest one upto 6_07_2020..xlsx")
OUTPUT = os.path.join(BASE, "src", "data", "seed.json")

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

xls = pd.ExcelFile(EXCEL)

YEAR_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

# --- Contributions per member across years ---
df = pd.read_excel(EXCEL, sheet_name='Contributions', header=None)
members = []
for i in range(1, 24):
    row = df.iloc[i]
    name = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''
    if not name or name in ('Total',):
        continue
    if 'Bank Intrest' in name or 'Loans Interest' in name:
        continue
    members.append({
        'name': name.replace('.', '').replace('  ', ' ').strip(),
        'total': float(row.iloc[1]) if pd.notna(row.iloc[1]) and row.iloc[1] != '' else 0,
        'years': {
            str(year): float(row.iloc[idx]) if pd.notna(row.iloc[idx]) and row.iloc[idx] != '' else 0
            for idx, year in enumerate([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026], start=2)
        }
    })

# --- Monthly data per year ---
yearly_data = {}
year_sheet_config = {
    2016: {'start_col': 1, 'month_offset': 6},  # Starts July (index 6)
    2017: {'start_col': 1, 'month_offset': 0},
    2018: {'start_col': 1, 'month_offset': 0},
    2019: {'start_col': 1, 'month_offset': 0},
    2020: {'start_col': 1, 'month_offset': 0},
    2021: {'start_col': 1, 'month_offset': 0},
    2022: {'start_col': 1, 'month_offset': 0},
    2023: {'start_col': 1, 'month_offset': 0},
    2024: {'start_col': 1, 'month_offset': 0},
    2025: {'start_col': 1, 'month_offset': 0},
    2026: {'start_col': 1, 'month_offset': 0},
}

for year in sorted(year_sheet_config.keys()):
    try:
        df_y = pd.read_excel(EXCEL, sheet_name=str(year), header=None)
    except ValueError:
        continue

    config = year_sheet_config[year]
    num_cols = df_y.shape[1]
    # max monthly columns: num_cols - config['start_col'], but at most 12
    max_months = min(num_cols - config['start_col'], 12)
    # Determine the actual month labels
    header_row = df_y.iloc[0]
    month_labels = []
    for j in range(max_months):
        col_idx = config['start_col'] + j
        if pd.notna(header_row.iloc[col_idx]):
            label = str(header_row.iloc[col_idx]).strip().lower()[:3]
            month_labels.append(label if label in [m[:3] for m in YEAR_MONTHS] else f"col{j+1}")
        else:
            month_labels.append(f"col{j+1}")

    year_key = str(year)
    year_monthly = {'members': {}, 'totals': []}

    for i in range(1, min(26, df_y.shape[0])):
        row = df_y.iloc[i]
        name = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ''
        if not name:
            continue

        clean = name.replace('.', '').replace('  ', ' ').strip()

        if 'Total' == clean and i > 20:
            year_monthly['totals'] = [
                float(row.iloc[config['start_col'] + j]) if pd.notna(row.iloc[config['start_col'] + j]) else 0
                for j in range(max_months)
            ]
            continue
        # Two distinct rows: split them so we don't overwrite one with the other.
        if 'Bank Intrest' in clean or 'Bank Interest' in clean:
            year_monthly['bank_interest'] = [
                float(row.iloc[config['start_col'] + j]) if pd.notna(row.iloc[config['start_col'] + j]) else 0
                for j in range(max_months)
            ]
            continue
        if 'Loans Intrest' in clean or 'Loans Interest' in clean or 'Loan Intrest' in clean or 'Loan Interest' in clean:
            year_monthly['loan_interest'] = [
                float(row.iloc[config['start_col'] + j]) if pd.notna(row.iloc[config['start_col'] + j]) else 0
                for j in range(max_months)
            ]
            continue

        monthly_vals = [
            float(row.iloc[config['start_col'] + j]) if config['start_col'] + j < num_cols and pd.notna(row.iloc[config['start_col'] + j]) else 0
            for j in range(max_months)
        ]
        year_monthly['members'][clean] = monthly_vals

    yearly_data[year_key] = year_monthly

# --- Loans ---
df_loans = pd.read_excel(EXCEL, sheet_name='Loans', header=None)
loans = []
for i in range(1, 12):
    row = df_loans.iloc[i]
    if pd.isna(row.iloc[0]) or pd.isna(row.iloc[2]):
        continue
    loans.append({
        'sno': int(row.iloc[0]),
        'name': str(row.iloc[1]).strip(),
        'amount': float(row.iloc[2]),
        'type': str(row.iloc[3]).strip() if pd.notna(row.iloc[3]) else '',
        'start_date': str(row.iloc[4]).split(' ')[0] if pd.notna(row.iloc[4]) else '',
        'end_date': str(row.iloc[5]).split(' ')[0] if pd.notna(row.iloc[5]) else '',
        'status': str(row.iloc[7]).strip() if pd.notna(row.iloc[7]) else '',
        'interest_payable': float(row.iloc[8]) if pd.notna(row.iloc[8]) else 0,
        'interest_paid': float(row.iloc[9]) if pd.notna(row.iloc[9]) else 0,
        'balance': float(row.iloc[12]) if pd.notna(row.iloc[12]) else 0,
        'bad_debt': float(row.iloc[13]) if pd.notna(row.iloc[13]) else 0,
        'remarks': str(row.iloc[14]).strip() if pd.notna(row.iloc[14]) else '',
    })

# --- Donations ---
df_don = pd.read_excel(EXCEL, sheet_name='Donations', header=None)
donations = []
for i in range(1, 8):
    row = df_don.iloc[i]
    if pd.isna(row.iloc[0]):
        continue
    donations.append({
        'sno': int(row.iloc[0]),
        'victim': str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else '',
        'referred_by': str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else '',
        'date': str(row.iloc[3]).split(' ')[0] if pd.notna(row.iloc[3]) else '',
        'amount': float(row.iloc[4]),
        'remarks': str(row.iloc[5]).strip() if pd.notna(row.iloc[5]) else '',
    })

# --- Summary ---
df_sum = pd.read_excel(EXCEL, sheet_name='Summary', header=None)
summary = {
    'total_contributions': float(df_sum.iloc[1, 1]) if pd.notna(df_sum.iloc[1, 1]) else 0,
    'interest_earned': float(df_sum.iloc[2, 1]) if pd.notna(df_sum.iloc[2, 1]) else 0,
    'current_loan_value': float(df_sum.iloc[1, 4]) if pd.notna(df_sum.iloc[1, 4]) else 0,
    'bad_debts': float(df_sum.iloc[2, 4]) if pd.notna(df_sum.iloc[2, 4]) else 0,
    'donated_so_far': float(df_sum.iloc[1, 7]) if pd.notna(df_sum.iloc[1, 7]) else 0,
    'current_balance': float(df_sum.iloc[9, 1]) if pd.notna(df_sum.iloc[9, 1]) else 0,
}

data = {
    'summary': summary,
    'members': members,
    'yearly': yearly_data,
    'loans': loans,
    'donations': donations,
}

with open(OUTPUT, 'w') as f:
    json.dump(data, f, indent=2, default=str)

print(f"Seed data written to {OUTPUT}")
print(f"  Members: {len(members)}")
print(f"  Years: {sorted(yearly_data.keys())}")
print(f"  Loans: {len(loans)}")
print(f"  Donations: {len(donations)}")
print(f"  Summary: {json.dumps(summary, indent=2)}")
