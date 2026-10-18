// Blocks every network call made through fetch while tests run, and counts the attempts.
// Import this first in any test that loads generated or runtime code.
export const networkAttempts = [];

const blocked = async (url) => {
  networkAttempts.push(String(url));
  throw new Error(`network blocked in tests: ${url}`);
};

globalThis.fetch = blocked;

export function assertNoNetwork() {
  if (globalThis.fetch !== blocked) throw new Error('global fetch is no longer the blocking stub');
  if (networkAttempts.length) throw new Error(`network attempted: ${networkAttempts.join(', ')}`);
}

// Replace fetch for one test with a local stub (never the network), then restore the blocker.
export async function withFetch(stub, fn) {
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = blocked;
  }
}
