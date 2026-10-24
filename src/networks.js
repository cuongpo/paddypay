import { foundry, kairos } from 'viem/chains';

// Chains the seeded demo can run on. Kairos is public, so its transactions get explorer links.
export const NETWORKS = {
  anvil: { chain: foundry, label: 'local Anvil', explorer: null },
  kairos: { chain: kairos, label: 'Kaia Kairos testnet', explorer: 'https://kairos.kaiascan.io' },
};
export function network(name) {
  const n = NETWORKS[name];
  if (!n) throw new Error(`Unknown network "${name}". Use one of: ${Object.keys(NETWORKS).join(', ')}`);
  return n;
}
