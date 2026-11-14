import type { Order } from '../../shared/types'
import { BoothLogo } from '../../shared/ui/BoothLogo'
import { useBoothDetails } from './boothDetails'

/**
 * An order's booth logo: the code tile until the event's booth details are read (or when the booth
 * has none), then the logo. Decorative: it always sits beside the vendor's name.
 */
export function OrderBoothLogo({ order, className, size }: { order: Order; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const details = useBoothDetails(order)
  return <BoothLogo booth={{ code: order.boothCode, logoUrl: details?.logoUrl ?? '' }} className={className} size={size} />
}
