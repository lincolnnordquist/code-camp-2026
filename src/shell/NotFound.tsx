import { Link, useLocation } from 'react-router-dom'

/** An address the app has no screen for: what happened, and the way back to the event home. */
export function NotFound({ defaultEventSlug }: { defaultEventSlug: string }) {
  const { pathname } = useLocation()
  // Inside an event (a mistyped storefront address) the way back is that event's home.
  const slug = pathname.match(/^\/e\/([^/]+)/)?.[1] ?? defaultEventSlug
  return (
    <div className="screen-state not-found">
      <h1 className="not-found__title">Page not found</h1>
      <p className="screen-state__message">This page does not exist, or its link has changed.</p>
      <Link className="button" to={`/e/${slug}`}>
        Go to the event home
      </Link>
    </div>
  )
}
