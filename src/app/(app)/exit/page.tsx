import { getCurrentMember, getExitEstimate } from '@/lib/actions/exits'
import { ExitProposalCard } from './exit-proposal-card'

export default async function ExitPage() {
  const member = await getCurrentMember()
  const estimate = member ? await getExitEstimate(member.id) : null

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Exit the Fund</h1>
        <p className="text-sm text-gray-500">
          Propose your exit and review your estimated settlement under the exit policy. An admin confirms the final figures.
        </p>
      </header>
      {member ? (
        <ExitProposalCard estimate={estimate} />
      ) : (
        <p className="text-sm text-gray-500">
          Exit requests are available to fund members. Your account isn&apos;t linked to an active member.
        </p>
      )}
    </div>
  )
}
