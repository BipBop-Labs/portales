import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { z } from 'zod';
import { PortalError } from '../errors.js';

const sessionCookies = z.array(z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().refine(domain => domain === 'bci.cl' || domain.endsWith('.bci.cl')),
  path: z.string(),
  expires: z.literal(-1),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(['Strict', 'Lax', 'None']),
  partitionKey: z.string().optional(),
}));

/** Read the earlier session-cookie checkpoint only while migrating a legacy profile. */
export async function restoreSessionCookies(context: Pick<BrowserContext, 'addCookies'>, profileDirectory: string): Promise<void> {
  let encoded: string;
  try {
    encoded = await readFile(join(profileDirectory, 'session-cookies.json'), 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new PortalError('PORTAL_CHANGED', 'Saved BCI session cookies could not be read. Check private profile storage before retrying.');
  }
  let cookies: z.infer<typeof sessionCookies>;
  try {
    cookies = sessionCookies.parse(JSON.parse(encoded) as unknown);
  } catch {
    throw new PortalError('SESSION_EXPIRED', 'Saved BCI session cookies are invalid. Run auth login explicitly.');
  }
  await context.addCookies(cookies.map(({ partitionKey, ...cookie }) => ({
    ...cookie, ...(partitionKey === undefined ? {} : { partitionKey }),
  })));
}
