import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { HttpError, StateConflictError } from './errors.js';
import {
  buildConfirmPlan,
  buildFailPlan,
  buildReservePlan,
  buildSaveSignedPlan,
  itemKey,
  secondsUntilNextUtcDay,
  utcDay,
} from './store-plan.js';

function canceled(error) {
  return error?.name === 'TransactionCanceledException' || error?.name === 'ConditionalCheckFailedException';
}

export class DynamoClaimStore {
  constructor({ client, config }) {
    this.client = client;
    this.config = config;
    this.tableName = config.tableName;
  }

  async get(Key) {
    const response = await this.client.send(new GetCommand({ TableName: this.tableName, Key, ConsistentRead: true }));
    return response.Item || null;
  }

  async health() {
    // A bare table read is insufficient: a corrupt/mismatched global lock would
    // make every claim fail while still reporting healthy.
    await this.activeClaim();
    return true;
  }

  async activeClaim() {
    const lock = await this.get(itemKey.active());
    if (!lock) return null;
    if (!lock.ownerClaimId || !['preparing', 'signed'].includes(lock.status)) throw new Error('Active lock is corrupt.');
    const claim = await this.get(itemKey.claim(lock.ownerClaimId));
    if (!claim || claim.claimId !== lock.ownerClaimId || claim.status !== lock.status) throw new Error('Active lock does not match its claim.');
    if (claim.status === 'preparing') {
      if (!Number.isSafeInteger(claim.leaseUntil) || claim.leaseUntil !== lock.leaseUntil) {
        throw new Error('Preparing lock does not match its claim lease.');
      }
    } else if (!claim.rawTx || !claim.txHash || !claim.signerAddress || claim.txHash !== lock.txHash) {
      throw new Error('Signed lock does not match its durable transaction.');
    }
    return claim;
  }

  async expirePreparing(now) {
    const claim = await this.activeClaim();
    if (!claim || claim.status !== 'preparing' || claim.leaseUntil > now) return false;
    return this.fail(claim, 'preparing', 'PREPARING_LEASE_EXPIRED', now);
  }

  async reserve({ claimId, address, ipHash, tokenHash, now }) {
    const plan = buildReservePlan({ tableName: this.tableName, claimId, address, ipHash, tokenHash, now, config: this.config });
    try {
      await this.client.send(new TransactWriteCommand(plan.input));
      return plan.claim;
    } catch (error) {
      if (!canceled(error)) throw error;
      await this.throwReservationConflict({ address, ipHash, tokenHash, now });
      throw new HttpError(503, 'RESERVATION_CONFLICT', 'The faucet is busy. Please try again shortly.', 60);
    }
  }

  async throwReservationConflict({ address, ipHash, tokenHash, now }) {
    const [addressGuard, ipGuard, replay, daily, active] = await Promise.all([
      this.get(itemKey.address(address)),
      this.get(itemKey.ip(ipHash)),
      this.get(itemKey.token(tokenHash)),
      this.get(itemKey.daily(utcDay(now))),
      this.get(itemKey.active()),
    ]);
    const blockedUntil = Math.max(addressGuard?.blockedUntil || 0, ipGuard?.blockedUntil || 0);
    if (blockedUntil > now) {
      throw new HttpError(429, 'COOLDOWN_ACTIVE', 'This address or network has already claimed within the cooldown period.', Math.ceil(blockedUntil - now));
    }
    if (replay?.expiresAt > now) throw new HttpError(400, 'VERIFICATION_REPLAYED', 'Verification has already been used. Please verify again.');
    if ((daily?.claimCount || 0) >= this.config.dailyClaimCap) {
      throw new HttpError(429, 'DAILY_CAP_REACHED', 'The faucet daily distribution limit has been reached.', secondsUntilNextUtcDay(now));
    }
    if (active) throw new HttpError(503, 'FAUCET_BUSY', 'A faucet transaction is still being processed. Please try again shortly.', 60);
  }

  async saveSigned(claim, signed, now) {
    const input = buildSaveSignedPlan({
      tableName: this.tableName, claim, raw: signed.raw, hash: signed.hash,
      signerAddress: signed.signerAddress, now, config: this.config,
    });
    try {
      await this.client.send(new TransactWriteCommand(input));
      return {
        ...claim, status: 'signed', rawTx: signed.raw, txHash: signed.hash,
        signerAddress: signed.signerAddress, signedAt: now, leaseUntil: undefined,
      };
    } catch (error) {
      // A timeout can happen after DynamoDB committed. Only exact, strongly read
      // evidence may authorize broadcasting; every other outcome fails closed.
      try {
        const [stored, lock] = await Promise.all([
          this.get(itemKey.claim(claim.claimId)),
          this.get(itemKey.active()),
        ]);
        if (stored?.status === 'signed' && stored.rawTx === signed.raw && stored.txHash === signed.hash
          && stored.signerAddress === signed.signerAddress
          && lock?.status === 'signed' && lock.ownerClaimId === claim.claimId && lock.txHash === signed.hash) {
          return stored;
        }
      } catch {
        // Keep the original transaction outcome uncertain; never broadcast.
      }
      if (canceled(error)) throw new StateConflictError('Signed transaction was not durably reserved.');
      throw new StateConflictError('DynamoDB did not prove that signed bytes were durably reserved.');
    }
  }

  async fail(claim, expectedStatus, reason, now) {
    const input = buildFailPlan({ tableName: this.tableName, claim, expectedStatus, reason, now, config: this.config });
    try {
      await this.client.send(new TransactWriteCommand(input));
      return true;
    } catch (error) {
      if (canceled(error)) return false;
      throw error;
    }
  }

  async confirm(claim, now) {
    const input = buildConfirmPlan({ tableName: this.tableName, claim, now, config: this.config });
    try {
      await this.client.send(new TransactWriteCommand(input));
      return true;
    } catch (error) {
      if (canceled(error)) return false;
      throw error;
    }
  }
}
