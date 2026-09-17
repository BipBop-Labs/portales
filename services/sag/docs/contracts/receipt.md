# Finalization and PDF receipt — observed 2026-09-14

Machine-checkable twin: [`receipt.json`](receipt.json); validate with `portales contract validate`.

The existing reviewed draft was finalized once after explicit confirmation of
the truthful declaration. Accepting the checked oath dialog made one
`PUT /declaracionJurada/<draft-folio>` request. Its successful JSON response had
`etapa7.declaracionJuradaFinal = 1`, a final `folioFinalizacion`, and `pdfUrl`.
The visible completion screen independently showed the final folio, identity,
document, declared product answer, minors' luggage answer, arrival date, and
border control. Draft folio and final folio are different identifiers.

The `DOWNLOAD DECLARATION` button navigated to the observed GET:

`https://djapi.sag.gob.cl/declaracionJurada/<final-folio>/uuid/<identificadorUnico>/pdf`

It returned HTTP 200, `Content-Type: application/pdf`, and attachment disposition
with a filename containing the final folio. This is receipt retrieval, not
submission. Use the exact final folio and unique identifier from the completed
operation; never guess or enumerate them. No authorization header was supplied.
Cookies remain browser-managed. All identifiers and document data stay in private
files outside the repository.

The loaded `9007.b1c5c25f565af872.js` proves that `generarPDF` uses this online
route when `pdfUrl` exists. Its offline branch generates a PDF locally; it is
not implemented here because a local PDF alone does not prove remote submission.

The maintained download task reads the exact observed PDF in a fresh browser
context, without page scripts, login, declaration creation, or write requests.
It must validate MIME, PDF signature, and receipt content against the expected
identity and business state before returning a file descriptor. No retries or
fallback PDF generation are permitted. Denial, rate limiting, unexpected
destinations, or a mismatched receipt stop the operation.

The observed English PDF has one labeled line for each of `Folio Number`,
`Identification`, `Document Number`, `SAG Sworn Statement`,
`Declare luggage for minors`, `Arrival date to Chile`, and `Entry Point to Chile`.
Dates use day-month-year; boolean answers are `Yes` / `No`. `pdftotext -layout`
preserves these rows. Verify each whole labeled value exactly once, not just an
unscoped occurrence of an identity or date somewhere in the document.

On 2026-09-14, the public `download --input <private-receipt-json> --output
<new-private-pdf>` command completed with exit 0. The verified PDF matched the
portal completion screen for final folio, identity, document, date, border control,
and both answers. The artifact remains outside the repository with private
permissions. An existing destination is never overwritten; the verified file is
published atomically only after all checks. No new automated PDF fixture was
needed: this first observed layout was checked against the real document, and
existing signature checks are reused. Add a synthetic regression only when a
concrete layout failure requires it.

Finalization itself was observed in the browser; there is no maintained automatic
submission command yet. Do not repeat submission to verify a future adapter.
