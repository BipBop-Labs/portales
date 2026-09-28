import { z } from 'zod';
import { loadContract } from '../../../../packages/runtime/src/contracts.js';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { repositoryRoot } from '../../../../packages/runtime/src/version.js';
import { HOSTS, LOGIN_HOST } from '../config/index.js';
import { Rut } from '../rut/index.js';
import type { PortalSession } from '../seams/index.js';

export const BTE_CANCEL_CONTRACT = 'services/sii/docs/contracts/bte-cancel.md';
export const cancellationPreviewSchema = z.object({
  principal: z.string(), folio: z.number().int().positive(), codigo: z.string().min(1), fecha: z.iso.date(),
  receptor: z.string(), totalHonorarios: z.number().int().positive(), retencion: z.number().int().nonnegative(), liquido: z.number().int().nonnegative(),
  causa: z.string().min(1), warning: z.string().min(1).max(5000), notificaReceptor: z.literal(true),
});
export type CancellationPreview = z.infer<typeof cancellationPreviewSchema>;

function mismatch(message: string): never {
  throw new PortalError('CONTRACT_MISMATCH', message, { recovery: { contractRef: BTE_CANCEL_CONTRACT, nextAction: 'Observe the cancellation form in a headed browser and review the structural diff; do not retry.' } });
}

async function requireState(session: PortalSession, name: string): Promise<void> {
  const loaded = await loadContract(repositoryRoot(), 'sii', 'bte.cancel-prepare');
  const state = loaded?.contract.pageStates[name];
  if (!state) throw new PortalError('INTERNAL', 'The cancellation contract state is missing.');
  const diff = await session.evaluate<string | null>(`(() => {
    const cancellationState = ${JSON.stringify(state)};
    if (location.hostname !== 'loa.sii.cl' || !cancellationState.routeFragments.includes(location.pathname)) return 'Expected the recorded cancellation route.';
    for (const control of cancellationState.controls) {
      const count = [...document.querySelectorAll(control.css)].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length;
      if (count !== control.expectedVisibleCount) return 'Expected ' + control.expectedVisibleCount + ' visible ' + control.css + ', observed ' + count + '.';
    }
    return null;
  })()`);
  if (diff !== null) mismatch(diff);
}

/** Discover the complete live reason catalog; opening this form never requests an annulment. */
export async function openBteCancellation(session: PortalSession, principal: Rut) {
  const url = new URL(await session.goto(`${HOSTS.bheCgi}/TMBANU_PrevalidaAnulacion.cgi`));
  if (url.hostname === LOGIN_HOST) throw new PortalError('SESSION_EXPIRED', 'The SII session expired.');
  await requireState(session, 'source');
  const raw = await session.evaluate<unknown>(`(() => {
    if (typeof xml_values === 'undefined') return null;
    return { principal: String(xml_values.rut_autentificado) + '-' + String(xml_values.dv_autentificado),
      options: [...document.querySelectorAll('input[name="OptCausaAnulacion"][type="radio"]')].map(e => ({id:e.value, label:e.closest('tr')?.innerText.trim()})) };
  })()`);
  const parsed = z.object({ principal: z.string(), options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).length(3) }).safeParse(raw);
  if (!parsed.success || new Set(parsed.data.options.map(o => o.id)).size !== 3) mismatch('Expected three distinct cancellation causes with labels.');
  if (!principal.equals(Rut.parse(parsed.data.principal))) throw new PortalError('AUTHORIZATION_DENIED', 'The cancellation form belongs to another principal.');
  return parsed.data.options;
}

/** Stop at step two. SII's final button and confirmation dialog are separate from this preview. */
export async function previewBteCancellation(session: PortalSession, principal: Rut, folio: number, causa: string): Promise<CancellationPreview> {
  const options = await openBteCancellation(session, principal);
  if (!options.some(option => option.id === causa)) throw new PortalError('INVALID_INPUT', 'The cancellation cause is absent from the live options.');
  await session.submitForm({ fields: { Txt_BoletaAnular: String(folio), OptCausaAnulacion: causa }, button: 'input[name="cmdContinuar"]', expectedPath: '/cgi_IMT/TMBANU_ConfirmarAnulacion.cgi' });
  await requireState(session, 'preview');
  const raw = await session.evaluate<unknown>(`(() => {
    if (typeof xml_values === 'undefined' || typeof msg_an !== 'string') return null;
    const x = xml_values, f = document.forms.namedItem('formulario');
    if (!f || x.anulada !== 'N' || !x.rut_receptor2 || ['0','44444446'].includes(String(x.rut_receptor2))) return null;
    if (String(f.elements.namedItem('Txt_BoletaAnular')?.value) !== String(x.nro_boleta) || String(f.elements.namedItem('Txt_CodigoCausa')?.value) !== String(x.codigo_causa)) return null;
    if (String(f.elements.namedItem('rut_arrastre')?.value).replace(/\\./g,'') !== String(x.rut_contribuyente).replace(/\\./g,'') || String(f.elements.namedItem('dv_arrastre')?.value) !== String(x.dv_contribuyente)) return null;
    const amount = key => Number(String(x[key]).replace(/\\./g,''));
    return { principal: String(x.rut_contribuyente).replace(/\\./g,'') + '-' + x.dv_contribuyente,
      folio: Number(x.nro_boleta), codigo: String(x.cod_barras), fecha: [x.anio_atencion,x.mes_atencion,x.dia_atencion].join('-'),
      receptor: String(x.rut_receptor).replace(/\\./g,'') + '-' + x.dv_receptor,
      totalHonorarios: amount('Monto_Boleta'), retencion: amount('Monto_Retencion'), liquido: amount('Monto_Liquido'),
      causa: String(x.codigo_causa), warning: msg_an, notificaReceptor: true };
  })()`);
  const parsed = cancellationPreviewSchema.safeParse(raw);
  if (!parsed.success) mismatch('Expected an active boleta cancellation preview for a domestic identified recipient with matching hidden fields.');
  const preview = parsed.data;
  if (!principal.equals(Rut.parse(preview.principal))) throw new PortalError('AUTHORIZATION_DENIED', 'The cancellation preview belongs to another principal.');
  Rut.parse(preview.receptor);
  if (preview.folio !== folio || preview.causa !== causa || preview.liquido + preview.retencion !== preview.totalHonorarios) mismatch('The cancellation preview differs from the requested folio, cause or reconciled totals.');
  return preview;
}

/** Submit once using the exact warning reviewed in the snapshot. The task verifies the monthly state. */
export async function submitBteCancellation(session: PortalSession, preview: CancellationPreview): Promise<void> {
  await requireState(session, 'preview');
  await session.submitForm({ fields: {}, button: 'input[name="BtnConfirmar"]', expectedPath: '/cgi_IMT/TMBANU_RecepcionAnulacion.cgi', confirmDialog: preview.warning });
}
