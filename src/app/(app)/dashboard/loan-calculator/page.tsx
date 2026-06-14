import { getReference } from '@/lib/actions/reference'
import { LoanCalculator } from './loan-calculator'
import { EmiCalculatorIcon } from '@/components/icons/emi-calculator-icon'

export default async function LoanCalculatorPage() {
  // Reference-driven rate/limits so the calculator matches how loans are actually
  // generated. Defaults mirror the createLoan server action.
  const [interestRatePct, maxTermMonths, maxWaiverMonths, medicalWaiverDefault] = await Promise.all([
    getReference('loan_interest_rate_pct').catch(() => 8),
    getReference('loan_max_term_months').catch(() => 30),
    getReference('loan_max_waiver_months').catch(() => 6),
    getReference('loan_default_waiver_medical').catch(() => 6),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <EmiCalculatorIcon className="h-9 w-9 shrink-0" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Loan calculator</h1>
          <p className="mt-1 text-sm text-gray-500">
            Estimate the monthly EMI and full repayment schedule for a loan. Nothing is saved —
            this is just a planning tool.
          </p>
        </div>
      </div>
      <LoanCalculator
        interestRatePct={interestRatePct}
        maxTermMonths={maxTermMonths}
        maxWaiverMonths={maxWaiverMonths}
        medicalWaiverDefault={medicalWaiverDefault}
      />
    </div>
  )
}
