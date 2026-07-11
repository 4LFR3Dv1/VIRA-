import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import * as anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

const CONFIG = {
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    txlTokenMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
    defaultServiceLevelId: 12,
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    apiOrigin: "https://txline-dev.txodds.com",
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlTokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
    defaultServiceLevelId: 1,
  },
};

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
    } else {
      args.set(key, next);
      index += 1;
    }
  }
  return args;
}

function readOrCreateWallet(walletPath) {
  if (fs.existsSync(walletPath)) {
    const raw = JSON.parse(fs.readFileSync(walletPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }

  fs.mkdirSync(path.dirname(walletPath), { recursive: true });
  const keypair = Keypair.generate();
  fs.writeFileSync(walletPath, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

function createAnchorWallet(keypair) {
  return {
    publicKey: keypair.publicKey,
    payer: keypair,
    signTransaction: async (transaction) => {
      transaction.partialSign(keypair);
      return transaction;
    },
    signAllTransactions: async (transactions) => {
      for (const transaction of transactions) transaction.partialSign(keypair);
      return transactions;
    },
    signMessage: async (message) => nacl.sign.detached(message, keypair.secretKey),
  };
}

async function ensureBalance({ connection, publicKey, network, minimumSol, airdropSol }) {
  const balance = await connection.getBalance(publicKey, "confirmed");
  if (balance >= minimumSol * LAMPORTS_PER_SOL) return balance;

  if (network !== "devnet") {
    throw new Error(`Wallet ${publicKey.toBase58()} needs SOL for mainnet transaction fees.`);
  }

  const signature = await connection.requestAirdrop(publicKey, Math.ceil(airdropSol * LAMPORTS_PER_SOL));
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
  return connection.getBalance(publicKey, "confirmed");
}

async function ensureTokenAccount({ connection, payer, associatedTokenAccount, mint, owner }) {
  const existing = await connection.getAccountInfo(associatedTokenAccount, "confirmed");
  if (existing) return null;

  const transaction = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      associatedTokenAccount,
      owner,
      mint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
  return sendAndConfirmTransaction(connection, transaction, [payer], { commitment: "confirmed" });
}

async function fetchJson(url, init = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": "VIRA-Hackathon/1.0",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    return fetchJsonWithCurl(url, init, cause);
  }
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const error = new Error(`request_failed:${response.status}:${url}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function fetchJsonWithCurl(url, init = {}, originalCause = null) {
  const method = init.method || (init.body ? "POST" : "GET");
  const args = [
    "-sS",
    "--http1.1",
    "--retry",
    "5",
    "--retry-delay",
    "1",
    "--retry-all-errors",
    "-X",
    method,
    url,
    "-H",
    "User-Agent: VIRA-Hackathon/1.0",
    "-H",
    "Accept: application/json",
    "-w",
    "\n%{http_code}",
  ];

  for (const [key, value] of Object.entries(init.headers ?? {})) {
    args.push("-H", `${key}: ${value}`);
  }
  if (init.body) {
    args.push("--data", init.body);
  }

  const result = spawnSync("curl.exe", args, { encoding: "utf8" });
  if (result.error) {
    const error = new Error(`fetch_failed:${url}:${originalCause?.message ?? result.error.message}`);
    error.cause = originalCause ?? result.error;
    throw error;
  }
  if (result.status !== 0) {
    const error = new Error(`curl_failed:${url}:${result.stderr || result.stdout}`);
    error.cause = originalCause;
    throw error;
  }

  const output = result.stdout.trimEnd();
  const statusMatch = output.match(/\n(\d{3})$/);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const text = statusMatch ? output.slice(0, statusMatch.index) : output;
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (status < 200 || status >= 300) {
    const error = new Error(`request_failed:${status}:${url}`);
    error.status = status;
    error.body = body;
    error.cause = originalCause;
    throw error;
  }
  return body;
}

function normalizeApiToken(body) {
  if (typeof body === "string") return body;
  if (body?.token) return body.token;
  if (body?.apiToken) return body.apiToken;
  if (body?.data?.token) return body.data.token;
  throw new Error("Could not find API token in activation response.");
}

function normalizeJwt(body) {
  if (typeof body === "string") return body;
  if (body?.token) return body.token;
  if (body?.jwt) return body.jwt;
  if (body?.accessToken) return body.accessToken;
  throw new Error("Could not find guest JWT in auth response.");
}

function updateEnvFile(envPath, values) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const next = [];
  const pending = new Map(Object.entries(values));

  for (const line of existing) {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !pending.has(match[1])) {
      next.push(line);
      continue;
    }
    next.push(`${match[1]}=${pending.get(match[1])}`);
    pending.delete(match[1]);
  }

  for (const [key, value] of pending) next.push(`${key}=${value}`);
  fs.writeFileSync(envPath, `${next.filter((line, index, lines) => line || index < lines.length - 1).join("\n")}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const network = args.get("network") || process.env.TXLINE_NETWORK || "devnet";
  if (!CONFIG[network]) throw new Error(`Unsupported network: ${network}`);

  const config = CONFIG[network];
  const serviceLevelId = Number(args.get("service-level") || process.env.TXLINE_SERVICE_LEVEL_ID || config.defaultServiceLevelId);
  const durationWeeks = Number(args.get("duration-weeks") || process.env.TXLINE_DURATION_WEEKS || 4);
  const airdropSol = Number(args.get("airdrop-sol") || process.env.TXLINE_AIRDROP_SOL || 0.05);
  const selectedLeagues = [];
  const workspaceRoot = process.cwd();
  const walletPath = path.resolve(workspaceRoot, ".txline", `wallet-${network}.json`);
  const envPath = path.resolve(workspaceRoot, ".env");

  const connection = new Connection(config.rpcUrl, "confirmed");
  const keypair = readOrCreateWallet(walletPath);
  const wallet = createAnchorWallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const programId = new PublicKey(config.programId);
  const txlTokenMint = new PublicKey(config.txlTokenMint);

  console.log(`TxLINE setup network=${network}`);
  console.log(`Wallet=${keypair.publicKey.toBase58()}`);
  console.log(`Wallet file=${walletPath}`);

  const balance = await ensureBalance({
    connection,
    publicKey: keypair.publicKey,
    network,
    minimumSol: 0.02,
    airdropSol,
  });
  console.log(`Balance=${balance / LAMPORTS_PER_SOL} SOL`);

  console.log("Starting TxLINE guest session...");
  const authBody = await fetchJson(`${config.apiOrigin}/auth/guest/start`, { method: "POST" });
  const jwt = normalizeJwt(authBody);

  console.log("Fetching Anchor IDL from chain...");
  const idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) throw new Error(`Could not fetch Anchor IDL for ${programId.toBase58()}`);
  idl.address = idl.address || programId.toBase58();
  const program = new anchor.Program(idl, provider);

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], programId);
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], programId);
  const userTokenAccount = getAssociatedTokenAddressSync(
    txlTokenMint,
    keypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const tokenAccountTx = await ensureTokenAccount({
    connection,
    payer: keypair,
    associatedTokenAccount: userTokenAccount,
    mint: txlTokenMint,
    owner: keypair.publicKey,
  });
  if (tokenAccountTx) console.log(`Created user token account=${tokenAccountTx}`);

  let txSig = args.get("tx-sig") || process.env.TXLINE_SUBSCRIPTION_TX || "";
  if (txSig) {
    console.log(`Using existing subscription transaction=${txSig}`);
  } else {
    console.log(`Subscribing serviceLevel=${serviceLevelId} durationWeeks=${durationWeeks}...`);
    txSig = await program.methods
      .subscribe(serviceLevelId, durationWeeks)
      .accounts({
        user: keypair.publicKey,
        pricingMatrix: pricingMatrixPda,
        tokenMint: txlTokenMint,
        userTokenAccount,
        tokenTreasuryVault,
        tokenTreasuryPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`Subscription transaction=${txSig}`);
  }

  const messageString = `${txSig}:${selectedLeagues.join(",")}:${jwt}`;
  const message = new TextEncoder().encode(messageString);
  const walletSignature = Buffer.from(await wallet.signMessage(message)).toString("base64");

  console.log("Activating TxLINE API token...");
  const activationBody = await fetchJson(`${config.apiOrigin}/api/token/activate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      txSig,
      walletSignature,
      leagues: selectedLeagues,
    }),
  });
  const apiToken = normalizeApiToken(activationBody);

  updateEnvFile(envPath, {
    TXLINE_NETWORK: network,
    TXLINE_JWT: jwt,
    TXLINE_API_TOKEN: apiToken,
    TXLINE_WALLET_ADDRESS: keypair.publicKey.toBase58(),
    TXLINE_SERVICE_LEVEL_ID: String(serviceLevelId),
    TXLINE_SUBSCRIPTION_TX: txSig,
  });

  console.log("Testing fixtures snapshot...");
  const fixtures = await fetchJson(`${config.apiOrigin}/api/fixtures/snapshot`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Api-Token": apiToken,
      Accept: "application/json",
    },
  });
  const fixtureCount = Array.isArray(fixtures) ? fixtures.length : Object.keys(fixtures ?? {}).length;
  console.log(`Setup complete. Fixtures payload entries=${fixtureCount}`);
  console.log(`Updated ${envPath}`);
}

main().catch((error) => {
  console.error(error.message);
  if (error.cause) console.error(error.cause);
  if (error.body) console.error(JSON.stringify(error.body, null, 2));
  process.exitCode = 1;
});
