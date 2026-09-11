export const ACTIVE_LOCK_KEY = 'LOCK#ACTIVE';

export const itemKey = Object.freeze({
  active: () => ({ pk: ACTIVE_LOCK_KEY }),
  address: address => ({ pk: `COOLDOWN#ADDRESS#${address.toLowerCase()}` }),
  ip: ipHash => ({ pk: `COOLDOWN#IP#${ipHash}` }),
  token: tokenHash => ({ pk: `REPLAY#TURNSTILE#${tokenHash}` }),
  daily: day => ({ pk: `CAP#DAY#${day}` }),
  claim: claimId => ({ pk: `CLAIM#${claimId}` }),
});

export function utcDay(now) {
  return new Date(now * 1000).toISOString().slice(0, 10);
}

export function secondsUntilNextUtcDay(now) {
  const date = new Date(now * 1000);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) / 1000;
  return Math.max(1, Math.ceil(next - now));
}

function terminalExpiry(now, config) {
  return now + config.claimRetentionSeconds;
}

function guardExpiry(blockedUntil) {
  return blockedUntil + 3600;
}

export function buildReservePlan({ tableName, claimId, address, ipHash, tokenHash, now, config }) {
  const day = utcDay(now);
  const leaseUntil = now + config.preparingLeaseSeconds;
  const blockedUntil = now + config.cooldownSeconds;
  const claim = {
    ...itemKey.claim(claimId),
    entity: 'claim',
    claimId,
    address,
    ipHash,
    tokenHash,
    day,
    status: 'preparing',
    createdAt: now,
    leaseUntil,
  };
  return {
    claim,
    input: {
      ClientRequestToken: claimId,
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: {
              ...itemKey.active(), entity: 'active_lock', ownerClaimId: claimId,
              status: 'preparing', createdAt: now, updatedAt: now, leaseUntil,
            },
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: {
              ...itemKey.address(address), entity: 'cooldown_address', ownerClaimId: claimId,
              blockedUntil, expiresAt: guardExpiry(blockedUntil),
            },
            ConditionExpression: 'attribute_not_exists(pk) OR blockedUntil <= :now',
            ExpressionAttributeValues: { ':now': now },
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: {
              ...itemKey.ip(ipHash), entity: 'cooldown_ip', ownerClaimId: claimId,
              blockedUntil, expiresAt: guardExpiry(blockedUntil),
            },
            ConditionExpression: 'attribute_not_exists(pk) OR blockedUntil <= :now',
            ExpressionAttributeValues: { ':now': now },
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: {
              ...itemKey.token(tokenHash), entity: 'turnstile_replay', createdAt: now,
              expiresAt: now + config.tokenReplaySeconds,
            },
            ConditionExpression: 'attribute_not_exists(pk) OR expiresAt <= :now',
            ExpressionAttributeValues: { ':now': now },
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: itemKey.daily(day),
            UpdateExpression: 'SET #entity = if_not_exists(#entity, :entity), #day = :day, updatedAt = :now ADD claimCount :one',
            ConditionExpression: 'attribute_not_exists(claimCount) OR claimCount < :cap',
            ExpressionAttributeNames: { '#entity': 'entity', '#day': 'day' },
            ExpressionAttributeValues: { ':entity': 'daily_cap', ':day': day, ':now': now, ':one': 1, ':cap': config.dailyClaimCap },
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: claim,
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
      ],
    },
  };
}

export function buildSaveSignedPlan({ tableName, claim, raw, hash, signerAddress, now, config }) {
  const blockedUntil = now + config.cooldownSeconds;
  const guardNames = { '#owner': 'ownerClaimId' };
  const guardValues = { ':owner': claim.claimId, ':blocked': blockedUntil, ':expires': guardExpiry(blockedUntil) };
  return {
    ClientRequestToken: hash.slice(2, 38),
    TransactItems: [
      {
        Update: {
          TableName: tableName,
          Key: itemKey.claim(claim.claimId),
          UpdateExpression: 'SET #status = :signed, rawTx = :raw, txHash = :hash, signerAddress = :signer, signedAt = :now REMOVE leaseUntil',
          ConditionExpression: '#status = :preparing AND leaseUntil > :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':signed': 'signed', ':preparing': 'preparing', ':raw': raw, ':hash': hash, ':signer': signerAddress, ':now': now },
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: itemKey.active(),
          UpdateExpression: 'SET #status = :signed, txHash = :hash, updatedAt = :now REMOVE leaseUntil',
          ConditionExpression: '#owner = :owner AND #status = :preparing AND leaseUntil > :now',
          ExpressionAttributeNames: { '#owner': 'ownerClaimId', '#status': 'status' },
          ExpressionAttributeValues: { ':owner': claim.claimId, ':signed': 'signed', ':preparing': 'preparing', ':hash': hash, ':now': now },
        },
      },
      ...[itemKey.address(claim.address), itemKey.ip(claim.ipHash)].map(Key => ({
        Update: {
          TableName: tableName,
          Key,
          UpdateExpression: 'SET blockedUntil = :blocked, expiresAt = :expires',
          ConditionExpression: '#owner = :owner',
          ExpressionAttributeNames: guardNames,
          ExpressionAttributeValues: guardValues,
        },
      })),
    ],
  };
}

