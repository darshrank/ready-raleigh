// Minting contribution cards (P16): Metaplex Core assets in one collection whose Permanent Freeze
// Delegate is frozen with no authority, so every card is soulbound (non-transferable) for good.
// The team key (the demo "local government") pays and is the collection's update authority.
// Collection address: SOLANA_CARD_COLLECTION, created once with `npm run sol:collection -w server`.
import {
  create, createCollection, fetchAsset, fetchCollection, mplCore,
} from '@metaplex-foundation/mpl-core';
import { type Umi, generateSigner, keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';
import type { Keypair } from '@solana/web3.js';

export interface MintRequest {
  name: string;
  /** Metadata JSON (name, description, image, attributes). */
  uri: string;
  owner: string;
  attributes: { key: string; value: string }[];
}

export interface Minter {
  readonly collection: string;
  mint(req: MintRequest): Promise<{ asset: string; signature: string }>;
}

export function umiFor(key: Keypair, rpcUrl: string): Umi {
  const umi = createUmi(rpcUrl, { commitment: 'confirmed' }).use(mplCore());
  return umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(key.secretKey)));
}

/** A wallet address the chain accepts, or null. */
export function walletAddress(input: unknown): string | null {
  if (typeof input !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.trim())) return null;
  try {
    return publicKey(input.trim()).toString();
  } catch {
    return null;
  }
}

/** Creates the soulbound collection (once). Returns its address. */
export async function createCardCollection(umi: Umi, name: string, uri: string): Promise<{ address: string; signature: string }> {
  const collection = generateSigner(umi);
  const { signature } = await createCollection(umi, {
    collection,
    name,
    uri,
    plugins: [{ type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'None' } }],
  }).sendAndConfirm(umi);
  return { address: collection.publicKey.toString(), signature: base58.deserialize(signature)[0] };
}

export function coreMinter(umi: Umi, collectionAddress: string): Minter {
  let collection: Awaited<ReturnType<typeof fetchCollection>> | null = null;
  return {
    collection: collectionAddress,
    async mint({ name, uri, owner, attributes }) {
      collection ??= await fetchCollection(umi, collectionAddress);
      const asset = generateSigner(umi);
      const { signature } = await create(umi, {
        asset,
        collection,
        name: name.slice(0, 32),
        uri,
        owner: publicKey(owner),
        plugins: [{ type: 'Attributes', attributeList: attributes.map(({ key, value }) => ({ key: key.slice(0, 32), value: value.slice(0, 64) })) }],
      }).sendAndConfirm(umi);
      return { asset: asset.publicKey.toString(), signature: base58.deserialize(signature)[0] };
    },
  };
}

/** Reads a minted card back from the chain (scripts and checks). */
export const fetchCard = (umi: Umi, address: string) => fetchAsset(umi, address);
