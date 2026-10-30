# Banco de Chile Personas own accounts and movements

- Observation date: 2026-10-30
- Live validation: `cuentas list` and `movimientos list` (default view, explicit ranges, one-day
  range, rejected 105-day range) completed against the real portal; the default view's totals
  matched the portal's own "Total cargos" and "Total abonos"
- Effect: read-only

## Own accounts

The authenticated page answers two same-origin GETs, authenticated by cookies only:

- `/mibancochile/rest/persona/selectorproductos/selectorProductos/obtenerProductos` →
  `{ nombre, rut, productos: [{ id, tipo, codigo, codigoMoneda, label, mascara, numero, estado, … }] }`.
  It lists every product (current account, sometimes twice with different `tipo`, credit line,
  credit card, insurance). The movements view requests it with `?incluirTarjetas`.
- `/mibancochile/rest/persona/bff-pp-prod-ctas-saldos/productos/cuentas/saldos` →
  `[{ tipo, codProducto, descripcion, moneda, numero, disponible, cupo, ctaCte, … }]`, one entry per
  product with a balance (`CUENTA_CORRIENTE`, `LINEA_CREDITO`). `cupo` repeated `disponible` in the
  observed data, so it is not exposed as a credit limit.

`cuentas list` returns the balance entries, labelled from the product list by `numero`.

## Movements

1. `Mis Productos → Cuentas → Saldos y Movimientos` is `#/movimientos/cuenta/saldos-movimientos`.
2. The view sends `POST /mibancochile/rest/persona/bff-pper-prd-cta-movimientos/movimientos/getCartola`
   with `{ cabecera: { statusGenerico, paginacionDesde }, cuentaSeleccionada: { nombreCliente, rutCliente, numero, mascara, selected, codigoProducto, claseCuenta, moneda } }`
   and `content-type: application/json`. The adapter captures that request for the account the view
   opens with.
3. The view's date filter adds `cabecera.fechaInicio` and `cabecera.fechaFin`: ISO instants of
   midnight in Chile of the first and last day (e.g. `2026-09-14T03:00:00.000Z`). Both days are
   included and filter by accounting date. More than 45 days answers HTTP 500
   `{ codigo: "BFERR2_500" }`, so ranges are validated locally first.
4. Without dates the portal returns its default view: about the last 45 days **and movements already
   made that post on a later business day** (a Friday-evening transfer showed accounting date
   Monday). A range ending today excludes them.
5. The response has `moneda`, `movimientos[]` (`id`, `fechaContable` dd/mm/yyyy, `tipo`
   `cargo`/`abono`, `monto` and `saldo` as integer strings, `descripcion`, `canal`,
   `detalleGlosa[]`, `numeroDocumento`, …), account totals, and one `pagina` entry with
   `totalRegistros`, `cantidadRegistros` 100 and `masPaginas` `N`.

## Stop conditions

- A second page (`masPaginas` not `N`) has not been observed: `UNSUPPORTED_CAPABILITY`, asking for a
  shorter range, rather than a partial list.
- Read count different from `totalRegistros`, or a changed shape: `CONTRACT_MISMATCH`.
- An account other than the one the view opens with: `UNSUPPORTED_CAPABILITY` until selecting another
  account in the view is observed.
- Any non-200 answer: `PROVIDER_ERROR`. No query is retried.
