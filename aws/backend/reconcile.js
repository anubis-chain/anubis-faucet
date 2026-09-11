import { createReconcileHandler } from './reconcile-handler.js';
import { getRuntime } from './runtime.js';

const invoke = createReconcileHandler(() => getRuntime());

export async function handler(event, context) {
  // FAUCET_ENABLED intentionally does not gate reconciliation. Disabling new
  // claims must never abandon a transaction that was already signed.
  return invoke(event, context);
}
