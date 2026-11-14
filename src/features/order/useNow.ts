import { useEffect, useState } from 'react'

const DEFAULT_TICK_MS = 15_000

/** The current time, refreshed on a timer, so time-based UI updates without reading the clock during render. */
export function useNow(tickMs = DEFAULT_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(id)
  }, [tickMs])
  return now
}
