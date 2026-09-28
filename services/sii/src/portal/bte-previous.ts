import { z } from 'zod';
import { loadContract } from '../../../../packages/runtime/src/contracts.js';
import { repositoryRoot } from '../../../../packages/runtime/src/version.js';
import { PortalError } from '../../../../packages/runtime/src/errors.js';
import { HOSTS, LOGIN_HOST } from '../config/index.js';
import { SessionExpiredError } from '../errors/index.js';
import { Rut } from '../rut/index.js';
import type { PortalSession } from '../seams/index.js';
import type { BtePreview } from './bte-emit.js';

export const BTE_PREVIOUS_CONTRACT = 'services/sii/docs/contracts/bte-previous.md';
const CGI = HOSTS.bheCgi;
export const btePreviousIntentSchema = z.object({
  principal: z.string(), source: z.string(), receptor: z.string(), nombre: z.string(), domicilio: z.string(),
  region: z.string(), comuna: z.string(), retiene: z.enum(['RETRECEPTOR', 'RETCONTRIBUYENTE']),
  emisorDomicilio: z.string().min(1), emisorDomicilioLabel: z.string().min(1), mostrarDetalle: z.boolean(),
  fecha: z.string(), lineas: z.array(z.object({ glosa: z.string().min(1), monto: z.number().int().positive() })).min(1).max(4),
});
export type BtePreviousIntent = z.infer<typeof btePreviousIntentSchema>;
export interface BtePreviousOverrides { fecha?: string; lineas?: readonly { glosa: string; monto: number }[] }

function mismatch(message: string): never {
  throw new PortalError('CONTRACT_MISMATCH', message, { recovery: { contractRef: BTE_PREVIOUS_CONTRACT, nextAction: 'Observe the BHE form in a headed browser; do not retry or broaden selectors.' } });
}

/** Classify the bounded structural facts from the checked-in JSON before parsing values. */
async function requireState(session: PortalSession, name: string): Promise<void> {
  const loaded = await loadContract(repositoryRoot(), 'sii', 'bte.prepare');
  const state = loaded?.contract.pageStates[name];
  if (!state || state.controls.some(c => !c.css || typeof c.expectedVisibleCount !== 'number')) throw new PortalError('INTERNAL', 'The BHE contract state is unavailable or invalid.');
  const diff = await session.evaluate<string | null>(`(() => {
    const contractState = ${JSON.stringify(state)};
    if (!contractState.routeFragments.includes(location.pathname)) return 'Expected the recorded BHE route.';
    for (const control of contractState.controls) {
      const count = [...document.querySelectorAll(control.css)].filter(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length;
      if (count !== control.expectedVisibleCount) return 'Expected ' + control.expectedVisibleCount + ' visible ' + control.css + ', observed ' + count + '.';
    }
    return null;
  })()`);
  if (diff !== null) mismatch(diff);
}

async function navigate(session: PortalSession, url: string): Promise<void> {
  const landed = new URL(await session.goto(url));
  if (landed.hostname === LOGIN_HOST) throw new SessionExpiredError('La sesión del SII expiró.');
  if (landed.hostname !== 'loa.sii.cl') mismatch('Expected the BHE portal host.');
}

/** Observe the actual prefilled form, including the portal's region/comuna resolution.
 * No HTML evaluation or inferred reconstruction of the previous document is needed. */
export async function loadBtePrevious(session: PortalSession, principal: Rut, folio: number): Promise<BtePreviousIntent> {
  await navigate(session, `${CGI}/TMBECN_ValidaTimbrajeContrib.cgi?modo=2`);
  await requireState(session, 'source');
  const sourceForm = await session.evaluate<boolean>(`(() => {
    const f = document.forms.namedItem('formulario');
    return !!f && f.getAttribute('action') === 'TMBECN_PresentaDatosBoleta.cgi'
      && f.elements.namedItem('prellenar')?.value === 'SI'
      && document.querySelectorAll('input[name="boleta"]').length === 1
      && document.querySelectorAll('input[name="cmdcontinuar"]').length === 1;
  })()`);
  if (!sourceForm) mismatch('Expected the previous-boleta selection form and one folio control.');
  await session.submitForm({ fields: { boleta: String(folio) }, button: 'input[name="cmdcontinuar"]', expectedPath: '/cgi_IMT/TMBECN_PresentaDatosBoleta.cgi' });
  await requireState(session, 'prefilled');
  const raw = await session.evaluate<unknown>(`(() => {
    if (typeof xml_values === 'undefined') return null;
    const f = document.forms.namedItem('formulario');
    if (!f || document.querySelectorAll('input[name="cmdAceptar"]').length !== 1) return null;
    const value = name => f.elements.namedItem(name)?.value;
    const address = f.elements.namedItem('cbo_domicilio');
    if (!address || Number(value('cantidad_filas_ingreso')) !== 4) return null;
    const lineas = [1,2,3,4].map(i => ({glosa: value('desc_prestacion_' + i), monto: Number(value('valor_prestacion_' + i))})).filter(l => l.glosa || l.monto);
    return {
      principal: String(xml_values.rut_arrastre) + '-' + String(xml_values.dv_arrastre), source: String(xml_values.num_ult_boleta),
      receptor: value('txt_rut_destinatario') + '-' + value('txt_dv_destinatario'), nombre: value('txt_nombres_destinatario'),
      domicilio: value('txt_domicilio_destinatario'), region: value('cod_region'), comuna: value('cbo_comuna'), retiene: value('OptTipoRetencion'),
      emisorDomicilio: address.value, emisorDomicilioLabel: address.selectedOptions[0]?.textContent.trim(),
      mostrarDetalle: value('hdn_muestra_glosa') === 'si', fecha: [value('cbo_anio_boleta'),value('cbo_mes_boleta'),value('cbo_dia_boleta')].join('-'), lineas
    };
  })()`);
  const parsed = btePreviousIntentSchema.safeParse(raw);
  if (!parsed.success) mismatch('Expected a populated BHE form with 1..4 complete lines, retention, date and domicile.');
  if (!principal.equals(Rut.parse(parsed.data.principal))) throw new PortalError('AUTHORIZATION_DENIED', 'The BHE form belongs to a different principal.');
  if (Number(parsed.data.source) !== folio) mismatch('The prefilled form does not identify the requested source folio.');
  Rut.parse(parsed.data.receptor);
  return parsed.data;
}

