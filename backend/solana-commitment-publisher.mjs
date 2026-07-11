import fs from "node:fs";
import path from "node:path";

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function enabledFromEnv() {
  return String(process.env.VIRA_SOLANA_COMMITMENT_ENABLED ?? "false").toLowerCase() === "true";
}

function readKeypair() {
  const inline = process.env.VIRA_SOLANA_KEYPAIR_JSON;
  const filePath = process.env.VIRA_SOLANA_KEYPAIR_PATH
    ? path.resolve(process.env.VIRA_SOLANA_KEYPAIR_PATH)
    : path.resolve(process.cwd(), ".txline", "wallet-devnet.json");
  const raw = inline ? JSON.parse(inline) : JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function createSolanaCommitmentPublisherFromEnv() {
  if (!enabledFromEnv()) {
    return {
      enabled: false,
      network: "unsupported",
      async publish() { throw new Error("solana_commitment_unsupported"); },
    };
  }
  const network = String(process.env.VIRA_SOLANA_NETWORK ?? "devnet");
  if (network !== "devnet") throw new Error("solana_commitment_devnet_required");
  const rpcUrl = String(process.env.VIRA_SOLANA_RPC_URL ?? "https://api.devnet.solana.com");
  const payer = readKeypair();
  const connection = new Connection(rpcUrl, "confirmed");
  async function readConfirmedTransaction(signature) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const transaction = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (transaction) return transaction;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    return null;
  }
  return {
    enabled: true,
    network,
    authority: payer.publicKey.toBase58(),
    rpcUrl,
    async publish(commitment) {
      const memo = `${commitment.payload.domain}|${commitment.payload.roundIdHash}|${commitment.commitmentHash}`;
      const instruction = new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(memo, "utf8") });
      const signature = await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [payer], { commitment: "confirmed", maxRetries: 4 });
      const transaction = await readConfirmedTransaction(signature);
      const memoMatched = Boolean(transaction?.transaction?.message?.instructions?.some((item) => {
        if (!("parsed" in item)) return false;
        return String(item.parsed).includes(commitment.commitmentHash) && String(item.parsed).includes(commitment.payload.roundIdHash);
      }));
      if (!memoMatched) throw new Error("solana_commitment_memo_mismatch");
      return {
        network,
        signature,
        slot: transaction?.slot ?? null,
        authority: payer.publicKey.toBase58(),
        onChainCommitmentHash: commitment.commitmentHash,
        onChainMatches: true,
        confirmedAt: new Date().toISOString(),
        explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      };
    },
  };
}
