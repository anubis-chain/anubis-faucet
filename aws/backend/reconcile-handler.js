import { createLogger } from './logger.js';

const fallbackLogger = createLogger();

export function createReconcileHandler(runtimeProvider) {
  return async (event = {}, context = {}) => {
    let runtime;
    const requestId = context.awsRequestId || event.id || 'scheduled';
    try {
      runtime = await runtimeProvider();
      const result = await runtime.reconciler.run();
      runtime.logger.info('reconcile_complete', { requestId, status: result.status, claimId: result.claimId });
      return result;
    } catch (error) {
      (runtime?.logger || fallbackLogger).error('reconcile_failed', { requestId, code: error?.code || 'RECONCILE_ERROR' });
      // Avoid Lambda's default error output serializing an upstream SDK/RPC error.
      throw new Error('Reconciliation failed safely.');
    }
  };
}
