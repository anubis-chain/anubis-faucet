import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createErc20Sender } from './sender.js';
import { createFaucetService, createReconcileService } from './service.js';
import { SecretsProvider } from './secrets.js';
import { DynamoClaimStore } from './store.js';
import { createTurnstileVerifier } from './turnstile.js';

let runtime;

export function createRuntime({ env = process.env } = {}) {
  const config = loadConfig(env);
  const logger = createLogger();
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const secrets = new SecretsProvider({
    client: new SecretsManagerClient({}),
    secretId: config.secretId,
    cacheMs: config.secretsCacheMs,
  });
  const store = new DynamoClaimStore({ client: documentClient, config });
  const sender = createErc20Sender(config);
  const verifier = createTurnstileVerifier(config);
  const service = createFaucetService({ config, store, secrets, verifier, sender, logger });
  const reconciler = createReconcileService({ store, sender, logger });
  return Object.freeze({ config, logger, secrets, store, sender, service, reconciler });
}

export function getRuntime() {
  if (!runtime) runtime = createRuntime();
  return runtime;
}
