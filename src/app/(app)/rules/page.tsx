export default function RulesOverviewPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Governing principles and resolutions of the AITS FCF (Friends
        Contribution Fund)
      </p>

      <div className="rounded-lg border bg-white p-6 space-y-4 text-sm text-gray-700 leading-relaxed">
        <p>
          The FCF is a mutual financial aid group formed by the AITSMCA 2006
          batch. Members contribute monthly and can avail loans from the
          collective corpus. The group also extends social/donations help for
          medical emergencies.
        </p>

        <h2 className="text-lg font-semibold text-gray-900">Key principles</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Monthly contributions from all members build the corpus</li>
          <li>
            Loans are available to members at nominal interest (6%–8% per
            annum)
          </li>
          <li>Social help is provided from a quarterly budget</li>
          <li>
            All resolutions are documented and versioned for transparency
          </li>
          <li>
            Accounts are reconciled periodically and published to all members
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-900">Versions</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>v1</strong> — Original resolutions from the Jul 2020
            meeting, establishing the core framework
          </li>
          <li>
            <strong>v2</strong> — Revised in 2023 with updated contribution
            amounts, loan interest rates, and corpus fund targets
          </li>
        </ul>
      </div>
    </div>
  )
}
