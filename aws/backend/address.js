export function normalizeRecipient(value) {
  if (typeof value !== 'string' || !/^0x[\da-f]{40}$/i.test(value) || /^0x0{40}$/i.test(value)) return null;
  return value.toLowerCase();
}
