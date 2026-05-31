'use client'

import { useEffect, useState } from 'react'
import { formatInstantRange } from '@/lib/datetime'

type Props = {
  meetingAt: string
  meetingEndsAt: string
  meetingTz: string
}

/**
 * Renders a meeting's start–end range in the viewer's browser timezone, with
 * the originally-scheduled range (in the meeting's own zone) available on hover.
 *
 * Hydration: server and the first client render both format in `meetingTz`
 * (deterministic), so the markup matches. After mount we flip to the browser's
 * zone — the only differing factor, and it only changes post-hydration.
 */
export function MeetingTime({ meetingAt, meetingEndsAt, meetingTz }: Props) {
  const [local, setLocal] = useState(false)
  // One-shot post-hydration swap to the viewer's timezone. Server and first
  // client render use meetingTz (deterministic) to avoid a hydration mismatch;
  // this effect flips to the browser zone exactly once. This is React's
  // documented server/client-divergence pattern — the cascading-render warning
  // does not apply.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setLocal(true), [])

  const scheduled = formatInstantRange(meetingAt, meetingEndsAt, meetingTz)
  const display = local ? formatInstantRange(meetingAt, meetingEndsAt) : scheduled

  return (
    <time dateTime={meetingAt} title={`Scheduled: ${scheduled}`}>
      {display}
    </time>
  )
}
