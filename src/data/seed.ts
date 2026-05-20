import seedRaw from './seed.json'

export interface SeedSummary {
  total_contributions: number
  interest_earned: number
  current_loan_value: number
  bad_debts: number
  donated_so_far: number
  current_balance: number
}

export interface MemberContributions {
  name: string
  total: number
  years: Record<string, number>
}

export interface LoanRecord {
  sno: number
  name: string
  amount: number
  type: string
  start_date: string
  end_date: string
  status: string
  interest_payable: number
  interest_paid: number
  balance: number
  bad_debt: number
  remarks: string
}

export interface DonationRecord {
  sno: number
  victim: string
  referred_by: string
  date: string
  amount: number
  remarks: string
}

export interface YearlyMemberData {
  members: Record<string, number[]>
  totals: number[]
  bank_interest?: number[]
  loan_interest?: number[]
}

export interface SeedData {
  summary: SeedSummary
  members: MemberContributions[]
  yearly: Record<string, YearlyMemberData>
  loans: LoanRecord[]
  donations: DonationRecord[]
}

const seedData = seedRaw as SeedData
export default seedData
