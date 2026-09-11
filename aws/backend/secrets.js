import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { parseSecretDocument } from './secret-values.js';

export class SecretsProvider {
  constructor({ client, secretId, cacheMs = 300000, now = Date.now }) {
    this.client = client;
    this.secretId = secretId;
    this.cacheMs = cacheMs;
    this.now = now;
    this.cached = null;
    this.inflight = null;
  }

  async get() {
    const current = this.now();
    if (this.cached && current < this.cached.expiresAt) return this.cached.value;
    if (this.inflight) return this.inflight;
    this.inflight = this.load().then(value => {
      this.cached = { value, expiresAt: this.now() + this.cacheMs };
      return value;
    }).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  clear() {
    this.cached = null;
  }

  async load() {
    const response = await this.client.send(new GetSecretValueCommand({ SecretId: this.secretId }));
    let document = response.SecretString;
    if (document === undefined && response.SecretBinary !== undefined) {
      document = Buffer.from(response.SecretBinary).toString('utf8');
    }
    if (!document) throw new Error('Faucet secret has no value.');
    return parseSecretDocument(document);
  }
}