export function buildFailPlan({ tableName, claim, expectedStatus, reason, now, config }) {
  return {
    TransactItems: [
      {
        Update: {
          TableName: tableName,
          Key: itemKey.claim(claim.claimId),
          UpdateExpression: 'SET #status = :failed, completedAt = :now, failureCode = :reason, expiresAt = :expires REMOVE rawTx, leaseUntil',
          ConditionExpression: '#status = :expected',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':failed': 'failed', ':expected': expectedStatus, ':now': now,
            ':reason': reason, ':expires': terminalExpiry(now, config),
          },
        },
      },
      {
        Delete: {
          TableName: tableName,
          Key: itemKey.active(),
          ConditionExpression: '#owner = :owner AND #status = :expected',
          ExpressionAttributeNames: { '#owner': 'ownerClaimId', '#status': 'status' },
          ExpressionAttributeValues: { ':owner': claim.claimId, ':expected': expectedStatus },
        },
      },
      ...[itemKey.address(claim.address), itemKey.ip(claim.ipHash)].map(Key => ({
        Delete: {
          TableName: tableName,
          Key,
          ConditionExpression: 'attribute_not_exists(pk) OR #owner = :owner',
          ExpressionAttributeNames: { '#owner': 'ownerClaimId' },
          ExpressionAttributeValues: { ':owner': claim.claimId },
        },
      })),
      {
        Update: {
          TableName: tableName,
          Key: itemKey.daily(claim.day),
          UpdateExpression: 'SET updatedAt = :now ADD claimCount :minusOne',
          ConditionExpression: 'claimCount > :zero',
          ExpressionAttributeValues: { ':now': now, ':minusOne': -1, ':zero': 0 },
        },
      },
    ],
  };
}

export function buildConfirmPlan({ tableName, claim, now, config }) {
  const blockedUntil = now + config.cooldownSeconds;
  return {
    TransactItems: [
      {
        Update: {
          TableName: tableName,
          Key: itemKey.claim(claim.claimId),
          UpdateExpression: 'SET #status = :confirmed, completedAt = :now, expiresAt = :expires REMOVE rawTx',
          ConditionExpression: '#status = :signed AND txHash = :hash',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':confirmed': 'confirmed', ':signed': 'signed', ':hash': claim.txHash,
            ':now': now, ':expires': terminalExpiry(now, config),
          },
        },
      },
      {
        Delete: {
          TableName: tableName,
          Key: itemKey.active(),
          ConditionExpression: '#owner = :owner AND #status = :signed AND txHash = :hash',
          ExpressionAttributeNames: { '#owner': 'ownerClaimId', '#status': 'status' },
          ExpressionAttributeValues: { ':owner': claim.claimId, ':signed': 'signed', ':hash': claim.txHash },
        },
      },
      ...[
        [itemKey.address(claim.address), 'cooldown_address'],
        [itemKey.ip(claim.ipHash), 'cooldown_ip'],
      ].map(([Key, entity]) => ({
        Update: {
          TableName: tableName,
          Key,
          UpdateExpression: 'SET #entity = :entity, #owner = :owner, blockedUntil = :blocked, expiresAt = :expires',
          ConditionExpression: 'attribute_not_exists(pk) OR #owner = :owner',
          ExpressionAttributeNames: { '#entity': 'entity', '#owner': 'ownerClaimId' },
          ExpressionAttributeValues: {
            ':entity': entity, ':owner': claim.claimId,
            ':blocked': blockedUntil, ':expires': guardExpiry(blockedUntil),
          },
        },
      })),
    ],
  };
}
