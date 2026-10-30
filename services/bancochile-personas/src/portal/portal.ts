import { readRecipients, type Recipient } from './recipients.js';
import { PortalSession } from './session.js';
import type { RecipientsPortal } from '../tasks/destinatarios.js';

/** The authenticated personas portal as the tasks see it. */
export class PlaywrightPortal implements RecipientsPortal {
  private constructor(private readonly session: PortalSession) {}

  static async open(profile: string): Promise<PlaywrightPortal> {
    return new PlaywrightPortal(await PortalSession.open(profile));
  }

  listRecipients(): Promise<Recipient[]> {
    return readRecipients(this.session.page);
  }

  close(): Promise<void> {
    return this.session.close();
  }
}
