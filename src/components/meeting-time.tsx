'use client'

import { useEffect, useState } from 'react'
import { formatInstant } from '@/lib/datetime'

type Props = {
  meetingAt: string
  meetingTz: string
}

/**
 * Renders a meeting's start time in the viewer's browser timezone, with the
 * originally-scheduled time + zone available on hover.
 *
 * Hydration: server and the first client render both format in `meetingTz`
 * (deterministic), so the markup matches. After mount we flip to the browser's
 * zone — the only differing factor, and it only changes post-hydration. This is
 * why `formatInstant` is called WITHOUT a tz only after `local` flips true.
 */
export function MeetingTime({ meetingAt, meetingTz }: Props) {
  const [local, setLocal] = useState(false)
  // One-shot post-hydration swap to the viewer's timezone. Server and first
  // client render use meetingTz (deterministic) to avoid a hydration mismatch;
  // this effect flips to the browser zone exactly once. This is React's
  // documented server/client-divergence pattern — the cascading-render warning
  // does not apply.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setLocal(true), [])

  const scheduled = formatInstant(meetingAt, meetingTz)
  const display = local ? formatInstant(meetingAt) : scheduled

  return (
    <time dateTime={meetingAt} title={`Scheduled: ${scheduled}`}>
      {display}
    </time>
  )
}
