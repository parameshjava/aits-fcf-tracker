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
  useEffect(() => setLocal(true), [])

  const scheduled = formatInstant(meetingAt, meetingTz)
  const display = local ? formatInstant(meetingAt) : scheduled

  return (
    <time dateTime={meetingAt} title={`Scheduled: ${scheduled}`}>
      {display}
    </time>
  )
}
