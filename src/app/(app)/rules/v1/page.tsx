export default function V1RulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Original resolutions</h1>
        <p className="mt-1 text-xs font-medium text-blue-600 uppercase tracking-wide">
          Version 1 &middot; July 2020
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Adopted in the 27 July 2020 Zoom meeting
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6 space-y-5 text-sm text-gray-700 leading-relaxed">
        <Section title="1. Member classification">
          <p>
            The distinction between Refundable and Non-Refundable members is
            discontinued. All members are treated equally with respect to
            contributions and benefits.
          </p>
        </Section>

        <Section title="2. Contribution refunds">
          <p>
            Members may decide whether they want their contributions back or
            donate to charity at the time of leaving or closure of FCF.
          </p>
        </Section>

        <Section title="3. Bad debts &amp; expenses">
          <p>
            Contribution refunds will be reduced by any member&apos;s share
            towards bad debts, expenses, and social contributions incurred
            during their membership.
          </p>
        </Section>

        <Section title="4. Trust registration">
          <p>
            The group will explore registering as a trust if feasible. Malli C
            will look into the details and call for help from members if
            needed.
          </p>
        </Section>

        <Section title="5. Health assistance">
          <p>
            Immediate health assistance is confined to immediate family members
            (parents, spouse, and children). Members are encouraged to reach
            out for help for siblings or in-laws if needed, using the Social
            Fund. Exceptions may be considered with member agreement.
          </p>
        </Section>

        <Section title="6. Loan eligibility">
          <p>
            Members are encouraged to seek loans for financial necessities.
            Approval depends on available financial reserves at the time of
            request.
          </p>
        </Section>

        <Section title="7. Social help budget">
          <p>
            Social help will continue on a quarterly budget basis of ₹25,000.
            Requests should be flagged early to allow response time. Based on
            past history (less than ₹35K per annum), a revised budget of ₹10K
            per quarter was agreed, with carry-forward of unused amounts.
          </p>
        </Section>

        <Section title="8. Account management">
          <p>
            The group will move to a joint account and share credentials on a
            rotation basis to distribute financial bookkeeping
            responsibilities.
          </p>
        </Section>

        <Section title="9. Continued contributions">
          <p>
            Members will continue to contribute to FCF. A corpus fund value
            will be determined with all-member acceptance in future meetings.
          </p>
        </Section>

        <Section title="10. Periodic catch-ups">
          <p>
            Quarterly or half-yearly catch-ups will be held to review status
            and consider improvements to existing resolutions.
          </p>
        </Section>
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
