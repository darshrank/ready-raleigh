// npm run sol:collection -w server: creates the soulbound card collection on devnet (once) and
// prints the SOLANA_CARD_COLLECTION line for .env. Permanent Freeze Delegate, frozen, no authority:
// no card in it can ever be transferred.
import { loadAuthority } from '../src/solana/chain';
import { createCardCollection, umiFor } from '../src/cards/mint';
import { publicBase } from '../src/cards/cards';

if (process.env.SOLANA_CARD_COLLECTION) {
  console.log(`SOLANA_CARD_COLLECTION is already set (${process.env.SOLANA_CARD_COLLECTION}); remove it to create a new one.`);
  process.exit(0);
}
const { key, reason } = loadAuthority();
if (!key) throw new Error(reason);
const umi = umiFor(key, process.env.SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com');
const { address, signature } = await createCardCollection(umi, 'Mayday Mayor Civic Cards', `${publicBase()}/api/cards/collection.json`);
console.log(`Created on devnet: https://explorer.solana.com/address/${address}?cluster=devnet (tx ${signature})`);
console.log(`Add to .env:\nSOLANA_CARD_COLLECTION=${address}`);
