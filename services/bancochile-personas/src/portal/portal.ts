import { readAccounts, type OwnAccount } from './accounts.js';
import { readMovements, type Movement } from './movements.js';
import { readRecipients, type Recipient } from './recipients.js';
import { PortalSession } from './session.js';
import type { AccountsPortal } from '../tasks/cuentas.js';
import type { RecipientsPortal } from '../tasks/destinatarios.js';

/** The authenticated personas portal as the tasks see it. */
export class PlaywrightPortal implements RecipientsPortal, AccountsPortal {
  private constructor(private readonly session: PortalSession) {}

  static async open(profile: string): Promise<PlaywrightPortal> {
    return new PlaywrightPortal(await PortalSession.open(profile));
  }

  listRecipients(): Promise<Recipient[]> {
    return readRecipients(this.session.page);
  }

  listAccounts(): Promise<OwnAccount[]> {
    return readAccounts(this.session.page);
  }

  listMovements(accountNumber: string, range: { from: string; to: string } | null): Promise<{ currency: string; movements: Movement[] }> {
    return readMovements(this.session.page, accountNumber, range);
  }

  close(): Promise<void> {
    return this.session.close();
  }
}
