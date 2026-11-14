import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface ScreenErrorBoundaryProps {
  /** The current path: a new one clears the error, so the attendee can move on. */
  pathname: string
  children: ReactNode
}

interface ScreenErrorBoundaryState {
  pathname: string
  failed: boolean
}

/**
 * The last catch above the routes: an error no screen handled replaces that screen, not the whole
 * app, with a way back to the event home. The header and tab bar stay usable.
 */
export class ScreenErrorBoundary extends Component<ScreenErrorBoundaryProps, ScreenErrorBoundaryState> {
  state: ScreenErrorBoundaryState = { pathname: this.props.pathname, failed: false }

  static getDerivedStateFromProps(props: ScreenErrorBoundaryProps, state: ScreenErrorBoundaryState) {
    return props.pathname === state.pathname ? null : { pathname: props.pathname, failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="screen-state">
        <h1 className="screen-state__message">Something went wrong on this screen.</h1>
        <Link className="button" to="/">
          Go to event home
        </Link>
      </div>
    )
  }
}
