import type { FileDescriptor } from '../../../../packages/runtime/src/downloads.js';
import type { BusinessOption } from '../tasks/businesses-list.js';

export type AccountOption = BusinessOption;

export interface CartolaSelection {
  businessId: string;
  accountId: string;
  documentType: 'excel-detallado';
}

export interface Recipient {
  status: 'authorized' | 'pending';
  name: string;
  alias: string;
  rut: string;
  email: string;
  bank: string;
  accountNumber: string;
}

export interface RecipientCreation {
  businessId: string;
  bankId: string;
  name: string;
  alias: string;
  rut: string;
  email: string;
  accountNumber: string;
  favorite: boolean;
}

export type RecipientProgress = (stage: 'verifying-created-recipient' | 'awaiting-bcipass' | 'verifying-bcipass' | 'bank-success' | 'bank-error') => void;

export interface BciPymePortal {
  requireAuthenticatedSession(): Promise<void>;
  discoverBusinesses(): Promise<BusinessOption[]>;
  prepareRecipientCreation(input: RecipientCreation): Promise<void>;
  createRecipient(input: RecipientCreation, progress: RecipientProgress): Promise<void>;
  deleteRecipient(businessId: string, recipient: Recipient): Promise<void>;
  authorizeRecipient(businessId: string, recipient: Recipient, progress: RecipientProgress): Promise<void>;
  listRecipients(businessId: string): Promise<Recipient[]>;
  discoverRecipientBanks(businessId: string): Promise<BusinessOption[]>;
  discoverAccounts(businessId: string): Promise<AccountOption[]>;
  downloadCartola(selection: CartolaSelection): Promise<FileDescriptor>;
}
