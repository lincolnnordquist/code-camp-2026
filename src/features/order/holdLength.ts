const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

/** A reservation hold in words: "2 hours", "45 minutes", "1 hour 30 minutes". */
export function holdLength(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return plural(rest, 'minute')
  return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(rest, 'minute')}`
}
