const EMAIL_KEY = 'checkout.email'

/** The email of the last order placed from this browser, or '' when there is none. */
export function savedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberEmail(email: string) {
  try {
    localStorage.setItem(EMAIL_KEY, email)
  } catch {
    // Without storage the field starts empty next time.
  }
}
