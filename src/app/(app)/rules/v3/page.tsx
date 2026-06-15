export default function V3RulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Revised rules</h1>
        <p className="mt-1 text-xs font-medium text-blue-600 uppercase tracking-wide">
          Version 3 &middot; Current
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Consolidated operating rules of the FCF, superseding v1 and v2
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6 space-y-5 text-sm text-gray-700 leading-relaxed">
        <Section title="1. Member classification">
          <p>
            The earlier distinction between Refundable and Non-Refundable
            members is discontinued. All members are treated equally with
            respect to monthly contributions, benefits, loan eligibility,
            social support, and exit-related decisions.
          </p>
        </Section>

        <Section title="2. Monthly contributions">
          <p>The monthly contribution is ₹750 per member.</p>
          <p className="mt-2">
            Members are encouraged to enable auto-payment or standing
            instructions to avoid missed contributions. The contribution amount
            is reviewed annually and may be revised based on inflation, fund
            requirements, and members&apos; financial circumstances.
          </p>
        </Section>

        <Section title="3. Contribution discipline and pending contributions">
          <ul className="list-disc pl-5 space-y-1">
            <li>All members are expected to contribute regularly and on time.</li>
            <li>
              Members with missed or pending contributions shall regularize the
              pending amount within 6 months.
            </li>
            <li>
              The Treasurer or Committee shall identify members with pending
              contributions and communicate the required amount and timeline.
            </li>
            <li>
              Repeated delay or irregular contribution may be reviewed by the
              Committee and discussed with the concerned member.
            </li>
          </ul>
        </Section>

        <Section title="4. Fixed corpus fund">
          <p>
            FCF shall maintain a fixed corpus fund target of ₹5,00,000. The
            target may be increased annually by 20% or adjusted based on
            inflation, fund growth, and member approval. Members continue
            contributing until the corpus target and future revised targets are
            achieved.
          </p>
        </Section>

        <Section title="5. Loan eligibility">
          <p>
            Loans may be provided based on fund availability, repayment
            capacity, loan purpose, and Committee/member approval. The maximum
            loan eligibility per member is capped at ₹2,00,000.
          </p>
          <p className="mt-2">Priority order:</p>
          <ol className="list-decimal pl-5 space-y-1 mt-1">
            <li>Medical emergency loans</li>
            <li>Other urgent financial necessities</li>
            <li>Personal loans, subject to conditions and fund availability</li>
          </ol>
        </Section>

        <Section title="6. Medical emergency loans">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Available even if the principal fund has not reached the corpus
              target, and may be treated separately with flexible conditions.
            </li>
            <li>
              Immediate health assistance primarily applies to immediate family
              — parents, spouse, and children.
            </li>
            <li>
              Requests involving siblings, in-laws, or other family members may
              be considered under the Social Fund or as an exception, based on
              member agreement.
            </li>
          </ul>
        </Section>

        <Section title="7. Personal loans">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Treated as a last option after the member has explored other
              reasonable alternatives.
            </li>
            <li>
              Provided only when sufficient funds are available after protecting
              the medical emergency reserve and corpus requirements.
            </li>
            <li>
              Until the principal fund reaches the corpus target, personal loans
              may be restricted or avoided, except in special cases approved by
              the Committee/members.
            </li>
            <li>
              Repetitive personal loans may attract stricter review, shorter
              repayment timelines, or rejection.
            </li>
          </ul>
        </Section>

        <Section title="8. Loan repayment model">
          <p>
            All loans going forward operate on an EMI-based repayment model.
            Each monthly EMI covers principal plus interest at the fixed rate of
            8% per annum. Borrowers may choose the repayment tenure, subject to
            the maximum tenure (Section 9). Existing long-pending loans shall be
            reviewed and borrowers may be requested to start or complete
            repayment.
          </p>
        </Section>

        <Section title="9. Loan tenure">
          <p>
            The standard maximum loan tenure is 24 months. Exceptions such as 18
            or 30 months shall be approved separately based on loan type,
            borrower situation, and fund condition. Personal loans may prefer
            shorter periods; medical emergency loans may use flexible terms.
          </p>
        </Section>

        <Section title="10. Loan interest rate">
          <p>
            The loan interest rate is fixed at 8% per annum for all loans,
            applied within the EMI repayment model. Repetitive personal loans
            may attract stricter repayment conditions, but the rate remains 8%
            per annum.
          </p>
        </Section>

        <Section title="11. EMI calculation">
          <p>
            EMIs are calculated on the loan principal at 8% per annum over the
            chosen tenure. The exact monthly EMI depends on the principal and
            tenure and is confirmed at the time of disbursement.
          </p>
        </Section>

        <Section title="12. Loan disbursement priority">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Medical emergencies</li>
            <li>Critical financial necessities</li>
            <li>Personal needs, subject to corpus availability and approval</li>
          </ol>
          <p className="mt-2">
            Approval also considers existing outstanding loans, pending
            contributions, member discipline, and overall fund position.
          </p>
        </Section>

        <Section title="13. Social help budget">
          <p>
            Social help operates on a monthly budget basis. The monthly budget
            is 20% of the contributions collected in that month, with any unused
            amount carried forward to the following month. Requests should be
            flagged early, and usage is reviewed periodically based on actual
            spending and fund availability.
          </p>
        </Section>

        <Section title="14. Donations">
          <p>
            Donations are handled transparently. Where applicable, donations may
            be added to the common fund, distributed equally among members, or
            used for social causes, based on member approval.
          </p>
        </Section>

        <Section title="15. Member exit policy">
          <p>
            A member willing to exit shall formally express their decision to
            the Committee in writing. The exit settlement is computed as follows:
          </p>
          <ol className="list-decimal pl-5 space-y-2 mt-2">
            <li>
              <strong>Settle outstanding obligations first.</strong> Any
              outstanding loan principal and accrued interest must be repaid or
              netted in full — a member cannot exit while holding an open loan —
              and any pending or missed contributions must be regularized.
            </li>
            <li>
              <strong>Determine total eligible contributions.</strong> The sum
              of all monthly contributions made during membership.
            </li>
            <li>
              <strong>Deduct the equal share of shared costs.</strong> Total bad
              debts and total donations paid out to date are shared costs of the
              fund, divided equally across all members (1/N). The member&apos;s
              single equal share is deducted from their contributions.
            </li>
            <li>
              <strong>Member decides on the residual.</strong> The member may
              either offer the residual amount to FCF as a donation, or withdraw
              it.
            </li>
          </ol>
          <div className="mt-3 rounded-md bg-gray-50 p-3 font-mono text-xs text-gray-600">
            share of shared costs = (total bad debts + total donations) ÷ total members
            <br />
            residual amount = total eligible contributions − share of shared costs
          </div>
          <p className="mt-2">
            The figures used and the member&apos;s decision are documented and
            approved by the Committee/members.
          </p>
        </Section>

        <Section title="16. Contribution refunds">
          <p>
            Contribution refunds — on individual exit (Section 15) or at closure
            of FCF — follow the same basis: eligible contributions less the
            member&apos;s equal per-capita share of bad debts and donations, with
            outstanding loans and pending contributions settled first. The
            member may withdraw the residual or donate it to FCF / charity. The
            process is documented clearly.
          </p>
        </Section>

        <Section title="17. Bad debts and donations as shared costs">
          <p>
            Bad debts (unrecovered loans, written-off amounts) and donations
            paid out are treated as shared costs of the fund, borne equally by
            all members on a per-capita basis. At member exit or FCF closure,
            each member&apos;s equal share is deducted from their refundable
            amount, as set out in Section 15.
          </p>
        </Section>

        <Section title="18. Account management and withdrawals">
          <ul className="list-disc pl-5 space-y-1">
            <li>FCF shall move towards joint account management wherever feasible.</li>
            <li>
              Bookkeeping responsibilities may be rotated among trusted members
              for transparency and shared responsibility.
            </li>
            <li>Quarterly financial statements shall be shared with all members.</li>
            <li>
              Any withdrawal above ₹50,000 requires approval from at least two
              authorized signatories.
            </li>
            <li>
              Bank account credentials, access, and authorization rights are
              handled securely and responsibly.
            </li>
          </ul>
        </Section>

        <Section title="19. Financial reporting">
          <p>
            The Treasurer or assigned Committee member shares financial
            statements with all members quarterly, including:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Opening balance</li>
            <li>Monthly contributions received</li>
            <li>Pending contributions</li>
            <li>Loans disbursed</li>
            <li>Loan repayments received</li>
            <li>Interest received</li>
            <li>Social help or donations paid</li>
            <li>Expenses incurred</li>
            <li>Closing balance</li>
            <li>Outstanding loans</li>
          </ul>
        </Section>

        <Section title="20. Periodic review meetings">
          <p>
            FCF conducts quarterly or half-yearly catch-ups to review fund
            status, loan performance, pending contributions, social help,
            donations, and rule improvements. Rules may be amended based on
            member feedback, fund condition, and majority approval.
          </p>
        </Section>
      </div>

      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
        <strong>Note:</strong> These rules supersede v1 and v2 where applicable.
        Any earlier resolutions not explicitly revised remain in effect.
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
