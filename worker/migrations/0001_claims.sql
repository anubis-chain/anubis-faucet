CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  ip TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  lease_until INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'signed', 'confirmed', 'failed')),
  raw_tx TEXT,
  tx_hash TEXT
);
CREATE INDEX claims_address ON claims(address, status, completed_at, created_at);
CREATE INDEX claims_ip ON claims(ip, status, completed_at, created_at);
-- Shared global signing slot, enforced in D1 across all Worker isolates.
CREATE UNIQUE INDEX one_active_claim ON claims((1)) WHERE status IN ('preparing', 'signed');
