# SII

- Slug: `sii`
- Official portal: `https://www.sii.cl/`
- Account scope: one authenticated principal per profile; represented-entity scope depends on the resource.
- Credentials: OS keyring service `cl.bipbop.portales.sii`, account equal to the selected profile.
- Authentication: explicit one-attempt Clave Tributaria login. Stop on additional authentication, rejected credentials, authorization failures or rate limits.

The service overview is [docs/SII.md](../../../docs/SII.md). Discover exact arguments through `portales catalog --json` and `portales describe sii <resource> <action> --json`.

## Honorarios

`bte.list` reads a month for the principal. `bte.download` downloads an issued PDF by month and folio, verifies its identity and returns an indexed private artifact. `bte.prepare` uses an issued folio to preview a new boleta with the current SII date and optional replacement lines/date. It returns a private, short-lived preparation and a fingerprint. `bte.emit --snapshot` requires that exact fingerprint, rechecks the preview, consumes the preparation once and verifies the issued monthly listing. `bte.options` discovers the maintained region/comuna/retention catalogs used by manual emission.

`bte.cancel-options` discovers the live annulment causes. `bte.cancel-prepare` previews one active issued folio and returns a fingerprint; `bte.cancel` confirms that preparation once and verifies the annulled monthly row. SII automatically notifies the recipient. See the [cancellation contract](contracts/bte-cancel.md) for scope and recovery.

Issued BHE operations cannot switch to a represented empresa. A boleta received by a company does not authorize issuing as the person who sent it. Source data and PDFs remain scoped to the principal's profile.

See the dated [issued BHE contract](contracts/bte-previous.md) for the observed flow, supported branches and verification status. Final legal emission is not a development test and remains pending live verification until a real operation is explicitly confirmed.

## Sensitive results

Boleta codes, folios, RUTs, recipient names and addresses, descriptions, amounts, snapshots and documents are private. Results intentionally expose the details needed to review the operation; logs contain only bounded structural diagnostics. Never copy results into this repository. Preparation storage holds curated intent and totals, never credentials, cookies, HTML or hidden-field payloads.
