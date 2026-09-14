import type { FileDescriptor } from '../../../../packages/runtime/src/downloads.js';
import type { BusinessOption } from '../tasks/businesses-list.js';

export type AccountOption = BusinessOption;

export interface CartolaSelection {
  businessId: string;
  accountId: string;
  documentType: 'excel-detallado';
}

export interface BciPymePortal {
  requireAuthenticatedSession(): Promise<void>;
  discoverBusinesses(): Promise<BusinessOption[]>;
  discoverAccounts(businessId: string): Promise<AccountOption[]>;
  downloadCartola(selection: CartolaSelection): Promise<FileDescriptor>;
}
