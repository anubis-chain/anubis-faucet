import { HttpError } from './errors.js';

export class ClaimStore {
  constructor(db, cooldownMs, now = Date.now) {
    this.db = db.withSession('first-primary');
    this.now = now;
    this.cooldownMs = cooldownMs;
  }
  async expireUnsigned() {
    await this.db.prepare("UPDATE claims SET status='failed' WHERE status='preparing' AND lease_until<=?").bind(this.now()).run();
  }
  async check(address, ip) {
    const previous = await this.db.prepare(`SELECT MAX(COALESCE(completed_at, created_at)) AS time FROM claims
      WHERE (address=? OR ip=?) AND status!='failed'`).bind(address, ip).first();
    if (previous.time !== null && previous.time + this.cooldownMs > this.now()) {
      throw new HttpError(429, 'This address or IP has already claimed within the cooldown period.', Math.ceil((previous.time + this.cooldownMs - this.now()) / 1000));
    }
    if (await this.pending()) throw new HttpError(503, 'A faucet transaction is still being processed. Please try again shortly.', 60);
  }
  async reserve(address, ip, token) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    const id = crypto.randomUUID();
    const now = this.now();
    // One conditional INSERT, not a separate SELECT then INSERT. D1 serializes
    // writes; the eligibility predicate and reservation happen atomically.
    const row = await this.db.prepare(`INSERT INTO claims(id,address,ip,token_hash,created_at,lease_until,status)
      SELECT ?,?,?,?,?,?,'preparing'
      WHERE NOT EXISTS (SELECT 1 FROM claims WHERE status IN ('preparing','signed'))
      AND NOT EXISTS (SELECT 1 FROM claims WHERE (address=? OR ip=?) AND status!='failed' AND COALESCE(completed_at,created_at)>?)
      AND NOT EXISTS (SELECT 1 FROM claims WHERE token_hash=?) RETURNING id`)
      .bind(id, address, ip, tokenHash, now, now + 300000, address, ip, now - this.cooldownMs, tokenHash).first();
    if (!row) {
      await this.check(address, ip);
      throw new HttpError(400, 'Verification has already been used. Please verify again.');
    }
    return id;
  }
  async saveSigned(id, raw, hash) {
    const row = await this.db.prepare("UPDATE claims SET raw_tx=?, tx_hash=?, status='signed' WHERE id=? AND status='preparing' AND lease_until>? RETURNING id")
      .bind(raw, hash, id, this.now()).first();
    if (!row) throw new HttpError(503, 'The claim expired before signing completed. Please verify again.');
  }
  async failUnsigned(id) { await this.db.prepare("UPDATE claims SET status='failed' WHERE id=? AND status='preparing'").bind(id).run(); }
  async finish(id, success) {
    await this.db.prepare("UPDATE claims SET status=?, completed_at=?, raw_tx=NULL WHERE id=? AND status='signed'")
      .bind(success ? 'confirmed' : 'failed', this.now(), id).run();
  }
  async pending() { return this.db.prepare("SELECT * FROM claims WHERE status IN ('preparing','signed') LIMIT 1").first(); }
}
