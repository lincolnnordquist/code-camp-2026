/**
 * Resolves `null` if the request fails or has not settled by the deadline, so
 * a hung network reads as a network failure instead of waiting forever. A late
 * answer is dropped; callers only retry requests that are safe to repeat.
 */
export function withDeadline<T>(request: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  return Promise.race([request.catch(() => null), deadline]).finally(() => clearTimeout(timer))
}
