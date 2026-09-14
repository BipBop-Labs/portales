# SII native service

- Slug: `sii`
- Location: `services/sii`
- Source of the initial implementation: selected MIT-licensed modules from [`BipBop-Labs/sii`](https://github.com/BipBop-Labs/sii)
- Runtime: the Portales npm/TypeScript toolchain

SII is compiled directly into Portales. It is not a submodule, subprocess, pnpm workspace, or separately installed CLI. `services/sii/THIRD_PARTY_LICENSE.md` preserves the original license and attribution.

Only the capabilities exercised by Portales are included:

- explicit authentication and local session status/logout;
- RCV summary, per-type list, and all-types list;
- BTE/BHE monthly listing, emission preview, and confirmed emission;
- DTE authorization lookup;
- Portal MIPYME companies, invoice drafts, previews, emitted-document listing, and PDF download.

The DTE implementation can create, update, preview, list, and delete **drafts**. It can read already issued documents. It does **not** sign or legally issue an invoice.

## Keyring and profile state

Credentials follow the Portales profile convention:

```text
service = cl.bipbop.portales.sii
account = <profile>
```

The value is a versioned JSON bundle containing `rut` and `clave`. It must be created interactively in the OS keyring and must never appear in arguments, files, logs, fixtures, or commits.

Each profile stores cookies and audit receipts under Portales-owned user directories. Login is explicit and makes one attempt:

```bash
portales sii auth login --profile default
portales sii auth status --profile default
portales sii auth logout --profile default
```

All other commands use `default` when `--profile` is omitted.

## RCV purchases and sales

```bash
portales sii rcv summary 2026-09 --profile default
portales sii rcv list 2026-09 --tipo 34 --profile default
portales sii rcv all 2026-09 --profile default
```

Add `--venta` for the sales register or `--rut <rut>` for an authorized represented entity.

## Boletas de honorarios (BTE/BHE)

Session-keyed: reads and issues only for the logged-in principal (no `--rut`).

```bash
portales sii bte list 2026-09 [--recibidas] --profile default
portales sii bte comunas [--region 13]
portales sii bte emit --receptor <rut> --nombre <nombre> --domicilio <dir> \
  --region 13 --comuna 15103 --linea "<monto>:<glosa>" [--linea ...] \
  [--retiene receptor|emisor] [--fecha YYYY-MM-DD] [--sin-detalle] \
  [--enviar <email>] [--sin-copia] [--confirm <monto-total>]
```

`bte emit` without `--confirm` only previews (SII computes retención/líquido, nothing is issued).
With `--confirm` equal to the gross total it **legally issues** the boleta and returns its
código de barras and PDF URL. Emission is never retried. Email delivery via `--enviar` is
best-effort upstream (response fields not yet live-verified).

## Electronic invoicing

```bash
portales sii dte authorized <rut>
portales sii dte empresas --profile default
portales sii dte emitidos --empresa <rut> --profile default
portales sii dte pdf <folio> --empresa <rut> --profile default
portales sii dte borrador list --empresa <rut> --profile default
portales sii dte borrador save <invoice.json> --profile default
portales sii dte borrador delete <id> --empresa <rut> --confirm <id> --profile default
portales sii dte preview <invoice.json> --profile default
```

Invoice JSON files must be private regular files with mode `0600`. Draft deletion requires the exact id twice and is never retried. Produced PDFs default to the selected profile's private Portales data directory.

## Verification methodology

Use the public CLI against the real portal with the minimum calls. The maintained unit tests cover only regressions already encountered, notably the Portales keyring namespace. Do not mirror the upstream package's test suite or add fake infrastructure preemptively.

The verified end-to-end path is:

1. `auth login` from the Portales keyring profile;
2. `rcv summary` for a real period;
3. `dte empresas`;
4. `dte emitidos` for one returned company.

No write is needed to verify the integration.
