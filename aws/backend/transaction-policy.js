function bigint(value, name, { allowZero = false } = {}) {
  if (typeof value !== 'bigint' || value < 0n || (!allowZero && value === 0n)) throw new Error(`Prepared transaction is missing a valid ${name}.`);
  return value;
}

export function assertTransferEnvelope(transaction, { chainId, tokenAddress, expectedData }) {
  if (transaction.chainId !== chainId) throw new Error('Prepared transaction has an unexpected chain ID.');
  if (typeof transaction.to !== 'string' || transaction.to.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error('Prepared transaction has an unexpected destination.');
  }
  if ((transaction.value ?? 0n) !== 0n) throw new Error('Prepared transaction must not transfer native currency.');
  if (typeof transaction.data !== 'string' || transaction.data.toLowerCase() !== expectedData.toLowerCase()) {
    throw new Error('Prepared transaction calldata does not match the configured ERC-20 transfer.');
  }
}

export function assertFeePolicy(transaction, config) {
  const gas = bigint(transaction.gas, 'gas limit');
  if (gas > config.maxGasLimit) throw new Error('Prepared transaction gas limit exceeds the configured maximum.');

  const hasLegacy = transaction.gasPrice !== undefined && transaction.gasPrice !== null;
  const hasDynamic = transaction.maxFeePerGas !== undefined || transaction.maxPriorityFeePerGas !== undefined;
  if (hasLegacy === hasDynamic) throw new Error('Prepared transaction has an unsupported fee shape.');

  let feePerGas;
  if (hasLegacy) {
    feePerGas = bigint(transaction.gasPrice, 'gas price');
    if (feePerGas > config.maxFeePerGas) throw new Error('Prepared transaction gas price exceeds the configured maximum.');
  } else {
    feePerGas = bigint(transaction.maxFeePerGas, 'maximum fee per gas');
    const priority = bigint(transaction.maxPriorityFeePerGas, 'maximum priority fee per gas', { allowZero: true });
    if (priority > feePerGas) throw new Error('Prepared transaction priority fee exceeds its maximum fee.');
    if (feePerGas > config.maxFeePerGas || priority > config.maxPriorityFeePerGas) {
      throw new Error('Prepared transaction fee exceeds a configured maximum.');
    }
  }
  const maximumCost = gas * feePerGas;
  if (maximumCost > config.maxTotalFee) throw new Error('Prepared transaction maximum fee exceeds the configured total.');
  return maximumCost;
}
