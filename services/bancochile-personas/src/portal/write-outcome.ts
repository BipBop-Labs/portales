import { PortalError } from '../../../../packages/runtime/src/errors.js';

/** Once the submitting click happened, a failure that does not state its own `writeOutcome` may
 *  have applied the write, so it becomes the caller's ambiguous error (see
 *  docs/decisions/2026-10-31-write-outcome.md). Without this, a timeout or closed page after the
 *  click would be reported as `not-sent`. */
export function afterSubmission(error: unknown, ambiguous: (message: string) => PortalError): PortalError {
  if (error instanceof PortalError && error.recovery.writeOutcome !== undefined) return error;
  const code = error instanceof PortalError ? error.code : 'an unexpected error';
  return ambiguous(`The command stopped with ${code} after the request was sent.`);
}