/** Runs only to the separate confirmation page. The final issue control is never clicked here. */
export async function previewBtePrevious(session: PortalSession, original: BtePreviousIntent, overrides: BtePreviousOverrides): Promise<{ intent: BtePreviousIntent; preview: BtePreview }> {
  const intent = { ...original, ...(overrides.fecha === undefined ? {} : { fecha: overrides.fecha }), ...(overrides.lineas === undefined ? {} : { lineas: [...overrides.lineas] }) };
  const [anio, mes, dia] = intent.fecha.split('-');
  if (!anio || !mes || !dia) throw new PortalError('INVALID_INPUT', 'The new boleta date must be YYYY-MM-DD.');
  const fields: Record<string, string> = { cbo_anio_boleta: anio, cbo_mes_boleta: mes, cbo_dia_boleta: dia };
  for (let i = 1; i <= 4; i++) {
    const line = intent.lineas[i - 1];
    fields[`desc_prestacion_${i}`] = line?.glosa ?? '';
    fields[`valor_prestacion_${i}`] = line === undefined ? '' : String(line.monto);
  }
  await session.submitForm({ fields, button: 'input[name="cmdAceptar"]', expectedPath: '/cgi_IMT/TMBECN_ConfirmaTimbrajeContrib.cgi' });
  await requireState(session, 'preview');
  const state = await session.evaluate<unknown>(`(() => {
    if (typeof xml_values === 'undefined' || document.querySelectorAll('input[name="cmdconfirmar"]').length !== 1) return null;
    const amount = key => Number(String(xml_values[key]).replace(/\\./g, ''));
    return { totalHonorarios: amount('Monto_Boleta'), retencion: amount('Monto_Retencion'), liquido: amount('Monto_Liquido'), porcentajeRetencion: String(xml_values.PorcentajeRetencion),
      principal: String(xml_values.rut_arrastre) + '-' + String(xml_values.dv_arrastre), receptor: String(xml_values.rut_destinatario) + '-' + String(xml_values.dv_destinatario) };
  })()`);
  const parsed = z.object({ totalHonorarios: z.number().int().positive(), retencion: z.number().int().nonnegative(), liquido: z.number().int().nonnegative(), porcentajeRetencion: z.string().min(1), principal: z.string(), receptor: z.string() }).safeParse(state);
  if (!parsed.success) mismatch('Expected complete BHE preview totals and one final issue control.');
  const p = parsed.data;
  if (!Rut.parse(p.principal).equals(Rut.parse(intent.principal)) || !Rut.parse(p.receptor).equals(Rut.parse(intent.receptor))) throw new PortalError('AUTHORIZATION_DENIED', 'The preview account or recipient differs from the selected form.');
  if (p.totalHonorarios !== intent.lineas.reduce((sum, line) => sum + line.monto, 0) || p.liquido + p.retencion !== p.totalHonorarios) mismatch('The preview totals do not reconcile with the prepared lines.');
  return { intent, preview: { totalHonorarios: p.totalHonorarios, retencion: p.retencion, liquido: p.liquido, porcentajeRetencion: p.porcentajeRetencion, retiene: intent.retiene === 'RETRECEPTOR' ? 'RECEPTOR' : 'EMISOR' } };
}

/** Single final submission, only after the task consumed an explicitly confirmed snapshot.
 * The result marker is inherited from the existing emission adapter; the browser runs the portal validator.
 * no new live emission was performed while adding the previous-boleta flow. */
export async function issueBtePrevious(session: PortalSession): Promise<string> {
  const valid = await session.evaluate<boolean>(`(() => {
    if (location.pathname !== '/cgi_IMT/TMBECN_ConfirmaTimbrajeContrib.cgi' || document.querySelectorAll('input[name="cmdconfirmar"]').length !== 1) return false;
    const f = document.forms.namedItem('formulario');
    return !!f && f.elements.namedItem('origen')?.value === 'SEPTIMO';
  })()`);
  if (!valid) mismatch('Expected the BHE confirmation form before final submission.');
  await session.submitForm({ fields: {}, button: 'input[name="cmdconfirmar"]', expectedPath: '/cgi_IMT/TMBECN_BoletaHonorariosElectronica.cgi' });
  const code = await session.evaluate<unknown>("typeof xml_values === 'undefined' ? null : xml_values.cod_barras");
  if (typeof code !== 'string' || !/^[A-Za-z0-9]+$/.test(code)) throw new PortalError('REMOTE_STATE_AMBIGUOUS', 'SII did not return a verifiable issue identifier; reconcile the monthly listing and never repeat this snapshot.');
  return code;
}
