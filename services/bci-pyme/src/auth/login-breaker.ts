import {
  AuthState as SharedAuthState,
  LoginBreaker as SharedLoginBreaker,
  type AuthStateRecord as SharedAuthStateRecord,
} from '../../../../packages/runtime/src/login-breaker.js';

export { requireSafeProfile, type BreakerStatus } from '../../../../packages/runtime/src/login-breaker.js';

/** BCI's breaker lives at portales/bci-pyme/login-breakers/<profile>; the path is a compatibility contract. */
export class LoginBreaker extends SharedLoginBreaker {
  constructor(stateRoot: string) { super(stateRoot, 'bci-pyme'); }
}

/** Static stages that establish BCI acceptance. */
export type AuthenticatedStage = 'device-registration-offer' | 'convention-selector' | 'authenticated-shell';
export type AuthStateRecord = SharedAuthStateRecord<AuthenticatedStage>;

export class AuthState extends SharedAuthState<AuthenticatedStage> {
  constructor(stateRoot: string) { super(stateRoot, 'bci-pyme'); }
}
