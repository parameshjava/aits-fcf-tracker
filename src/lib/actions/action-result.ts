import * as Sentry from '@sentry/nextjs'

/**
 * Discriminated-union return shape for every mutating server action.
 *
 *   const r = await createLoan(formData)
 *   if (!r.ok) {
 *     // r.error is always a string here; r.field optionally points at the
 *     // form field that caused the failure (so inline error rendering works).
 *     return showError(r.error, r.field)
 *   }
 *   // r.data is whatever the action chose to return (often `void`).
 *   // r.message is a human-readable success line for toasts/banners.
 *   router.push('/admin')
 *
 * Pure read actions (`getDashboardOverall`, `getLoans`, etc.) keep their old
 * "throw on failure, return data on success" signature — they're consumed by
 * server components that benefit from Next's error boundary handling.
 */
export type ActionResult<T = void> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; field?: string }

/** Build a success result. Inline-friendly: `return actionOk()` or `return actionOk(data, 'Saved')`. */
export function actionOk<T>(data?: T, message?: string): ActionResult<T> {
  return data === undefined && message === undefined
    ? { ok: true }
    : { ok: true, data, message }
}

/** Build a failure result. `field` is optional and used for per-field UI errors. */
export function actionError(error: string, field?: string): ActionResult<never> {
  return field ? { ok: false, error, field } : { ok: false, error }
}

/**
 * Wraps a server-action body with:
 *   1. Sentry per-action span (via withServerActionInstrumentation) so we
 *      get a named operation in the Sentry traces UI.
 *   2. A top-level try/catch that captures any uncaught throw and turns it
 *      into `{ ok: false, error }` — so a form never crashes from an
 *      unexpected exception, and Sentry still records the original throw.
 *
 * Usage:
 *
 *   export async function createLoan(formData: FormData): Promise<ActionResult> {
 *     return runAction('createLoan', async () => {
 *       // …business logic…
 *       if (bad) return actionError('Validation failed', 'amount')
 *       return actionOk(undefined, 'Loan created')
 *     })
 *   }
 */
export async function runAction<T>(
  name: string,
  body: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await Sentry.withServerActionInstrumentation(name, {}, body)
  } catch (err) {
    // The framework-level `onRequestError` hook in instrumentation.ts catches
    // throws too, but we double-report here so the action span carries the
    // exception payload (otherwise we'd only see "span aborted").
    Sentry.captureException(err, { tags: { action: name } })
    const msg = err instanceof Error ? err.message : String(err)
    return actionError(msg)
  }
}
