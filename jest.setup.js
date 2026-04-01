// Polyfill structuredClone for Jest environment (Expo SDK 54 compatibility)
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
