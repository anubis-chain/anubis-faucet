import { recipient } from './config.js';
import { HttpError } from './errors.js';

export function createService({ store, sender, verify }) {
  return {
    async claim(body, ip) {
      const address = recipient(body?.recipientAddress);
      if (!address) throw new HttpError(400, 'Please enter a valid non-zero Ethereum address.');
      await store.expireUnsigned();
      await store.check(address, ip);
      await verify(body.turnstileToken, ip);
      const id = await store.reserve(address, ip, body.turnstileToken);
      let signed;
      try { signed = await sender.prepare(address); }
      catch { await store.failUnsigned(id); throw new HttpError(503, 'The faucet cannot prepare a transfer. Please try again later.'); }
      // Never broadcast unless the compare-and-set saved signed bytes in D1.
      await store.saveSigned(id, signed.raw, signed.hash);
      try { await sender.broadcast(signed.raw); } catch { /* reconciled by cron */ }
      return { status: 'submitted', txHashes: [signed.hash] };
    },
    async settle() {
      await store.expireUnsigned();
      const claim = await store.pending();
      if (!claim?.raw_tx) return;
      const receipt = await sender.receipt(claim.tx_hash, claim.address);
      if (receipt) await store.finish(claim.id, receipt.status === 'success');
      else await sender.broadcast(claim.raw_tx);
    },
  };
}
