// Solana devnet: the team key acts as the "local government" that writes the civic record
// (docs/SOLANA.md: "Demo authority (simulated), not the City of Raleigh"). Memo transactions via
// @solana/web3.js v1, the same Memo approach as Adit's backend/app/proof.py.
// SOLANA_PAYER_SECRET_KEY: the 64-byte secret key as a JSON array (solana-keygen's file format).
// SOLANA_ENABLED=false turns the chain off; without a key it is off too, and the record stays local.
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

export const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const CLUSTER = 'devnet';
const DEFAULT_RPC = 'https://api.devnet.solana.com';
const SEND_TIMEOUT_MS = 45_000;

export interface Chain {
  /** The authority's address. */
  readonly address: string;
  readonly rpcUrl: string;
  /** Writes `text` in a Memo transaction; resolves when it is confirmed. */
  memo(text: string): Promise<{ signature: string; slot: number }>;
  balanceSol(): Promise<number>;
}

export const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
export const explorerAddress = (address: string) => `https://explorer.solana.com/address/${address}?cluster=${CLUSTER}`;

/** The authority keypair from the environment, or null (with the reason) when the chain is off. */
export function loadAuthority(env = process.env): { key: Keypair | null; reason: string } {
  if (env.SOLANA_ENABLED === 'false') return { key: null, reason: 'SOLANA_ENABLED=false' };
  const raw = env.SOLANA_PAYER_SECRET_KEY?.trim();
  if (!raw) return { key: null, reason: 'SOLANA_PAYER_SECRET_KEY is not set' };
  try {
    const bytes = JSON.parse(raw) as number[];
    if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error('expected a JSON array of 64 numbers');
    return { key: Keypair.fromSecretKey(Uint8Array.from(bytes)), reason: '' };
  } catch (err) {
    return { key: null, reason: `SOLANA_PAYER_SECRET_KEY is not a usable key (${(err as Error).message})` };
  }
}

export function devnetChain(key: Keypair, rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC): Chain {
  const connection = new Connection(rpcUrl, 'confirmed');
  return {
    address: key.publicKey.toBase58(),
    rpcUrl,
    async memo(text) {
      const tx = new Transaction().add(new TransactionInstruction({
        programId: MEMO_PROGRAM,
        keys: [{ pubkey: key.publicKey, isSigner: true, isWritable: false }],
        data: Buffer.from(text, 'utf8'),
      }));
      const signature = await Promise.race([
        sendAndConfirmTransaction(connection, tx, [key], { commitment: 'confirmed' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Solana did not confirm in time')), SEND_TIMEOUT_MS).unref()),
      ]);
      const status = await connection.getSignatureStatus(signature);
      return { signature, slot: status.value?.slot ?? 0 };
    },
    async balanceSol() {
      return (await connection.getBalance(key.publicKey)) / 1e9;
    },
  };
}
