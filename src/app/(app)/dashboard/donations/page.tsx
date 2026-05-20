import { SectionView } from '@/components/section-view'

export default function DonationsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  return <SectionView section="donations" searchParams={searchParams} />
}
