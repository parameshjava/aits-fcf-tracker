export default function V2RulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">
          Version 2 &middot; Revised 2023
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Updates agreed in the 2023 general meeting
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6 space-y-5 text-sm text-gray-700 leading-relaxed">
        <Section title="1. Fixed corpus fund">
          <p>
            Raise the fixed corpus fund to ₹5,00,000, with yearly 20%
            increments or adjusted based on inflation.
          </p>
        </Section>

        <Section title="2. Personal loans">
          <p>
            Personal loans are not feasible to offer until the principal
            reaches the fixed corpus, except for medical emergency loans which
            will continue to be available.
          </p>
        </Section>

        <Section title="3. Monthly contributions">
          <p>
            Increase monthly contributions from ₹500 to ₹600 per member, with
            an annual review to adjust for inflation, while considering
            everyone&apos;s financial circumstances.
          </p>
        </Section>

        <Section title="4. Loan interest rate">
          <p>
            Increase personal loan interest rate from 6% to 8% per annum. This
            ensures more professional and sustainable fund management. Note
            that those taking loans contribute to the fund, fostering shared
            responsibility and mutual support.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-4 rounded-md bg-gray-50 p-3 text-sm">
            <div>
              <p className="font-medium text-gray-700">Previous rate</p>
              <p className="text-gray-500">6% per annum</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">New rate</p>
              <p className="text-gray-500">8% per annum</p>
            </div>
          </div>
        </Section>

        <Section title="5. EMI calculation">
          <p>
            EMI for a ₹1,00,000 loan:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li><strong>Previous:</strong> ₹600 per month for ₹1,00,000</li>
            <li><strong>Revised:</strong> ₹650 per month for ₹1,00,000</li>
          </ul>
        </Section>

        <Section title="6. General rules (2023 meet)">
          <p className="mb-2">Additional guidelines established:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Corpus fund to be raised to a fixed target with annual
              increments
            </li>
            <li>
              Loan disbursement priority: medical emergencies first, then
              personal needs subject to corpus availability
            </li>
            <li>
              Quarterly financial statements to be shared with all members
            </li>
            <li>
              Two signatories required for any withdrawal above ₹50,000
            </li>
          </ul>
        </Section>
      </div>

      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
        <strong>Note:</strong> These resolutions supersede v1 where applicable.
        Any v1 resolutions not explicitly revised remain in effect.
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">{title}</h3>
      <div className="text-gray-600">{children}</div>
    </div>
  )
}
