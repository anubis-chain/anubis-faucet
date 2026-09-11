import { createHash, randomUUID } from 'node:crypto';
import { normalizeRecipient } from './address.js';
import { HttpError, StateConflictError } from './errors.js';
import { hashIpIdentity, normalizeSourceIp } from './ip.js';

function tokenDigest(token) {
  return createHash('sha256').update(`faucet-turnstile-v1\0${token}`).digest('hex');
}

export function createFaucetService({
  config,
  store,
  secrets,
  verifier,
  sender,
  logger,
  now = () => Math.floor(Date.now() / 1000),
  uuid = randomUUID,
}) {
  return {
    async health() {
      const [, secret] = await Promise.all([store.health(), secrets.get()]);
      const senderInfo = await sender.health(secret.privateKey);
      return { ok: true, enabled: config.faucetEnabled, ...senderInfo };
    },

    async claim(body, sourceIp) {
      if (!config.faucetEnabled) {
        throw new HttpError(503, 'FAUCET_DISABLED', 'The faucet is temporarily disabled.', 300);
      }
      const address = normalizeRecipient(body?.recipientAddress);
      if (!address) throw new HttpError(400, 'INVALID_RECIPIENT', 'Please enter a valid non-zero EVM address.');

      await store.expirePreparing(now());
      const normalizedIp = normalizeSourceIp(sourceIp);
      const secret = await secrets.get();
      await verifier.verify(body?.turnstileToken, normalizedIp.verificationIp, secret.turnstileSecret);

      const time = now();
      const claim = await store.reserve({
        claimId: uuid(),
        address,
        ipHash: hashIpIdentity(normalizedIp.rateLimitIdentity, secret.ipPepper),
        tokenHash: tokenDigest(body.turnstileToken),
        now: time,
      });

      let signed;
      try {
        signed = await sender.prepare(address, secret.privateKey);
      } catch {
        const released = await store.fail(claim, 'preparing', 'PREPARE_FAILED', now());
        logger.error('claim_prepare_failed', { claimId: claim.claimId, outcome: released ? 'released' : 'state_conflict' });
        throw new HttpError(503, 'TRANSFER_PREPARATION_FAILED', 'The faucet cannot prepare a transfer. Please try again later.');
      }

      let stored;
      try {
        stored = await store.saveSigned(claim, signed, now());
      } catch (error) {
        logger.error('signed_transaction_not_proven', { claimId: claim.claimId, code: error?.code || 'STATE_UNKNOWN' });
        throw new HttpError(503, 'SIGNING_STATE_UNCERTAIN', 'The faucet could not safely submit the transfer. Please try again later.');
      }

      try {
        await sender.broadcast(stored.rawTx, {
          hash: stored.txHash,
          recipient: stored.address,
          signerAddress: stored.signerAddress,
        });
      } catch {
        // The exact signed bytes are durable. EventBridge will safely replay only
        // these bytes; never create a replacement transaction here.
        logger.warn('broadcast_deferred', { claimId: stored.claimId, txHash: stored.txHash, outcome: 'reconcile' });
      }
      logger.info('claim_submitted', { claimId: stored.claimId, txHash: stored.txHash, status: 'signed' });
      return { status: 'submitted', txHashes: [stored.txHash] };
    },
  };
}

export function createReconcileService({ store, sender, logger, now = () => Math.floor(Date.now() / 1000) }) {
  return {
    async run() {
      const time = now();
      if (await store.expirePreparing(time)) {
        logger.warn('expired_preparing_released', { outcome: 'released' });
      }
      const claim = await store.activeClaim();
      if (!claim) return { status: 'idle' };
      if (claim.status === 'preparing') return { status: 'preparing', claimId: claim.claimId };
      if (claim.status !== 'signed' || !claim.rawTx || !claim.txHash || !claim.signerAddress) {
        throw new StateConflictError('Active claim is not safely reconcilable.');
      }

      const receipt = await sender.receipt(claim);
      if (!receipt) {
        await sender.broadcast(claim.rawTx, {
          hash: claim.txHash,
          recipient: claim.address,
          signerAddress: claim.signerAddress,
        });
        logger.info('signed_transaction_rebroadcast', { claimId: claim.claimId, txHash: claim.txHash, status: 'signed' });
        return { status: 'rebroadcast', claimId: claim.claimId };
      }
      if (receipt.status === 'included') return { status: 'confirming', claimId: claim.claimId };
      if (receipt.status === 'reverted') {
        if (!await store.fail(claim, 'signed', 'TRANSACTION_REVERTED', now())) throw new StateConflictError();
        logger.warn('claim_reverted', { claimId: claim.claimId, txHash: claim.txHash, status: 'failed' });
        return { status: 'failed', claimId: claim.claimId };
      }
      if (receipt.status !== 'success') throw new Error('Unsupported receipt result.');
      if (!await store.confirm(claim, now())) throw new StateConflictError();
      logger.info('claim_confirmed', { claimId: claim.claimId, txHash: claim.txHash, status: 'confirmed' });
      return { status: 'confirmed', claimId: claim.claimId };
    },
  };
}
