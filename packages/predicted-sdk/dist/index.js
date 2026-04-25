'use strict';

var web3_js = require('@solana/web3.js');
var splToken = require('@solana/spl-token');
var crypto = require('crypto');

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/base-x/src/index.js
var require_src = __commonJS({
  "../../node_modules/base-x/src/index.js"(exports$1, module) {
    function base(ALPHABET) {
      if (ALPHABET.length >= 255) {
        throw new TypeError("Alphabet too long");
      }
      var BASE_MAP = new Uint8Array(256);
      for (var j = 0; j < BASE_MAP.length; j++) {
        BASE_MAP[j] = 255;
      }
      for (var i = 0; i < ALPHABET.length; i++) {
        var x = ALPHABET.charAt(i);
        var xc = x.charCodeAt(0);
        if (BASE_MAP[xc] !== 255) {
          throw new TypeError(x + " is ambiguous");
        }
        BASE_MAP[xc] = i;
      }
      var BASE = ALPHABET.length;
      var LEADER = ALPHABET.charAt(0);
      var FACTOR = Math.log(BASE) / Math.log(256);
      var iFACTOR = Math.log(256) / Math.log(BASE);
      function encode(source) {
        if (source instanceof Uint8Array) ; else if (ArrayBuffer.isView(source)) {
          source = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        } else if (Array.isArray(source)) {
          source = Uint8Array.from(source);
        }
        if (!(source instanceof Uint8Array)) {
          throw new TypeError("Expected Uint8Array");
        }
        if (source.length === 0) {
          return "";
        }
        var zeroes = 0;
        var length = 0;
        var pbegin = 0;
        var pend = source.length;
        while (pbegin !== pend && source[pbegin] === 0) {
          pbegin++;
          zeroes++;
        }
        var size = (pend - pbegin) * iFACTOR + 1 >>> 0;
        var b58 = new Uint8Array(size);
        while (pbegin !== pend) {
          var carry = source[pbegin];
          var i2 = 0;
          for (var it1 = size - 1; (carry !== 0 || i2 < length) && it1 !== -1; it1--, i2++) {
            carry += 256 * b58[it1] >>> 0;
            b58[it1] = carry % BASE >>> 0;
            carry = carry / BASE >>> 0;
          }
          if (carry !== 0) {
            throw new Error("Non-zero carry");
          }
          length = i2;
          pbegin++;
        }
        var it2 = size - length;
        while (it2 !== size && b58[it2] === 0) {
          it2++;
        }
        var str = LEADER.repeat(zeroes);
        for (; it2 < size; ++it2) {
          str += ALPHABET.charAt(b58[it2]);
        }
        return str;
      }
      function decodeUnsafe(source) {
        if (typeof source !== "string") {
          throw new TypeError("Expected String");
        }
        if (source.length === 0) {
          return new Uint8Array();
        }
        var psz = 0;
        var zeroes = 0;
        var length = 0;
        while (source[psz] === LEADER) {
          zeroes++;
          psz++;
        }
        var size = (source.length - psz) * FACTOR + 1 >>> 0;
        var b256 = new Uint8Array(size);
        while (source[psz]) {
          var charCode = source.charCodeAt(psz);
          if (charCode > 255) {
            return;
          }
          var carry = BASE_MAP[charCode];
          if (carry === 255) {
            return;
          }
          var i2 = 0;
          for (var it3 = size - 1; (carry !== 0 || i2 < length) && it3 !== -1; it3--, i2++) {
            carry += BASE * b256[it3] >>> 0;
            b256[it3] = carry % 256 >>> 0;
            carry = carry / 256 >>> 0;
          }
          if (carry !== 0) {
            throw new Error("Non-zero carry");
          }
          length = i2;
          psz++;
        }
        var it4 = size - length;
        while (it4 !== size && b256[it4] === 0) {
          it4++;
        }
        var vch = new Uint8Array(zeroes + (size - it4));
        var j2 = zeroes;
        while (it4 !== size) {
          vch[j2++] = b256[it4++];
        }
        return vch;
      }
      function decode(string) {
        var buffer = decodeUnsafe(string);
        if (buffer) {
          return buffer;
        }
        throw new Error("Non-base" + BASE + " character");
      }
      return {
        encode,
        decodeUnsafe,
        decode
      };
    }
    module.exports = base;
  }
});

// ../../node_modules/bs58/index.js
var require_bs58 = __commonJS({
  "../../node_modules/bs58/index.js"(exports$1, module) {
    var basex = require_src();
    var ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    module.exports = basex(ALPHABET);
  }
});

// src/env-apply.ts
function snapshotOmnipairEnv() {
  return {
    nextPublicOmnipair: process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID,
    teamTreasury: process.env.OMNIPAIR_TEAM_TREASURY,
    executeInit: process.env.OMNIPAIR_EXECUTE_INIT
  };
}
function applyOmnipairProgramId(programId) {
  process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID = programId;
}
function withCreateMarketEnv(teamTreasury, fn) {
  const snap = snapshotOmnipairEnv();
  process.env.OMNIPAIR_TEAM_TREASURY = teamTreasury;
  process.env.OMNIPAIR_EXECUTE_INIT = "true";
  return fn().finally(() => {
    if (snap.teamTreasury === void 0) {
      delete process.env.OMNIPAIR_TEAM_TREASURY;
    } else {
      process.env.OMNIPAIR_TEAM_TREASURY = snap.teamTreasury;
    }
    if (snap.executeInit === void 0) {
      delete process.env.OMNIPAIR_EXECUTE_INIT;
    } else {
      process.env.OMNIPAIR_EXECUTE_INIT = snap.executeInit;
    }
  });
}
function anchorDiscriminator(name) {
  return Buffer.from(
    crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)
  );
}
function u64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}
var OMNIPAIR_PROTOCOL_VERSION = 1;
var PAIR_SEED_PREFIX = Buffer.from("gamm_pair", "utf8");
Buffer.from("gamm_position", "utf8");
var RESERVE_VAULT_SEED_PREFIX = Buffer.from("reserve_vault", "utf8");
var COLLATERAL_VAULT_SEED_PREFIX = Buffer.from(
  "collateral_vault",
  "utf8"
);
var FUTARCHY_AUTHORITY_SEED_PREFIX = Buffer.from(
  "futarchy_authority",
  "utf8"
);
var MPL_TOKEN_METADATA_PROGRAM_ID = new web3_js.PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
var TOKEN_2022_PROGRAM_ID = new web3_js.PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
var PAIR_CREATION_FEE_LAMPORTS = 200000000n;
function u16le(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 65535, 0);
  return b;
}
function u64le2(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}
function computeOmnipairParamsHash(input) {
  const chunks = [
    Buffer.from([OMNIPAIR_PROTOCOL_VERSION & 255]),
    u16le(input.swapFeeBps),
    u64le2(input.halfLifeMs),
    u16le(input.fixedCfBps),
    u64le2(input.targetUtilStartBps),
    u64le2(input.targetUtilEndBps),
    u64le2(input.rateHalfLifeMs),
    u64le2(input.minRateBps),
    u64le2(input.maxRateBps)
  ];
  return Buffer.from(crypto.createHash("sha256").update(Buffer.concat(chunks)).digest());
}
var DEFAULT_OMNIPAIR_POOL_PARAMS = {
  swapFeeBps: 30,
  halfLifeMs: 3600000n,
  // 1 hour
  fixedCfBps: 0,
  targetUtilStartBps: 0n,
  targetUtilEndBps: 0n,
  rateHalfLifeMs: 0n,
  minRateBps: 0n,
  maxRateBps: 0n
};

// ../../lib/solana/omnipair-initialize-args.ts
function u16le2(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 65535, 0);
  return b;
}
function u64le3(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
}
function borshOptionU16(v) {
  if (v === void 0) return Buffer.from([0]);
  const o = Buffer.alloc(3);
  o.writeUInt8(1, 0);
  o.writeUInt16LE(v & 65535, 1);
  return o;
}
function borshOptionU64(v) {
  if (v === void 0) return Buffer.from([0]);
  const o = Buffer.alloc(9);
  o.writeUInt8(1, 0);
  o.writeBigUInt64LE(v, 1);
  return o;
}
function borshString(s) {
  const utf8 = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length, 0);
  return Buffer.concat([len, utf8]);
}
function buildInitializeAndBootstrapArgs(params) {
  const { pool } = params;
  const hash = computeOmnipairParamsHash(pool);
  return {
    swapFeeBps: pool.swapFeeBps,
    halfLifeMs: pool.halfLifeMs,
    fixedCfBps: pool.fixedCfBps !== 0 ? pool.fixedCfBps : void 0,
    targetUtilStartBps: pool.targetUtilStartBps !== 0n ? pool.targetUtilStartBps : void 0,
    targetUtilEndBps: pool.targetUtilEndBps !== 0n ? pool.targetUtilEndBps : void 0,
    rateHalfLifeMs: pool.rateHalfLifeMs !== 0n ? pool.rateHalfLifeMs : void 0,
    minRateBps: pool.minRateBps !== 0n ? pool.minRateBps : void 0,
    maxRateBps: pool.maxRateBps !== 0n ? pool.maxRateBps : void 0,
    initialRateBps: params.initialRateBps,
    paramsHash: hash,
    version: params.version,
    amount0In: params.amount0In,
    amount1In: params.amount1In,
    minLiquidityOut: params.minLiquidityOut,
    lpName: params.lpName,
    lpSymbol: params.lpSymbol,
    lpUri: params.lpUri
  };
}
function serializeInitializeAndBootstrapArgs(a) {
  const parts = [
    u16le2(a.swapFeeBps),
    u64le3(a.halfLifeMs),
    borshOptionU16(a.fixedCfBps),
    borshOptionU64(a.targetUtilStartBps),
    borshOptionU64(a.targetUtilEndBps),
    borshOptionU64(a.rateHalfLifeMs),
    borshOptionU64(a.minRateBps),
    borshOptionU64(a.maxRateBps),
    borshOptionU64(a.initialRateBps),
    Buffer.from(a.paramsHash.subarray(0, 32)),
    Buffer.from([a.version & 255]),
    u64le3(a.amount0In),
    u64le3(a.amount1In),
    u64le3(a.minLiquidityOut),
    borshString(a.lpName),
    borshString(a.lpSymbol),
    borshString(a.lpUri)
  ];
  return Buffer.concat(parts);
}
function orderMints(a, b) {
  const cmp = Buffer.compare(a.toBuffer(), b.toBuffer());
  if (cmp === 0) throw new Error("orderMints: identical mint addresses");
  return cmp < 0 ? [a, b] : [b, a];
}
function getPairPDA(programId, token0Mint, token1Mint, paramsHash) {
  return web3_js.PublicKey.findProgramAddressSync(
    [
      PAIR_SEED_PREFIX,
      token0Mint.toBuffer(),
      token1Mint.toBuffer(),
      paramsHash.subarray(0, 32)
    ],
    programId
  );
}
function getReserveVaultPDA(programId, pair, mint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [RESERVE_VAULT_SEED_PREFIX, pair.toBuffer(), mint.toBuffer()],
    programId
  );
}
function getCollateralVaultPDA(programId, pair, mint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [COLLATERAL_VAULT_SEED_PREFIX, pair.toBuffer(), mint.toBuffer()],
    programId
  );
}
function getGlobalFutarchyAuthorityPDA(programId) {
  return web3_js.PublicKey.findProgramAddressSync(
    [FUTARCHY_AUTHORITY_SEED_PREFIX],
    programId
  );
}
var EVENT_AUTHORITY_SEED = Buffer.from("__event_authority", "utf8");
function getEventAuthorityPDA(programId) {
  const [publicKey, bump] = web3_js.PublicKey.findProgramAddressSync(
    [EVENT_AUTHORITY_SEED],
    programId
  );
  return { publicKey, bump };
}
function getLpTokenMetadataPDA(lpMint) {
  const [pda] = web3_js.PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata", "utf8"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      lpMint.toBuffer()
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}
function deriveOmnipairLayout(programId, yesMint, noMint, poolParams = DEFAULT_OMNIPAIR_POOL_PARAMS) {
  const paramsHash = computeOmnipairParamsHash(poolParams);
  const [token0Mint, token1Mint] = orderMints(yesMint, noMint);
  const [pairAddress] = getPairPDA(programId, token0Mint, token1Mint, paramsHash);
  const [reserve0] = getReserveVaultPDA(programId, pairAddress, token0Mint);
  const [reserve1] = getReserveVaultPDA(programId, pairAddress, token1Mint);
  return {
    paramsHash,
    poolParams,
    token0Mint,
    token1Mint,
    pairAddress,
    reserve0Vault: reserve0,
    reserve1Vault: reserve1,
    collateralForMint(mint) {
      return getCollateralVaultPDA(programId, pairAddress, mint)[0];
    }
  };
}

// ../../lib/market/pipeline-errors.ts
var PipelineStageError = class extends Error {
  constructor(stage, message, options) {
    super(message, options?.cause !== void 0 ? { cause: options.cause } : void 0);
    this.stage = stage;
    this.name = "PipelineStageError";
    if (options?.missingProgramId) this.missingProgramId = options.missingProgramId;
  }
};
function isPipelineStageError(e) {
  return e instanceof PipelineStageError;
}
function formatUnknownError(e) {
  if (e instanceof Error) return e.message;
  return String(e);
}
var SYSTEM_NATIVE = "11111111111111111111111111111111";
var VOTE_PROGRAM = "Vote111111111111111111111111111111111111111";
function collectSolanaErrorText(error) {
  const parts = [];
  let cur = error;
  for (let d = 0; d < 10 && cur; d += 1) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const se = cur;
      if (Array.isArray(se.logs)) parts.push(...se.logs);
      if (Array.isArray(se.transactionLogs)) parts.push(...se.transactionLogs);
      cur = cur.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join("\n");
}
function extractMissingProgramIdFromSolanaError(error) {
  if (isPipelineStageError(error) && error.missingProgramId) {
    return error.missingProgramId;
  }
  const blob = collectSolanaErrorText(error);
  const invokePrograms = [];
  const reInvoke = /Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke/gi;
  let m;
  while ((m = reInvoke.exec(blob)) !== null) {
    invokePrograms.push(m[1]);
  }
  if (invokePrograms.length > 0) {
    const last = invokePrograms[invokePrograms.length - 1];
    if (last !== SYSTEM_NATIVE && last !== VOTE_PROGRAM) return last;
    for (let i = invokePrograms.length - 1; i >= 0; i -= 1) {
      const p = invokePrograms[i];
      if (p !== SYSTEM_NATIVE && p !== VOTE_PROGRAM) return p;
    }
  }
  if (/does not exist|unknown program|program.*not found/i.test(blob)) {
    const seen = /* @__PURE__ */ new Set();
    let match;
    const re = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g;
    while ((match = re.exec(blob)) !== null) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        new web3_js.PublicKey(id);
      } catch {
        continue;
      }
      if (id === SYSTEM_NATIVE) continue;
      if (id === splToken.TOKEN_PROGRAM_ID.toBase58()) continue;
      if (id === splToken.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) continue;
      if (id === MPL_TOKEN_METADATA_PROGRAM_ID.toBase58()) continue;
      if (id === TOKEN_2022_PROGRAM_ID.toBase58()) continue;
      return id;
    }
  }
  return void 0;
}
function requireOmnipairProgramId() {
  const raw = process.env.NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID?.trim();
  if (!raw) {
    throw new Error(
      "Set NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID to your deployed Omnipair program on devnet."
    );
  }
  return new web3_js.PublicKey(raw);
}
async function buildOmnipairPreInitializeTransaction(params) {
  const { connection, payer, lpMintKp, createTreasuryWsolAtaIx } = params;
  const mintRent = await connection.getMinimumBalanceForRentExemption(splToken.MINT_SIZE);
  const createLpMintIx = web3_js.SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: lpMintKp.publicKey,
    lamports: mintRent,
    space: splToken.MINT_SIZE,
    programId: splToken.TOKEN_PROGRAM_ID
  });
  const tx = new web3_js.Transaction();
  if (createTreasuryWsolAtaIx) {
    tx.add(createTreasuryWsolAtaIx);
  }
  tx.add(createLpMintIx);
  return tx;
}

// ../../lib/solana/send-transaction.ts
async function sendSignedTransaction({
  connection,
  transaction,
  signTransaction,
  sendOptions
}) {
  const signed = await signTransaction(transaction);
  const raw = signed.serialize();
  const sig = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    ...sendOptions
  });
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight
    },
    "confirmed"
  );
  return sig;
}
async function sendAndConfirmTransactionWithSigners(connection, transaction, signers, commitment = "confirmed") {
  if (signers.length === 0) {
    throw new Error("sendAndConfirmTransactionWithSigners: missing signers");
  }
  transaction.feePayer = signers[0].publicKey;
  const latest = await connection.getLatestBlockhash(commitment);
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(...signers);
  const sig = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false
  });
  await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight
    },
    commitment
  );
  return sig;
}

// ../../lib/solana/tx-metrics.ts
function logLegacyTransactionMetrics(tag, tx) {
  let bytes = 0;
  try {
    bytes = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    }).length;
  } catch {
    bytes = 0;
  }
  console.info(
    `[predicted][tx-metrics] ${tag} instructions=${tx.instructions.length} serializedBytes\u2248${bytes} (limit 1232)`
  );
}
async function logLegacyTransactionMetricsBeforeSend(tag, connection, tx, feePayer) {
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = feePayer;
  tx.recentBlockhash = latest.blockhash;
  logLegacyTransactionMetrics(tag, tx);
}

// ../../lib/solana/init-omnipair-market.ts
var IX_NAME = "initialize";
var WSOL_MINT = splToken.NATIVE_MINT;
function buildOmnipairLpTokenMetadata(token0Mint, token1Mint) {
  const t0 = token0Mint.toBase58();
  const t1 = token1Mint.toBase58();
  const lpName = `${t0.slice(0, 8)}/${t1.slice(0, 7)} omLP`;
  if (lpName.length > 32) {
    throw new Error(
      `Omnipair lp_name exceeds 32 chars (got ${lpName.length}) \u2014 omnipair-rs initialize validation.`
    );
  }
  const lpSymbol = `o${t0.slice(0, 4)}${t1.slice(0, 4)}`.slice(0, 10);
  const lpUri = "https://predicted.wtf/omnipair/pool";
  if (lpUri.length > 200 || !lpUri.startsWith("http")) {
    throw new Error("Omnipair lp_uri must start with http and be <= 200 chars.");
  }
  return { lpName, lpSymbol, lpUri };
}
function loadTeamTreasuryWallet() {
  const raw = process.env.OMNIPAIR_TEAM_TREASURY?.trim();
  if (!raw) {
    throw new Error(
      "Set OMNIPAIR_TEAM_TREASURY (team treasury wallet; must match FutarchyAuthority.recipients.team_treasury on devnet)."
    );
  }
  return new web3_js.PublicKey(raw);
}
async function ensureTeamTreasuryWsolAta(connection, payer, teamTreasury) {
  const ata = await splToken.getAssociatedTokenAddress(
    WSOL_MINT,
    teamTreasury,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const existing = await connection.getAccountInfo(ata);
  const alreadyExisted = existing !== null;
  console.info(
    "[predicted][omnipair-init] OMNIPAIR_TEAM_TREASURY (treasury wallet)",
    teamTreasury.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] team_treasury_wsol_account (WSOL ATA)",
    ata.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] WSOL mint",
    WSOL_MINT.toBase58()
  );
  if (alreadyExisted) {
    console.info(
      "[predicted][omnipair-init] WSOL ATA: already initialized (no create ix)"
    );
    return { ata, alreadyExisted: true, createIx: null };
  }
  console.info(
    "[predicted][omnipair-init] WSOL ATA: not found \u2014 will create ATA (payer = market engine authority)",
    payer.publicKey.toBase58()
  );
  const createIx = splToken.createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    teamTreasury,
    WSOL_MINT,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return { ata, alreadyExisted: false, createIx };
}
async function initializeOmnipairMarket(params) {
  const {
    connection,
    payer,
    yesMint,
    noMint,
    authorityYesAta,
    authorityNoAta,
    bootstrapPerSide
  } = params;
  const execute = process.env.OMNIPAIR_EXECUTE_INIT === "true";
  if (!execute) {
    throw new Error(
      "OMNIPAIR_EXECUTE_INIT must be true for on-chain pool initialization."
    );
  }
  const programId = requireOmnipairProgramId();
  console.info(
    "[predicted][omnipair-init] deploying against Omnipair program id",
    programId.toBase58(),
    "(NEXT_PUBLIC_OMNIPAIR_PROGRAM_ID)"
  );
  const poolParams = params.poolParams ?? DEFAULT_OMNIPAIR_POOL_PARAMS;
  const [token0Mint, token1Mint] = orderMints(yesMint, noMint);
  const deployerToken0Ata = token0Mint.equals(yesMint) ? authorityYesAta : authorityNoAta;
  const deployerToken1Ata = token1Mint.equals(yesMint) ? authorityYesAta : authorityNoAta;
  const paramsHash = deriveOmnipairLayout(
    programId,
    yesMint,
    noMint,
    poolParams
  ).paramsHash;
  const [pairAddress] = getPairPDA(
    programId,
    token0Mint,
    token1Mint,
    paramsHash
  );
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(programId);
  const [reserve0Vault] = getReserveVaultPDA(programId, pairAddress, token0Mint);
  const [reserve1Vault] = getReserveVaultPDA(programId, pairAddress, token1Mint);
  const [collateral0Vault] = getCollateralVaultPDA(
    programId,
    pairAddress,
    token0Mint
  );
  const [collateral1Vault] = getCollateralVaultPDA(
    programId,
    pairAddress,
    token1Mint
  );
  const teamTreasury = loadTeamTreasuryWallet();
  const {
    ata: teamTreasuryWsolAta,
    alreadyExisted: treasuryWsolAtaAlreadyExisted,
    createIx: createTreasuryWsolAtaIx
  } = await ensureTeamTreasuryWsolAta(connection, payer, teamTreasury);
  const rateModelKp = web3_js.Keypair.generate();
  const lpMintKp = web3_js.Keypair.generate();
  const lpMetadata = getLpTokenMetadataPDA(lpMintKp.publicKey);
  const deployerLpAta = splToken.getAssociatedTokenAddressSync(
    lpMintKp.publicKey,
    payer.publicKey,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const { lpName, lpSymbol, lpUri } = buildOmnipairLpTokenMetadata(
    token0Mint,
    token1Mint
  );
  console.info("[predicted][omnipair-init] LP metadata (on-chain validation)", {
    lpName,
    lpSymbol,
    lpUri,
    lpNameLen: lpName.length,
    lpSymbolLen: lpSymbol.length,
    lpUriLen: lpUri.length
  });
  const bootstrapArgs = buildInitializeAndBootstrapArgs({
    pool: poolParams,
    version: OMNIPAIR_PROTOCOL_VERSION,
    amount0In: bootstrapPerSide,
    amount1In: bootstrapPerSide,
    minLiquidityOut: 0n,
    lpName,
    lpSymbol,
    lpUri
  });
  const ixDataBody = serializeInitializeAndBootstrapArgs(bootstrapArgs);
  const discriminator = anchorDiscriminator(IX_NAME);
  const ixData = Buffer.concat([discriminator, ixDataBody]);
  const { publicKey: eventAuthority } = getEventAuthorityPDA(programId);
  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: token0Mint, isSigner: false, isWritable: false },
    { pubkey: token1Mint, isSigner: false, isWritable: false },
    { pubkey: pairAddress, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: rateModelKp.publicKey, isSigner: true, isWritable: true },
    { pubkey: lpMintKp.publicKey, isSigner: true, isWritable: true },
    { pubkey: lpMetadata, isSigner: false, isWritable: true },
    { pubkey: deployerLpAta, isSigner: false, isWritable: true },
    { pubkey: reserve0Vault, isSigner: false, isWritable: true },
    { pubkey: reserve1Vault, isSigner: false, isWritable: true },
    { pubkey: collateral0Vault, isSigner: false, isWritable: true },
    { pubkey: collateral1Vault, isSigner: false, isWritable: true },
    { pubkey: deployerToken0Ata, isSigner: false, isWritable: true },
    { pubkey: deployerToken1Ata, isSigner: false, isWritable: true },
    { pubkey: teamTreasury, isSigner: false, isWritable: false },
    { pubkey: teamTreasuryWsolAta, isSigner: false, isWritable: true },
    { pubkey: web3_js.SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false
    },
    { pubkey: web3_js.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    /** Self-CPI `emit!` / event stack (Anchor `event_cpi`). */
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false }
  ];
  const initializeAccountLabels = [
    "deployer",
    "token0_mint",
    "token1_mint",
    "pair",
    "futarchy_authority",
    "rate_model",
    "lp_mint",
    "lp_token_metadata",
    "deployer_lp_token_account",
    "reserve_vault_0",
    "reserve_vault_1",
    "collateral_vault_0",
    "collateral_vault_1",
    "deployer_token0_account",
    "deployer_token1_account",
    "team_treasury",
    "team_treasury_wsol_account",
    "system_program",
    "token_program",
    "token_2022_program",
    "token_metadata_program",
    "associated_token_program",
    "rent",
    "event_authority",
    "program"
  ];
  console.info(
    "[predicted][omnipair-init] initialize accounts (ordered, matches omnipair-rs InitializeAndBootstrap + event_cpi):"
  );
  keys.forEach((meta, i) => {
    const label = initializeAccountLabels[i] ?? `[${i}]`;
    console.info(
      `[predicted][omnipair-init]   [${i}] ${label}`,
      meta.pubkey.toBase58(),
      `signer=${meta.isSigner} writable=${meta.isWritable}`
    );
  });
  console.info("[predicted][omnipair-init] labels \u2014 pair", pairAddress.toBase58());
  console.info(
    "[predicted][omnipair-init] labels \u2014 reserve vault 0 (token0)",
    reserve0Vault.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 reserve vault 1 (token1)",
    reserve1Vault.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 collateral vault 0 (token0)",
    collateral0Vault.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 collateral vault 1 (token1)",
    collateral1Vault.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 futarchy authority",
    futarchyAuthority.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 team treasury WSOL account",
    teamTreasuryWsolAta.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 event authority",
    eventAuthority.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 lp mint",
    lpMintKp.publicKey.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 token program",
    splToken.TOKEN_PROGRAM_ID.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 associated token program",
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] labels \u2014 system program",
    web3_js.SystemProgram.programId.toBase58()
  );
  const initIx = new web3_js.TransactionInstruction({
    keys,
    programId,
    data: ixData
  });
  console.info("[predicted][omnipair-init] instructionName", IX_NAME);
  console.info(
    "[predicted][omnipair-init] discriminator (sha256 global:initialize)[0..8] hex",
    discriminator.toString("hex")
  );
  console.info(
    "[predicted][omnipair-init] serialized instruction args byte length",
    ixDataBody.length
  );
  console.info(
    "[predicted][omnipair-init] total ix data length",
    ixData.length
  );
  console.info("[predicted][omnipair-init] YES mint", yesMint.toBase58());
  console.info("[predicted][omnipair-init] NO mint", noMint.toBase58());
  console.info("[predicted][omnipair-init] token0", token0Mint.toBase58());
  console.info("[predicted][omnipair-init] token1", token1Mint.toBase58());
  console.info(
    "[predicted][omnipair-init] paramsHash (hex)",
    paramsHash.toString("hex")
  );
  console.info("[predicted][omnipair-init] pair PDA", pairAddress.toBase58());
  console.info(
    "[predicted][omnipair-init] futarchy authority (global PDA)",
    futarchyAuthority.toBase58()
  );
  console.info(
    "[predicted][omnipair-init] PAIR_CREATION_FEE_LAMPORTS",
    PAIR_CREATION_FEE_LAMPORTS.toString()
  );
  let preInitializeSignature;
  try {
    const preInitTx = await buildOmnipairPreInitializeTransaction({
      connection,
      payer,
      lpMintKp,
      createTreasuryWsolAtaIx
    });
    await logLegacyTransactionMetricsBeforeSend(
      "[omnipair] tx1 pre-initialize accounts (WSOL ATA optional + LP mint account)",
      connection,
      preInitTx,
      payer.publicKey
    );
    console.info(
      "[predicted][omnipair-init] BEFORE sendAndConfirm tx1 (pre-initialize accounts)"
    );
    preInitializeSignature = await sendAndConfirmTransactionWithSigners(
      connection,
      preInitTx,
      [payer, lpMintKp]
    );
    console.info(
      "[predicted][omnipair-init] tx1 signature (pre-initialize accounts)",
      preInitializeSignature
    );
    console.info(
      "[predicted][omnipair-init] team treasury WSOL ATA outcome:",
      treasuryWsolAtaAlreadyExisted ? "already existed before tx1" : "created in tx1 (fee paid by market engine authority)"
    );
  } catch (e) {
    const msg = formatUnknownError(e);
    console.error("[predicted][omnipair-init] tx1 pre-initialize failed:", msg, e);
    throw new PipelineStageError("FAILED_AT_OMNIPAIR_PRE_INIT", msg, {
      cause: e,
      missingProgramId: extractMissingProgramIdFromSolanaError(e)
    });
  }
  let bootstrapLiquiditySignature;
  try {
    const ixY = splToken.createMintToInstruction(
      yesMint,
      authorityYesAta,
      payer.publicKey,
      bootstrapPerSide
    );
    const ixN = splToken.createMintToInstruction(
      noMint,
      authorityNoAta,
      payer.publicKey,
      bootstrapPerSide
    );
    const bootstrapTx = new web3_js.Transaction().add(ixY, ixN);
    await logLegacyTransactionMetricsBeforeSend(
      "[omnipair] tx2 bootstrap liquidity (mint YES + NO to engine authority ATAs \u2014 required before Initialize pulls liquidity)",
      connection,
      bootstrapTx,
      payer.publicKey
    );
    console.info(
      "[predicted][omnipair-init] BEFORE sendAndConfirm tx2 (bootstrap mint)"
    );
    bootstrapLiquiditySignature = await sendAndConfirmTransactionWithSigners(
      connection,
      bootstrapTx,
      [payer]
    );
    console.info(
      "[predicted][omnipair-init] tx2 signature (bootstrap liquidity / mint)",
      bootstrapLiquiditySignature
    );
  } catch (e) {
    const msg = formatUnknownError(e);
    console.error(
      "[predicted][omnipair-init] tx2 bootstrap liquidity (mint) failed:",
      msg,
      e
    );
    throw new PipelineStageError("FAILED_AT_LIQUIDITY_SEED", msg, {
      cause: e,
      missingProgramId: extractMissingProgramIdFromSolanaError(e)
    });
  }
  let initializeSignature;
  try {
    const initOnlyTx = new web3_js.Transaction().add(initIx);
    await logLegacyTransactionMetricsBeforeSend(
      "[omnipair] tx3 Omnipair Initialize (only)",
      connection,
      initOnlyTx,
      payer.publicKey
    );
    console.info(
      "[predicted][omnipair-init] BEFORE sendAndConfirm tx3 (Omnipair Initialize)"
    );
    initializeSignature = await sendAndConfirmTransactionWithSigners(
      connection,
      initOnlyTx,
      [payer, rateModelKp, lpMintKp]
    );
    console.info(
      "[predicted][omnipair-init] tx3 signature (Omnipair Initialize)",
      initializeSignature
    );
  } catch (e) {
    const msg = formatUnknownError(e);
    console.error("[predicted][omnipair-init] tx3 Omnipair initialize failed:", msg, e);
    throw new PipelineStageError("FAILED_AT_OMNIPAIR_INIT", msg, {
      cause: e,
      missingProgramId: extractMissingProgramIdFromSolanaError(e)
    });
  }
  return {
    programId,
    pairAddress,
    yesMint,
    noMint,
    token0Mint,
    token1Mint,
    vaultA: reserve0Vault,
    vaultB: reserve1Vault,
    lpMint: lpMintKp.publicKey,
    rateModel: rateModelKp.publicKey,
    collateralYes: getCollateralVaultPDA(programId, pairAddress, yesMint)[0],
    collateralNo: getCollateralVaultPDA(programId, pairAddress, noMint)[0],
    futarchyAuthority,
    preInitializeSignature,
    bootstrapLiquiditySignature,
    initializeSignature,
    initSignature: initializeSignature
  };
}
var DEVNET_USDC_MINT = new web3_js.PublicKey(
  "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
);
var OUTCOME_MINT_DECIMALS = 9;

// ../../lib/solana/mint-market-positions.ts
var MINT_POSITIONS_USDC_DECIMALS = 6;
BigInt(OUTCOME_MINT_DECIMALS) - BigInt(MINT_POSITIONS_USDC_DECIMALS);
function redemptionAtomsExponent(outcomeDecimals, usdcDecimals) {
  if (outcomeDecimals < usdcDecimals) {
    throw new Error(
      "outcomeDecimals must be >= usdcDecimals for custody redemption mapping."
    );
  }
  return BigInt(outcomeDecimals - usdcDecimals);
}
function usdcBaseUnitsToOutcomeBaseUnitsDynamic(usdcAtoms, outcomeDecimals, usdcDecimals) {
  return usdcAtoms * 10n ** redemptionAtomsExponent(outcomeDecimals, usdcDecimals);
}
function pairedOutcomeAtomsToUsdcAtomsDynamic(outcomeAtoms, outcomeDecimals, usdcDecimals) {
  if (outcomeAtoms <= 0n) return 0n;
  return outcomeAtoms / 10n ** redemptionAtomsExponent(outcomeDecimals, usdcDecimals);
}
function floorOutcomeToUsdcRedemptionGrid(outcomeAtoms, outcomeDecimals, usdcDecimals) {
  const grid = 10n ** redemptionAtomsExponent(outcomeDecimals, usdcDecimals);
  return outcomeAtoms / grid * grid;
}
function maxPairedBurnOutcomeAtomsForCustodyUsdc(custodyUsdcAtoms, outcomeDecimals, usdcDecimals) {
  if (custodyUsdcAtoms <= 0n) return 0n;
  const atoms = usdcBaseUnitsToOutcomeBaseUnitsDynamic(
    custodyUsdcAtoms,
    outcomeDecimals,
    usdcDecimals
  );
  return floorOutcomeToUsdcRedemptionGrid(atoms, outcomeDecimals, usdcDecimals);
}
function getMintPositionsCustodyOwnerFromEnv() {
  const raw = process.env.MINT_POSITIONS_CUSTODY_PUBKEY?.trim();
  if (!raw) return null;
  try {
    return new web3_js.PublicKey(raw);
  } catch {
    return null;
  }
}
function usdcBaseUnitsToOutcomeBaseUnits(usdcAtoms) {
  return usdcBaseUnitsToOutcomeBaseUnitsDynamic(
    usdcAtoms,
    OUTCOME_MINT_DECIMALS,
    MINT_POSITIONS_USDC_DECIMALS
  );
}
function outcomeBaseUnitsToUsdcBaseUnits(outcomeAtoms) {
  return pairedOutcomeAtomsToUsdcAtomsDynamic(
    outcomeAtoms,
    OUTCOME_MINT_DECIMALS,
    MINT_POSITIONS_USDC_DECIMALS
  );
}
function floorOutcomeAtomsToRedemptionGrid(outcomeAtoms) {
  return floorOutcomeToUsdcRedemptionGrid(
    outcomeAtoms,
    OUTCOME_MINT_DECIMALS,
    MINT_POSITIONS_USDC_DECIMALS
  );
}
function parseOutcomeHumanToBaseUnits(amountHuman) {
  const cleaned = amountHuman.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0n;
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw || "0";
  const fracPadded = (fracRaw + "0".repeat(OUTCOME_MINT_DECIMALS)).slice(
    0,
    OUTCOME_MINT_DECIMALS
  );
  return BigInt(whole) * 10n ** BigInt(OUTCOME_MINT_DECIMALS) + BigInt(fracPadded || "0");
}
function parseUsdcHumanToBaseUnits(usdcHuman) {
  const cleaned = usdcHuman.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0n;
  const [wholeRaw, fracRaw = ""] = cleaned.split(".");
  const whole = wholeRaw || "0";
  const fracPadded = (fracRaw + "0".repeat(MINT_POSITIONS_USDC_DECIMALS)).slice(
    0,
    MINT_POSITIONS_USDC_DECIMALS
  );
  return BigInt(whole) * 10n ** BigInt(MINT_POSITIONS_USDC_DECIMALS) + BigInt(fracPadded || "0");
}
async function maybeIxCreateAtaIdempotent(params) {
  const ata = splToken.getAssociatedTokenAddressSync(
    params.mint,
    params.owner,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const info = await params.connection.getAccountInfo(ata, "confirmed");
  if (info) return null;
  return splToken.createAssociatedTokenAccountIdempotentInstruction(
    params.payer,
    ata,
    params.owner,
    params.mint,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
}
async function buildMintPositionsInstructions(p, options) {
  const {
    connection,
    user,
    mintAuthority,
    custodyOwner,
    yesMint,
    noMint,
    usdcMint,
    usdcAmountAtoms
  } = p;
  if (usdcAmountAtoms <= 0n) {
    throw new Error("USDC amount must be greater than zero.");
  }
  const outcomeMintAtoms = usdcBaseUnitsToOutcomeBaseUnits(usdcAmountAtoms);
  if (outcomeMintAtoms <= 0n) {
    throw new Error("Outcome mint amount rounded to zero.");
  }
  const userUsdcAta = splToken.getAssociatedTokenAddressSync(
    usdcMint,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const custodyUsdcAta = splToken.getAssociatedTokenAddressSync(
    usdcMint,
    custodyOwner,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userYesAta = splToken.getAssociatedTokenAddressSync(
    yesMint,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userNoAta = splToken.getAssociatedTokenAddressSync(
    noMint,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const ixs = [];
  const ixCustodyAta = await maybeIxCreateAtaIdempotent({
    connection,
    payer: mintAuthority,
    owner: custodyOwner,
    mint: usdcMint
  });
  if (ixCustodyAta) ixs.push(ixCustodyAta);
  const ixUserUsdc = await maybeIxCreateAtaIdempotent({
    connection,
    payer: user,
    owner: user,
    mint: usdcMint
  });
  if (ixUserUsdc) ixs.push(ixUserUsdc);
  const ixYes = await maybeIxCreateAtaIdempotent({
    connection,
    payer: user,
    owner: user,
    mint: yesMint
  });
  if (ixYes) ixs.push(ixYes);
  const ixNo = await maybeIxCreateAtaIdempotent({
    connection,
    payer: user,
    owner: user,
    mint: noMint
  });
  if (ixNo) ixs.push(ixNo);
  {
    try {
      const info = await splToken.getAccount(connection, userUsdcAta, "confirmed", splToken.TOKEN_PROGRAM_ID);
      if (info.amount < usdcAmountAtoms) {
        throw new Error(
          `Insufficient devnet USDC: need ${usdcAmountAtoms.toString()} atoms, have ${info.amount.toString()}.`
        );
      }
    } catch (e) {
      if (e instanceof Error && (e.message.startsWith("Insufficient") || e.message.includes("Insufficient"))) {
        throw e;
      }
      throw new Error(
        "No devnet USDC token account \u2014 fund the wallet with devnet USDC first."
      );
    }
  }
  ixs.push(
    splToken.createTransferInstruction(
      userUsdcAta,
      custodyUsdcAta,
      user,
      usdcAmountAtoms,
      [],
      splToken.TOKEN_PROGRAM_ID
    )
  );
  ixs.push(
    splToken.createMintToInstruction(
      yesMint,
      userYesAta,
      mintAuthority,
      outcomeMintAtoms,
      [],
      splToken.TOKEN_PROGRAM_ID
    ),
    splToken.createMintToInstruction(
      noMint,
      userNoAta,
      mintAuthority,
      outcomeMintAtoms,
      [],
      splToken.TOKEN_PROGRAM_ID
    )
  );
  return {
    instructions: ixs,
    userUsdcAta,
    custodyUsdcAta,
    userYesAta,
    userNoAta,
    outcomeMintAtoms
  };
}

// src/explorer.ts
var EXPLORER_BASE = "https://explorer.solana.com";
function solanaTransactionExplorerUrl(signature, cluster) {
  if (cluster === "mainnet-beta") {
    return `${EXPLORER_BASE}/tx/${encodeURIComponent(signature)}`;
  }
  return `${EXPLORER_BASE}/tx/${encodeURIComponent(signature)}?cluster=${cluster}`;
}
function toPublicKey(k, label = "publicKey") {
  if (k instanceof web3_js.PublicKey) return k;
  try {
    return new web3_js.PublicKey(k);
  } catch {
    throw new Error(`Invalid ${label}: not a valid public key string.`);
  }
}
function humanToTokenAtoms(human, decimals, label = "amount") {
  const cleaned = human.trim().replace(/,/g, "");
  if (!cleaned) throw new Error(`${label} is empty.`);
  const m = cleaned.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) {
    throw new Error(`${label} must be a decimal string, e.g. "1.5".`);
  }
  const neg = m[1] === "-";
  const whole = m[2] ?? "0";
  const frac = (m[3] ?? "").padEnd(decimals, "0").slice(0, decimals);
  if (frac.length > decimals) {
    throw new Error(`${label}: too many decimal places (max ${decimals}).`);
  }
  const base = 10n ** BigInt(decimals);
  const w = BigInt(whole);
  const f = frac.length ? BigInt(frac) : 0n;
  let out = w * base + f;
  if (neg) out = -out;
  return out;
}

// src/market.ts
async function runCreateOmnipairMarket(params) {
  const team = toPublicKey(params.teamTreasury, "teamTreasury").toBase58();
  const yesMint = toPublicKey(params.yesMint, "yesMint");
  const noMint = toPublicKey(params.noMint, "noMint");
  const authorityYesAta = toPublicKey(params.authorityYesAta, "authorityYesAta");
  const authorityNoAta = toPublicKey(params.authorityNoAta, "authorityNoAta");
  const bootstrapPerSide = parseOutcomeHumanToBaseUnits(
    params.bootstrapPerSide.trim()
  );
  if (bootstrapPerSide <= 0n) {
    throw new Error("bootstrapPerSide must be greater than zero.");
  }
  const r = await withCreateMarketEnv(
    team,
    () => initializeOmnipairMarket({
      connection: params.connection,
      payer: params.engine,
      yesMint,
      noMint,
      authorityYesAta,
      authorityNoAta,
      bootstrapPerSide
    })
  );
  const ex = (sig) => solanaTransactionExplorerUrl(sig, params.cluster);
  return {
    preInitializeSignature: r.preInitializeSignature,
    bootstrapLiquiditySignature: r.bootstrapLiquiditySignature,
    initializeSignature: r.initializeSignature,
    initSignature: r.initSignature,
    programId: r.programId.toBase58(),
    pairAddress: r.pairAddress.toBase58(),
    yesMint: r.yesMint.toBase58(),
    noMint: r.noMint.toBase58(),
    explorer: {
      preInitialize: ex(r.preInitializeSignature),
      bootstrap: ex(r.bootstrapLiquiditySignature),
      initialize: ex(r.initializeSignature)
    }
  };
}
function readPubkey(data, o) {
  return [new web3_js.PublicKey(data.subarray(o, o + 32)), o + 32];
}
function readU16LE(data, o) {
  return [data.readUInt16LE(o), o + 2];
}
function readU64LE(data, o) {
  return [data.readBigUInt64LE(o), o + 8];
}
function readU128LE(data, o) {
  const lo = data.readBigUInt64LE(o);
  const hi = data.readBigUInt64LE(o + 8);
  return [lo | hi << 64n, o + 16];
}
function readOptionU16(data, o) {
  const tag = data.readUInt8(o);
  if (tag === 0) return [null, o + 1];
  const [v, o2] = readU16LE(data, o + 1);
  return [v, o2];
}
function readLastPriceEma(data, o) {
  return [16, o + 16];
}
function decodeOmnipairPairAccount(data) {
  if (data.length < 8 + 32 * 4 + 2) {
    throw new Error("Pair account data too short.");
  }
  let o = 8;
  const [token0, o1] = readPubkey(data, o);
  o = o1;
  const [token1, o2] = readPubkey(data, o);
  o = o2;
  const [lpMint, o3] = readPubkey(data, o);
  o = o3;
  const [rateModel, o4] = readPubkey(data, o);
  o = o4;
  const [swapFeeBps, o5] = readU16LE(data, o);
  o = o5;
  const [halfLife, o6] = readU64LE(data, o);
  o = o6;
  const [fixedCf, o7] = readOptionU16(data, o);
  o = o7;
  const [reserve0, o8] = readU64LE(data, o);
  o = o8;
  const [reserve1, o9] = readU64LE(data, o);
  o = o9;
  const [cashReserve0, o10] = readU64LE(data, o);
  o = o10;
  const [cashReserve1, o11] = readU64LE(data, o);
  o = o11;
  const [, o12] = readLastPriceEma(data, o);
  o = o12;
  const [, o13] = readLastPriceEma(data, o);
  o = o13;
  const [, o14] = readU64LE(data, o);
  o = o14;
  const [, o15] = readU64LE(data, o);
  o = o15;
  const [, o16] = readU64LE(data, o);
  o = o16;
  const [totalDebt0, o17] = readU64LE(data, o);
  o = o17;
  const [totalDebt1, o18] = readU64LE(data, o);
  o = o18;
  const [totalDebt0Shares, o20] = readU128LE(data, o);
  o = o20;
  const [totalDebt1Shares, o21] = readU128LE(data, o);
  o = o21;
  const [, o22] = readU64LE(data, o);
  o = o22;
  const [, o23] = readU64LE(data, o);
  o = o23;
  const [, o24] = readU64LE(data, o);
  o = o24;
  const token0Decimals = data.readUInt8(o);
  o += 1;
  const token1Decimals = data.readUInt8(o);
  o += 1;
  return {
    token0,
    token1,
    lpMint,
    rateModel,
    swapFeeBps,
    halfLife,
    reserve0,
    reserve1,
    cashReserve0,
    cashReserve1,
    totalDebt0,
    totalDebt1,
    totalDebt0Shares,
    totalDebt1Shares,
    token0Decimals,
    token1Decimals
  };
}
function decodeFutarchySwapShareBps(data) {
  if (data.length < 8 + 1 + 32 + 96 + 2) {
    throw new Error("FutarchyAuthority account data too short.");
  }
  let o = 8;
  o += 1;
  o += 32;
  o += 96;
  const swapShareBps = data.readUInt16LE(o);
  return swapShareBps;
}

// ../../lib/solana/omnipair-swap-math.ts
var OMNIPAIR_BPS = 10000n;
function ceilDiv(a, b) {
  if (b === 0n) throw new Error("ceilDiv: divisor zero");
  return (a + b - 1n) / b;
}
function estimateOmnipairSwapAmountOut(params) {
  const { pair, futarchySwapShareBps, amountIn, isToken0In } = params;
  if (amountIn <= 0n) return 0n;
  const swapFee = ceilDiv(
    amountIn * BigInt(pair.swapFeeBps),
    OMNIPAIR_BPS
  );
  ceilDiv(
    swapFee * BigInt(futarchySwapShareBps),
    OMNIPAIR_BPS
  );
  const amountInAfterSwapFee = amountIn - swapFee;
  const reserveIn = isToken0In ? pair.reserve0 : pair.reserve1;
  const reserveOut = isToken0In ? pair.reserve1 : pair.reserve0;
  const denominator = reserveIn + amountInAfterSwapFee;
  if (denominator === 0n) return 0n;
  return amountInAfterSwapFee * reserveOut / denominator;
}
function applySlippageFloor(amountOut, slippageBps) {
  if (slippageBps <= 0 || slippageBps >= 1e4) return amountOut;
  return amountOut * BigInt(1e4 - slippageBps) / OMNIPAIR_BPS;
}

// ../../lib/solana/omnipair-liquidity-math.ts
var OMNIPAIR_LIQUIDITY_WITHDRAWAL_FEE_BPS = 100;
function estimateLiquidityOutFromAdd(params) {
  const { reserve0, reserve1, totalSupplyLp, amount0In, amount1In } = params;
  if (reserve0 <= 0n || reserve1 <= 0n || totalSupplyLp <= 0n || amount0In <= 0n || amount1In <= 0n) {
    return 0n;
  }
  const l0 = amount0In * totalSupplyLp / reserve0;
  const l1 = amount1In * totalSupplyLp / reserve1;
  return l0 < l1 ? l0 : l1;
}
function applyAddLiquiditySlippageFloor(liquidityOut, slippageBps) {
  if (liquidityOut <= 0n) return 0n;
  if (slippageBps <= 0 || slippageBps >= 1e4) return liquidityOut;
  return liquidityOut * BigInt(1e4 - slippageBps) / OMNIPAIR_BPS;
}
function estimateRemoveLiquidityGrossOut(params) {
  const { reserve0, reserve1, totalSupplyLp, liquidityIn } = params;
  if (liquidityIn <= 0n || totalSupplyLp <= 0n) {
    return { amount0: 0n, amount1: 0n };
  }
  const a0 = liquidityIn * reserve0 / totalSupplyLp;
  const a1 = liquidityIn * reserve1 / totalSupplyLp;
  return { amount0: a0, amount1: a1 };
}
function applyLiquidityWithdrawalFee(amountGross, feeBps = OMNIPAIR_LIQUIDITY_WITHDRAWAL_FEE_BPS) {
  if (amountGross <= 0n) return { fee: 0n, out: 0n };
  const fee = Number(feeBps) > 0 ? ceilDiv(amountGross * BigInt(feeBps), OMNIPAIR_BPS) : 0n;
  const out = amountGross - fee;
  return { fee, out: out < 0n ? 0n : out };
}
function estimateRemoveMinOuts(params) {
  const g = estimateRemoveLiquidityGrossOut(params);
  const f0 = applyLiquidityWithdrawalFee(g.amount0);
  const f1 = applyLiquidityWithdrawalFee(g.amount1);
  if (params.slippageBps <= 0 || params.slippageBps >= 1e4) {
    return { min0: f0.out, min1: f1.out };
  }
  const s = BigInt(1e4 - params.slippageBps);
  return {
    min0: f0.out * s / OMNIPAIR_BPS,
    min1: f1.out * s / OMNIPAIR_BPS
  };
}
var IX_ADD = "add_liquidity";
var IX_REMOVE = "remove_liquidity";
function adjustLiquidityEventCpis(programId) {
  const { publicKey: eventAuthority } = getEventAuthorityPDA(programId);
  return { eventAuthority, program: programId };
}
function buildOmnipairAddLiquidityInstruction(params) {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(params.programId);
  const { eventAuthority, program } = adjustLiquidityEventCpis(params.programId);
  const [reserve0Vault] = getReserveVaultPDA(
    params.programId,
    params.pair,
    params.token0Mint
  );
  const [reserve1Vault] = getReserveVaultPDA(
    params.programId,
    params.pair,
    params.token1Mint
  );
  const data = Buffer.concat([
    anchorDiscriminator(IX_ADD),
    u64le(params.amount0In),
    u64le(params.amount1In),
    u64le(params.minLiquidityOut)
  ]);
  const keys = [
    { pubkey: params.pair, isSigner: false, isWritable: true },
    { pubkey: params.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: reserve0Vault, isSigner: false, isWritable: true },
    { pubkey: reserve1Vault, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.token0Mint, isSigner: false, isWritable: false },
    { pubkey: params.token1Mint, isSigner: false, isWritable: false },
    { pubkey: params.lpMint, isSigner: false, isWritable: true },
    { pubkey: params.userLp, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: splToken.ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: web3_js.SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: program, isSigner: false, isWritable: false }
  ];
  return new web3_js.TransactionInstruction({ programId: params.programId, keys, data });
}
function buildOmnipairRemoveLiquidityInstruction(params) {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(params.programId);
  const { eventAuthority, program } = adjustLiquidityEventCpis(params.programId);
  const [reserve0Vault] = getReserveVaultPDA(
    params.programId,
    params.pair,
    params.token0Mint
  );
  const [reserve1Vault] = getReserveVaultPDA(
    params.programId,
    params.pair,
    params.token1Mint
  );
  const data = Buffer.concat([
    anchorDiscriminator(IX_REMOVE),
    u64le(params.liquidityIn),
    u64le(params.minAmount0Out),
    u64le(params.minAmount1Out)
  ]);
  const keys = [
    { pubkey: params.pair, isSigner: false, isWritable: true },
    { pubkey: params.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: reserve0Vault, isSigner: false, isWritable: true },
    { pubkey: reserve1Vault, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.token0Mint, isSigner: false, isWritable: false },
    { pubkey: params.token1Mint, isSigner: false, isWritable: false },
    { pubkey: params.lpMint, isSigner: false, isWritable: true },
    { pubkey: params.userLp, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: true },
    { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: splToken.ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: web3_js.SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: program, isSigner: false, isWritable: false }
  ];
  return new web3_js.TransactionInstruction({ programId: params.programId, keys, data });
}

// ../../lib/solana/provide-liquidity-usdc.ts
function logProvide(tag, payload) {
  console.info(`[predicted][lp-usdc] ${tag}`, JSON.stringify(payload));
}
async function buildProvideLiquidityWithUsdcTransactionEngineSigned(params) {
  const slippageBps = params.slippageBps ?? 100;
  const programId = requireOmnipairProgramId();
  const layout = deriveOmnipairLayout(
    programId,
    params.yesMint,
    params.noMint,
    DEFAULT_OMNIPAIR_POOL_PARAMS
  );
  if (!layout.pairAddress.equals(params.pairAddress)) {
    throw new Error(
      "pool_address does not match derived Omnipair pair for these mints."
    );
  }
  const custodyOwner = getMintPositionsCustodyOwnerFromEnv() ?? params.engine.publicKey;
  const mintAuthority = params.engine.publicKey;
  const mintPart = await buildMintPositionsInstructions({
    connection: params.connection,
    user: params.user,
    mintAuthority,
    custodyOwner,
    yesMint: params.yesMint,
    noMint: params.noMint,
    usdcMint: DEVNET_USDC_MINT,
    usdcAmountAtoms: params.usdcAmountAtoms
  });
  const { outcomeMintAtoms, userYesAta, userNoAta } = mintPart;
  const pairInfo = await params.connection.getAccountInfo(
    params.pairAddress,
    "confirmed"
  );
  if (!pairInfo?.data) throw new Error("Omnipair pair account missing");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);
  const t0 = layout.token0Mint;
  const t1 = layout.token1Mint;
  const userT0 = t0.equals(params.yesMint) ? userYesAta : userNoAta;
  const userT1 = t1.equals(params.yesMint) ? userYesAta : userNoAta;
  const amount0In = outcomeMintAtoms;
  const amount1In = outcomeMintAtoms;
  const lpMintInfo = await splToken.getMint(params.connection, pairDecoded.lpMint);
  const totalLpSupply = lpMintInfo.supply;
  if (totalLpSupply === 0n) {
    throw new Error("LP mint supply is zero \u2014 pool may not be initialized.");
  }
  const estimatedLiq = estimateLiquidityOutFromAdd({
    reserve0: pairDecoded.reserve0,
    reserve1: pairDecoded.reserve1,
    totalSupplyLp: totalLpSupply,
    amount0In,
    amount1In
  });
  if (estimatedLiq <= 0n) {
    throw new Error(
      "Estimated LP minted is zero \u2014 check pool reserves and amount."
    );
  }
  const minLiquidityOut = applyAddLiquiditySlippageFloor(estimatedLiq, slippageBps);
  if (minLiquidityOut <= 0n) {
    throw new Error("min_liquidity_out under slippage is zero; increase amount.");
  }
  const userLp = splToken.getAssociatedTokenAddressSync(
    pairDecoded.lpMint,
    params.user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const poolStateBefore = {
    pair: params.pairAddress.toBase58(),
    reserve0: pairDecoded.reserve0.toString(),
    reserve1: pairDecoded.reserve1.toString(),
    totalLpSupply: totalLpSupply.toString(),
    swapFeeBps: pairDecoded.swapFeeBps
  };
  const addIx = buildOmnipairAddLiquidityInstruction({
    programId,
    pair: params.pairAddress,
    rateModel: pairDecoded.rateModel,
    token0Mint: t0,
    token1Mint: t1,
    userToken0: userT0,
    userToken1: userT1,
    userLp,
    lpMint: pairDecoded.lpMint,
    user: params.user,
    amount0In,
    amount1In,
    minLiquidityOut
  });
  const tx = new web3_js.Transaction();
  const microLamports = Math.floor(Math.random() * 9e5) + 1;
  tx.add(web3_js.ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.add(...mintPart.instructions, addIx);
  tx.feePayer = params.user;
  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.partialSign(params.engine);
  const log = {
    lastValidBlockHeight,
    recentBlockhash: blockhash,
    user: params.user.toBase58(),
    marketSlug: params.marketSlug,
    yesMint: params.yesMint.toBase58(),
    noMint: params.noMint.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    usdcAmountAtoms: params.usdcAmountAtoms.toString(),
    amount0In: amount0In.toString(),
    amount1In: amount1In.toString(),
    minLiquidityOut: minLiquidityOut.toString(),
    estimatedLiquidityOut: estimatedLiq.toString(),
    poolStateBefore
  };
  logProvide("built", {
    ...log,
    slippageBps,
    computeBudgetMicroLamports: microLamports
  });
  return {
    serialized: tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    }),
    log,
    recentBlockhash: blockhash,
    lastValidBlockHeight
  };
}
var SWAP_IX = "swap";
function buildOmnipairSwapInstruction(p) {
  const [futarchyAuthority] = getGlobalFutarchyAuthorityPDA(p.programId);
  const { publicKey: eventAuthority } = getEventAuthorityPDA(p.programId);
  const [tokenInVault] = getReserveVaultPDA(
    p.programId,
    p.pair,
    p.tokenInMint
  );
  const [tokenOutVault] = getReserveVaultPDA(
    p.programId,
    p.pair,
    p.tokenOutMint
  );
  const data = Buffer.concat([
    anchorDiscriminator(SWAP_IX),
    u64le(p.amountIn),
    u64le(p.minAmountOut)
  ]);
  const keys = [
    { pubkey: p.pair, isSigner: false, isWritable: true },
    { pubkey: p.rateModel, isSigner: false, isWritable: true },
    { pubkey: futarchyAuthority, isSigner: false, isWritable: false },
    { pubkey: tokenInVault, isSigner: false, isWritable: true },
    { pubkey: tokenOutVault, isSigner: false, isWritable: true },
    { pubkey: p.userTokenIn, isSigner: false, isWritable: true },
    { pubkey: p.userTokenOut, isSigner: false, isWritable: true },
    { pubkey: p.tokenInMint, isSigner: false, isWritable: false },
    { pubkey: p.tokenOutMint, isSigner: false, isWritable: false },
    { pubkey: p.user, isSigner: true, isWritable: true },
    { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: eventAuthority, isSigner: false, isWritable: false },
    { pubkey: p.programId, isSigner: false, isWritable: false }
  ];
  return new web3_js.TransactionInstruction({
    programId: p.programId,
    keys,
    data
  });
}

// ../../lib/solana/treasury.ts
var import_bs58 = __toESM(require_bs58());
function loadMarketEngineAuthority() {
  const raw = process.env.MARKET_ENGINE_AUTHORITY_SECRET?.trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("[")) {
      const arr = JSON.parse(raw);
      return web3_js.Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    return web3_js.Keypair.fromSecretKey(import_bs58.default.decode(raw));
  } catch {
    return null;
  }
}

// ../../lib/solana/sell-outcome-for-usdc.ts
function logSell(tag, payload) {
  console.info(`[predicted][sell-outcome-usdc] ${tag}`, JSON.stringify(payload));
}
async function fetchRedemptionMintDecimals(connection, yesMint, noMint) {
  const [yesM, noM, usdcM] = await Promise.all([
    splToken.getMint(connection, yesMint, "confirmed"),
    splToken.getMint(connection, noMint, "confirmed"),
    splToken.getMint(connection, DEVNET_USDC_MINT, "confirmed")
  ]);
  if (yesM.decimals !== noM.decimals) {
    throw new Error(
      `YES and NO mint decimals must match for paired redeem (yes=${yesM.decimals}, no=${noM.decimals}).`
    );
  }
  return { outcome: yesM.decimals, usdc: usdcM.decimals };
}
function vaultReservesForMints(pair, yesMint) {
  const t0IsYes = yesMint.equals(pair.token0);
  return {
    reserveYes: t0IsYes ? pair.reserve0 : pair.reserve1,
    reserveNo: t0IsYes ? pair.reserve1 : pair.reserve0
  };
}
async function outcomeAta(owner, mint) {
  return splToken.getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
}
async function readOutcomeBal(connection, ata) {
  try {
    const a = await splToken.getAccount(connection, ata, "confirmed", splToken.TOKEN_PROGRAM_ID);
    return a.amount;
  } catch {
    return 0n;
  }
}
async function readUsdcBal(connection, ata) {
  try {
    const a = await splToken.getAccount(connection, ata, "confirmed", splToken.TOKEN_PROGRAM_ID);
    return a.amount;
  } catch {
    return 0n;
  }
}
async function maybeCreateUserUsdcAtaIx(connection, user) {
  const ata = splToken.getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (info) return null;
  return splToken.createAssociatedTokenAccountIdempotentInstruction(
    user,
    ata,
    user,
    DEVNET_USDC_MINT,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
}
function maxPairedBurnAtomsForCustodyAdjusted(custodyUsdcAtoms, rd) {
  if (custodyUsdcAtoms <= 0n) return 0n;
  if (rd) {
    return maxPairedBurnOutcomeAtomsForCustodyUsdc(
      custodyUsdcAtoms,
      rd.outcome,
      rd.usdc
    );
  }
  const atoms = usdcBaseUnitsToOutcomeBaseUnits(custodyUsdcAtoms);
  return floorOutcomeAtomsToRedemptionGrid(atoms);
}
function floorRedemptionGrid(atoms, rd) {
  return rd ? floorOutcomeToUsdcRedemptionGrid(atoms, rd.outcome, rd.usdc) : floorOutcomeAtomsToRedemptionGrid(atoms);
}
function pairedOutcomeToUsdcAdjusted(atoms, rd) {
  return rd ? pairedOutcomeAtomsToUsdcAtomsDynamic(atoms, rd.outcome, rd.usdc) : outcomeBaseUnitsToUsdcBaseUnits(atoms);
}
var SEARCH_STEPS = 96n;
function min3(a, b, c) {
  const x = a < b ? a : b;
  return x < c ? x : c;
}
function bestSwapInSellYes(params) {
  const hi = params.cap < params.yes0 ? params.cap : params.yes0;
  if (hi <= 0n) return 0n;
  const evalPair = (S) => {
    if (S < 0n || S > hi) return -1n;
    const budget = params.cap > S ? params.cap - S : 0n;
    const minOut = applySlippageFloor(
      estimateOmnipairSwapAmountOut({
        pair: params.pairDecoded,
        futarchySwapShareBps: params.futarchySwapShareBps,
        amountIn: S,
        isToken0In: params.yesMint.equals(params.pairDecoded.token0)
      }),
      params.slippageBps
    );
    const yes1 = params.yes0 - S;
    const no1 = params.no0 + minOut;
    let raw = yes1 < no1 ? yes1 : no1;
    raw = min3(raw, budget, params.maxPairByCustody);
    return params.floorRedeemGrid(raw);
  };
  let bestS = 0n;
  let bestScore = evalPair(0n);
  for (let i = 0n; i <= SEARCH_STEPS; i++) {
    const S = hi * i / SEARCH_STEPS;
    const sc = evalPair(S);
    if (sc > bestScore) {
      bestScore = sc;
      bestS = S;
    }
  }
  const span = hi / 48n + 1n;
  for (let d = -10n; d <= 10n; d++) {
    const S2 = bestS + d * span;
    if (S2 < 0n || S2 > hi) continue;
    const sc = evalPair(S2);
    if (sc > bestScore) {
      bestScore = sc;
      bestS = S2;
    }
  }
  if (bestScore <= 0n) return 0n;
  return bestS;
}
function bestSwapInSellNo(params) {
  const hi = params.cap < params.no0 ? params.cap : params.no0;
  if (hi <= 0n) return 0n;
  const evalPair = (S) => {
    if (S < 0n || S > hi) return -1n;
    const budget = params.cap > S ? params.cap - S : 0n;
    const minOut = applySlippageFloor(
      estimateOmnipairSwapAmountOut({
        pair: params.pairDecoded,
        futarchySwapShareBps: params.futarchySwapShareBps,
        amountIn: S,
        isToken0In: params.noMint.equals(params.pairDecoded.token0)
      }),
      params.slippageBps
    );
    const no1 = params.no0 - S;
    const yes1 = params.yes0 + minOut;
    let raw = yes1 < no1 ? yes1 : no1;
    raw = min3(raw, budget, params.maxPairByCustody);
    return params.floorRedeemGrid(raw);
  };
  let bestS = 0n;
  let bestScore = evalPair(0n);
  for (let i = 0n; i <= SEARCH_STEPS; i++) {
    const S = hi * i / SEARCH_STEPS;
    const sc = evalPair(S);
    if (sc > bestScore) {
      bestScore = sc;
      bestS = S;
    }
  }
  const span = hi / 48n + 1n;
  for (let d = -10n; d <= 10n; d++) {
    const S2 = bestS + d * span;
    if (S2 < 0n || S2 > hi) continue;
    const sc = evalPair(S2);
    if (sc > bestScore) {
      bestScore = sc;
      bestS = S2;
    }
  }
  if (bestScore <= 0n) return 0n;
  return bestS;
}
function uiSummaryForUsdc(params) {
  if (params.routeKind === "partial_usdc_exit") {
    return "Partially exited to USDC. Remaining position left in outcome tokens.";
  }
  return "Full exit to devnet USDC at the current redemption grid.";
}
async function computeSellOutcomeCore(params) {
  const slippageBps = params.slippageBps ?? 100;
  const rd = params.redemptionMintDecimals;
  const floorFn = (a) => floorRedemptionGrid(a, rd);
  const programId = requireOmnipairProgramId();
  const layout = deriveOmnipairLayout(
    programId,
    params.yesMint,
    params.noMint,
    DEFAULT_OMNIPAIR_POOL_PARAMS
  );
  if (!layout.pairAddress.equals(params.pairAddress)) {
    throw new Error(
      "pool_address does not match derived Omnipair pair for these mints."
    );
  }
  const custodyOwner = getMintPositionsCustodyOwnerFromEnv() ?? params.engine?.publicKey ?? loadMarketEngineAuthority()?.publicKey;
  if (!custodyOwner) {
    throw new Error(
      "Cannot resolve custody USDC owner \u2014 set MINT_POSITIONS_CUSTODY_PUBKEY or MARKET_ENGINE_AUTHORITY_SECRET."
    );
  }
  if (params.engine && !custodyOwner.equals(params.engine.publicKey)) {
    throw new Error(
      "Redeem USDC from custody requires the engine authority wallet to own custody (set MINT_POSITIONS_CUSTODY_PUBKEY to the engine pubkey, or unset)."
    );
  }
  const userYesAta = await outcomeAta(params.user, params.yesMint);
  const userNoAta = await outcomeAta(params.user, params.noMint);
  const userUsdcAta = await outcomeAta(params.user, DEVNET_USDC_MINT);
  const custodyUsdcAta = splToken.getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    custodyOwner,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  let yes0;
  let no0;
  if (params.outcomeBalances) {
    yes0 = params.outcomeBalances.yes;
    no0 = params.outcomeBalances.no;
  } else {
    yes0 = await readOutcomeBal(params.connection, userYesAta);
    no0 = await readOutcomeBal(params.connection, userNoAta);
  }
  let cap;
  if (params.capOutcomeAtoms != null) {
    const want = params.capOutcomeAtoms;
    cap = params.side === "yes" ? want > yes0 ? yes0 : want : want > no0 ? no0 : want;
  } else {
    const requested = parseOutcomeHumanToBaseUnits(params.outcomeAmountHuman.trim());
    if (requested <= 0n) {
      throw new Error("Enter a position size greater than zero to sell.");
    }
    cap = params.side === "yes" ? requested > yes0 ? yes0 : requested : requested > no0 ? no0 : requested;
  }
  if (cap <= 0n) {
    throw new Error("Insufficient outcome token balance to sell.");
  }
  const pairInfo = await params.connection.getAccountInfo(
    params.pairAddress,
    "confirmed"
  );
  if (!pairInfo?.data) throw new Error("Omnipair pair account missing");
  const pairDecodedFresh = decodeOmnipairPairAccount(pairInfo.data);
  const pairForSwapMath = params.pairDecodedForSwap ?? pairDecodedFresh;
  const { reserveYes, reserveNo } = vaultReservesForMints(
    pairForSwapMath,
    params.yesMint
  );
  const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await params.connection.getAccountInfo(futarchyPk, "confirmed");
  if (!futarchyInfo?.data) throw new Error("Futarchy authority account missing");
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);
  const custodyUsdcBal = await readUsdcBal(params.connection, custodyUsdcAta);
  const maxPairByCustody = maxPairedBurnAtomsForCustodyAdjusted(
    custodyUsdcBal,
    rd
  );
  logSell("pre-execution", {
    marketSlug: params.marketSlug,
    side: params.side,
    outcomeAmountHuman: params.capOutcomeAtoms != null ? `(explicit_cap ${params.capOutcomeAtoms.toString()})` : params.outcomeAmountHuman,
    reserveYes: reserveYes.toString(),
    reserveNo: reserveNo.toString(),
    yes0: yes0.toString(),
    no0: no0.toString(),
    cap: cap.toString(),
    maxPairByCustody: maxPairByCustody.toString(),
    custodyUsdcAtoms: custodyUsdcBal.toString()
  });
  let swapIn = 0n;
  let swapIx = null;
  if (params.side === "yes") {
    swapIn = bestSwapInSellYes({
      yes0,
      no0,
      cap,
      maxPairByCustody,
      pairDecoded: pairForSwapMath,
      futarchySwapShareBps,
      yesMint: params.yesMint,
      slippageBps,
      floorRedeemGrid: floorFn
    });
    if (swapIn > 0n) {
      const minOut = applySlippageFloor(
        estimateOmnipairSwapAmountOut({
          pair: pairForSwapMath,
          futarchySwapShareBps,
          amountIn: swapIn,
          isToken0In: params.yesMint.equals(pairForSwapMath.token0)
        }),
        slippageBps
      );
      if (minOut <= 0n) {
        swapIn = 0n;
      } else {
        swapIx = buildOmnipairSwapInstruction({
          programId,
          pair: params.pairAddress,
          rateModel: pairDecodedFresh.rateModel,
          tokenInMint: params.yesMint,
          tokenOutMint: params.noMint,
          user: params.user,
          userTokenIn: userYesAta,
          userTokenOut: userNoAta,
          amountIn: swapIn,
          minAmountOut: minOut
        });
      }
    }
  } else {
    swapIn = bestSwapInSellNo({
      yes0,
      no0,
      cap,
      maxPairByCustody,
      pairDecoded: pairForSwapMath,
      futarchySwapShareBps,
      noMint: params.noMint,
      slippageBps,
      floorRedeemGrid: floorFn
    });
    if (swapIn > 0n) {
      const minOut = applySlippageFloor(
        estimateOmnipairSwapAmountOut({
          pair: pairForSwapMath,
          futarchySwapShareBps,
          amountIn: swapIn,
          isToken0In: params.noMint.equals(pairForSwapMath.token0)
        }),
        slippageBps
      );
      if (minOut <= 0n) {
        swapIn = 0n;
      } else {
        swapIx = buildOmnipairSwapInstruction({
          programId,
          pair: params.pairAddress,
          rateModel: pairDecodedFresh.rateModel,
          tokenInMint: params.noMint,
          tokenOutMint: params.yesMint,
          user: params.user,
          userTokenIn: userNoAta,
          userTokenOut: userYesAta,
          amountIn: swapIn,
          minAmountOut: minOut
        });
      }
    }
  }
  const minOutYesSwap = swapIn > 0n && params.side === "yes" ? applySlippageFloor(
    estimateOmnipairSwapAmountOut({
      pair: pairForSwapMath,
      futarchySwapShareBps,
      amountIn: swapIn,
      isToken0In: params.yesMint.equals(pairForSwapMath.token0)
    }),
    slippageBps
  ) : 0n;
  const minOutNoSwap = swapIn > 0n && params.side === "no" ? applySlippageFloor(
    estimateOmnipairSwapAmountOut({
      pair: pairForSwapMath,
      futarchySwapShareBps,
      amountIn: swapIn,
      isToken0In: params.noMint.equals(pairForSwapMath.token0)
    }),
    slippageBps
  ) : 0n;
  let yes1;
  let no1Worst;
  if (swapIx === null) {
    yes1 = yes0;
    no1Worst = no0;
  } else if (params.side === "yes") {
    yes1 = yes0 - swapIn;
    no1Worst = no0 + minOutYesSwap;
  } else {
    no1Worst = no0 - swapIn;
    yes1 = yes0 + minOutNoSwap;
  }
  if (yes1 < 0n || no1Worst < 0n) {
    throw new Error(
      "Not enough opposite-side liquidity to fully exit into USDC right now."
    );
  }
  const sellBudgetRemain = cap > swapIn ? cap - swapIn : 0n;
  const pairSideMin = yes1 < no1Worst ? yes1 : no1Worst;
  const econEligible = pairSideMin < sellBudgetRemain ? pairSideMin : sellBudgetRemain;
  const eligiblePairedBurnOutcomeAtomsStr = floorFn(econEligible).toString();
  let rawEligible = econEligible > maxPairByCustody ? maxPairByCustody : econEligible;
  let pairedBurn = floorFn(rawEligible);
  let usdcOut = 0n;
  let routeKindUsdc = null;
  if (pairedBurn > 0n) {
    usdcOut = pairedOutcomeToUsdcAdjusted(pairedBurn, rd);
    if (usdcOut <= 0n) {
      pairedBurn = 0n;
    }
  }
  if (pairedBurn > 0n && usdcOut > 0n) {
    const totalExitOnSide = swapIn + pairedBurn;
    routeKindUsdc = totalExitOnSide >= cap ? "full_usdc_exit" : "partial_usdc_exit";
  }
  let routeKind = routeKindUsdc === "partial_usdc_exit" ? "partial_usdc_exit" : routeKindUsdc === "full_usdc_exit" ? "full_usdc_exit" : "fallback_pool_swap";
  let fallbackSwapIn = 0n;
  let fallbackMinOut = 0n;
  let fallbackIx = null;
  const rebalanceSwapInSnapshot = swapIn;
  if (pairedBurn <= 0n || usdcOut <= 0n) {
    const hi = params.side === "yes" ? cap < yes0 ? cap : yes0 : cap < no0 ? cap : no0;
    if (hi <= 0n) {
      throw new Error(
        "Not enough opposite-side liquidity to fully exit into USDC right now."
      );
    }
    fallbackSwapIn = hi;
    const estOut = estimateOmnipairSwapAmountOut({
      pair: pairForSwapMath,
      futarchySwapShareBps,
      amountIn: fallbackSwapIn,
      isToken0In: params.side === "yes" ? params.yesMint.equals(pairForSwapMath.token0) : params.noMint.equals(pairForSwapMath.token0)
    });
    fallbackMinOut = applySlippageFloor(estOut, slippageBps);
    if (fallbackMinOut <= 0n) {
      throw new Error(
        "Not enough opposite-side liquidity to fully exit into USDC right now."
      );
    }
    if (params.side === "yes") {
      fallbackIx = buildOmnipairSwapInstruction({
        programId,
        pair: params.pairAddress,
        rateModel: pairDecodedFresh.rateModel,
        tokenInMint: params.yesMint,
        tokenOutMint: params.noMint,
        user: params.user,
        userTokenIn: userYesAta,
        userTokenOut: userNoAta,
        amountIn: fallbackSwapIn,
        minAmountOut: fallbackMinOut
      });
    } else {
      fallbackIx = buildOmnipairSwapInstruction({
        programId,
        pair: params.pairAddress,
        rateModel: pairDecodedFresh.rateModel,
        tokenInMint: params.noMint,
        tokenOutMint: params.yesMint,
        user: params.user,
        userTokenIn: userNoAta,
        userTokenOut: userYesAta,
        amountIn: fallbackSwapIn,
        minAmountOut: fallbackMinOut
      });
    }
    routeKind = "fallback_pool_swap";
    pairedBurn = 0n;
    usdcOut = 0n;
    swapIx = fallbackIx;
    swapIn = fallbackSwapIn;
  }
  let leftoverYes;
  let leftoverNo;
  if (routeKind === "fallback_pool_swap") {
    if (params.side === "yes") {
      leftoverYes = yes0 - fallbackSwapIn;
      leftoverNo = no0 + fallbackMinOut;
    } else {
      leftoverYes = yes0 + fallbackMinOut;
      leftoverNo = no0 - fallbackSwapIn;
    }
  } else {
    leftoverYes = yes1 - pairedBurn;
    leftoverNo = no1Worst - pairedBurn;
  }
  let uiSummary;
  if (routeKind === "fallback_pool_swap") {
    uiSummary = "USDC exit unavailable for this amount right now; swapped into the opposite side instead.";
  } else if (routeKind === "partial_usdc_exit") {
    uiSummary = uiSummaryForUsdc({
      routeKind: "partial_usdc_exit"});
  } else {
    uiSummary = uiSummaryForUsdc({
      routeKind: "full_usdc_exit"});
  }
  const microLamports = Math.floor(Math.random() * 9e5) + 1;
  const ixs = [];
  if (!params.skipComputeBudgetInstruction) {
    ixs.push(web3_js.ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  }
  const ixUserUsdc = await maybeCreateUserUsdcAtaIx(
    params.connection,
    params.user
  );
  if (routeKind !== "fallback_pool_swap") {
    if (ixUserUsdc) ixs.push(ixUserUsdc);
    if (swapIx) ixs.push(swapIx);
    ixs.push(
      splToken.createBurnInstruction(
        userYesAta,
        params.yesMint,
        params.user,
        pairedBurn,
        [],
        splToken.TOKEN_PROGRAM_ID
      ),
      splToken.createBurnInstruction(
        userNoAta,
        params.noMint,
        params.user,
        pairedBurn,
        [],
        splToken.TOKEN_PROGRAM_ID
      ),
      splToken.createTransferInstruction(
        custodyUsdcAta,
        userUsdcAta,
        custodyOwner,
        usdcOut,
        [],
        splToken.TOKEN_PROGRAM_ID
      )
    );
  } else {
    if (swapIx) ixs.push(swapIx);
  }
  const log = {
    lastValidBlockHeight: 0,
    recentBlockhash: "",
    user: params.user.toBase58(),
    marketSlug: params.marketSlug,
    side: params.side,
    yesMint: params.yesMint.toBase58(),
    noMint: params.noMint.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    routeKind,
    reserveYes: reserveYes.toString(),
    reserveNo: reserveNo.toString(),
    requestedCapOutcomeAtoms: cap.toString(),
    eligiblePairedBurnOutcomeAtoms: eligiblePairedBurnOutcomeAtomsStr,
    pairedBurnOutcomeAtoms: pairedBurn.toString(),
    custodyUsdcAtoms: custodyUsdcBal.toString(),
    usdcOutAtoms: usdcOut.toString(),
    rebalanceSwapAmountIn: routeKind === "fallback_pool_swap" ? "0" : rebalanceSwapInSnapshot.toString(),
    leftoverYesAtoms: leftoverYes.toString(),
    leftoverNoAtoms: leftoverNo.toString(),
    fallbackSwapAmountIn: routeKind === "fallback_pool_swap" ? fallbackSwapIn.toString() : void 0,
    fallbackOppositeMinOut: routeKind === "fallback_pool_swap" ? fallbackMinOut.toString() : void 0,
    uiSummary,
    computeBudgetMicroLamports: microLamports,
    custodyOwner: custodyOwner.toBase58()
  };
  logSell("route-selected", {
    marketSlug: params.marketSlug,
    side: params.side,
    estimatedRoute: log.routeKind,
    reserveYes: log.reserveYes,
    reserveNo: log.reserveNo,
    requestedCapOutcomeAtoms: log.requestedCapOutcomeAtoms,
    eligiblePairedBurnOutcomeAtoms: log.eligiblePairedBurnOutcomeAtoms,
    pairedBurnOutcomeAtoms: log.pairedBurnOutcomeAtoms,
    usdcOutAtoms: log.usdcOutAtoms,
    rebalanceSwapAmountIn: log.rebalanceSwapAmountIn,
    leftoverYesAtoms: log.leftoverYesAtoms,
    leftoverNoAtoms: log.leftoverNoAtoms,
    fallbackSwapAmountIn: log.fallbackSwapAmountIn,
    fallbackOppositeMinOut: log.fallbackOppositeMinOut
  });
  if (!params.engine) {
    const { blockhash: blockhash2, lastValidBlockHeight: lastValidBlockHeight2 } = await params.connection.getLatestBlockhash("confirmed");
    return {
      log: { ...log, recentBlockhash: blockhash2, lastValidBlockHeight: lastValidBlockHeight2 },
      recentBlockhash: blockhash2,
      lastValidBlockHeight: lastValidBlockHeight2
    };
  }
  if (params.composeOnly) {
    const { blockhash: blockhash2, lastValidBlockHeight: lastValidBlockHeight2 } = await params.connection.getLatestBlockhash("confirmed");
    log.recentBlockhash = blockhash2;
    log.lastValidBlockHeight = lastValidBlockHeight2;
    return {
      log,
      instructions: ixs,
      recentBlockhash: blockhash2,
      lastValidBlockHeight: lastValidBlockHeight2
    };
  }
  const tx = new web3_js.Transaction();
  tx.add(...ixs);
  tx.feePayer = params.user;
  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.partialSign(params.engine);
  log.recentBlockhash = blockhash;
  log.lastValidBlockHeight = lastValidBlockHeight;
  logSell("built", {
    ...log,
    custodyOwner: custodyOwner.toBase58()
  });
  return {
    log,
    serialized: tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    }),
    recentBlockhash: blockhash,
    lastValidBlockHeight
  };
}
async function buildSellOutcomeForUsdcTransactionEngineSigned(params) {
  const result = await computeSellOutcomeCore({ ...params, engine: params.engine });
  if (!result.serialized) {
    throw new Error("Sell builder did not produce a transaction.");
  }
  return {
    serialized: result.serialized,
    log: result.log,
    recentBlockhash: result.recentBlockhash,
    lastValidBlockHeight: result.lastValidBlockHeight
  };
}
async function buildSellOutcomePairedRedeemInstructionsFromSnapshot(params) {
  const result = await computeSellOutcomeCore({
    ...params,
    outcomeAmountHuman: "",
    composeOnly: true
  });
  if (!result.instructions?.length) {
    throw new Error("Paired redeem instruction builder failed.");
  }
  return {
    instructions: result.instructions,
    log: result.log,
    recentBlockhash: result.recentBlockhash,
    lastValidBlockHeight: result.lastValidBlockHeight
  };
}
async function buildOmnipairRemoveLiquidityIxForUser(params) {
  const slippageBps = params.slippageBps ?? 100;
  if (params.liquidityIn <= 0n) {
    throw new Error("Enter a liquidity (LP) amount greater than zero.");
  }
  const programId = requireOmnipairProgramId();
  const layout = deriveOmnipairLayout(
    programId,
    params.yesMint,
    params.noMint,
    DEFAULT_OMNIPAIR_POOL_PARAMS
  );
  if (!layout.pairAddress.equals(params.pairAddress)) {
    throw new Error(
      "pool_address does not match derived Omnipair pair for these mints."
    );
  }
  const pairInfo = await params.connection.getAccountInfo(
    params.pairAddress,
    "confirmed"
  );
  if (!pairInfo?.data) throw new Error("Omnipair pair account missing");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);
  const t0 = layout.token0Mint;
  const t1 = layout.token1Mint;
  const userT0 = splToken.getAssociatedTokenAddressSync(
    t0,
    params.user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userT1 = splToken.getAssociatedTokenAddressSync(
    t1,
    params.user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userLp = splToken.getAssociatedTokenAddressSync(
    pairDecoded.lpMint,
    params.user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const lpAcc = await splToken.getAccount(
    params.connection,
    userLp,
    "confirmed",
    splToken.TOKEN_PROGRAM_ID
  );
  if (lpAcc.amount < params.liquidityIn) {
    throw new Error("Insufficient LP balance for this withdraw amount.");
  }
  const lpMintInfo = await splToken.getMint(params.connection, pairDecoded.lpMint);
  const totalSupply = lpMintInfo.supply;
  if (totalSupply === 0n) {
    throw new Error("LP total supply is zero.");
  }
  const { min0, min1 } = estimateRemoveMinOuts({
    reserve0: pairDecoded.reserve0,
    reserve1: pairDecoded.reserve1,
    totalSupplyLp: totalSupply,
    liquidityIn: params.liquidityIn,
    slippageBps
  });
  const removeIx = buildOmnipairRemoveLiquidityInstruction({
    programId,
    pair: params.pairAddress,
    rateModel: pairDecoded.rateModel,
    token0Mint: t0,
    token1Mint: t1,
    userToken0: userT0,
    userToken1: userT1,
    userLp,
    lpMint: pairDecoded.lpMint,
    user: params.user,
    liquidityIn: params.liquidityIn,
    minAmount0Out: min0,
    minAmount1Out: min1
  });
  return {
    instruction: removeIx,
    pairDecoded,
    minAmount0Out: min0,
    minAmount1Out: min1,
    totalLpSupply: totalSupply,
    token0Mint: t0,
    token1Mint: t1
  };
}

// ../../lib/solana/withdraw-omnipair-liquidity-to-usdc.ts
var OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS = 2n;
async function readUserOmnipairLpBalance(connection, user, lpMint) {
  const ata = splToken.getAssociatedTokenAddressSync(
    lpMint,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  try {
    const a = await splToken.getAccount(connection, ata, "confirmed", splToken.TOKEN_PROGRAM_ID);
    return { ata, amount: a.amount };
  } catch {
    return { ata, amount: 0n };
  }
}
function pairAfterRemoveNetOut(pair, netAmount0Out, netAmount1Out) {
  const r0 = pair.reserve0 - netAmount0Out;
  const r1 = pair.reserve1 - netAmount1Out;
  if (r0 < 0n || r1 < 0n) {
    throw new Error("Pool remove estimate produced negative reserves.");
  }
  return { ...pair, reserve0: r0, reserve1: r1 };
}
async function readOutcomeBal2(connection, ata) {
  try {
    const a = await splToken.getAccount(connection, ata, "confirmed", splToken.TOKEN_PROGRAM_ID);
    return a.amount;
  } catch {
    return 0n;
  }
}
function atomsToDecimalString(atoms, decimals, maxFrac) {
  if (decimals <= 0) return atoms.toString();
  const neg = atoms < 0n;
  const a = neg ? -atoms : atoms;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, "0").slice(0, maxFrac);
  frac = frac.replace(/0+$/, "");
  const sign = neg ? "-" : "";
  return frac.length ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}
async function projectedBalancesAfterRemove(params, removeBundle) {
  const bundle = removeBundle ?? await buildOmnipairRemoveLiquidityIxForUser({
    connection: params.connection,
    user: params.user,
    yesMint: params.yesMint,
    noMint: params.noMint,
    pairAddress: params.pairAddress,
    liquidityIn: params.liquidityIn,
    slippageBps: params.slippageBps
  });
  const {
    pairDecoded,
    totalLpSupply,
    token0Mint,
    minAmount0Out: min0,
    minAmount1Out: min1
  } = bundle;
  const g = estimateRemoveLiquidityGrossOut({
    reserve0: pairDecoded.reserve0,
    reserve1: pairDecoded.reserve1,
    totalSupplyLp: totalLpSupply,
    liquidityIn: params.liquidityIn
  });
  const f0 = applyLiquidityWithdrawalFee(g.amount0);
  const f1 = applyLiquidityWithdrawalFee(g.amount1);
  const expected0 = f0.out;
  const expected1 = f1.out;
  const yesFromRemoveWorst = token0Mint.equals(params.yesMint) ? min0 : min1;
  const noFromRemoveWorst = token0Mint.equals(params.yesMint) ? min1 : min0;
  const expectedYesFromRemove = token0Mint.equals(params.yesMint) ? expected0 : expected1;
  const expectedNoFromRemove = token0Mint.equals(params.yesMint) ? expected1 : expected0;
  const pairForSwap = pairAfterRemoveNetOut(pairDecoded, min0, min1);
  const userYesAta = splToken.getAssociatedTokenAddressSync(
    params.yesMint,
    params.user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userNoAta = splToken.getAssociatedTokenAddressSync(
    params.noMint,
    params.user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userYesBal = await readOutcomeBal2(params.connection, userYesAta);
  const userNoBal = await readOutcomeBal2(params.connection, userNoAta);
  const yesAfter = userYesBal + yesFromRemoveWorst;
  const noAfter = userNoBal + noFromRemoveWorst;
  const side = yesAfter >= noAfter ? "yes" : "no";
  const cap = side === "yes" ? yesAfter : noAfter;
  return {
    removeBundle: bundle,
    pairDecoded,
    totalLpSupply,
    token0Mint,
    min0,
    min1,
    expected0,
    expected1,
    yesFromRemoveWorst,
    noFromRemoveWorst,
    expectedYesFromRemove,
    expectedNoFromRemove,
    yesAfter,
    noAfter,
    pairForSwap,
    side,
    cap
  };
}
async function computeWithdrawToUsdcSellPlanningArgs(params) {
  const [rd, proj] = await Promise.all([
    fetchRedemptionMintDecimals(
      params.connection,
      params.yesMint,
      params.noMint
    ),
    projectedBalancesAfterRemove(
      {
        connection: params.connection,
        user: params.user,
        yesMint: params.yesMint,
        noMint: params.noMint,
        pairAddress: params.pairAddress,
        liquidityIn: params.liquidityIn,
        slippageBps: params.slippageBps
      },
      params.removeBundle
    )
  ]);
  const yAdj = proj.yesAfter > OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS ? proj.yesAfter - OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS : 0n;
  const nAdj = proj.noAfter > OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS ? proj.noAfter - OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS : 0n;
  const side = yAdj >= nAdj ? "yes" : "no";
  const cap = side === "yes" ? yAdj : nAdj;
  return {
    rd,
    proj,
    outcomeBalances: { yes: yAdj, no: nAdj },
    cap,
    side
  };
}
async function buildWithdrawOmnipairLiquidityToUsdcTransactionEngineSigned(params) {
  const slippageBps = params.slippageBps ?? 100;
  const removeBundle = await buildOmnipairRemoveLiquidityIxForUser({
    connection: params.connection,
    user: params.user,
    yesMint: params.yesMint,
    noMint: params.noMint,
    pairAddress: params.pairAddress,
    liquidityIn: params.liquidityIn,
    slippageBps
  });
  const {
    instruction: removeIx,
    pairDecoded,
    totalLpSupply,
    minAmount0Out: min0,
    minAmount1Out: min1
  } = removeBundle;
  const userLp = await readUserOmnipairLpBalance(
    params.connection,
    params.user,
    pairDecoded.lpMint
  );
  if (params.liquidityIn > userLp.amount) {
    throw new Error(
      "Withdraw amount exceeds omLP balance. Refresh and use Max."
    );
  }
  const sellArgs = await computeWithdrawToUsdcSellPlanningArgs({
    connection: params.connection,
    user: params.user,
    yesMint: params.yesMint,
    noMint: params.noMint,
    pairAddress: params.pairAddress,
    liquidityIn: params.liquidityIn,
    slippageBps,
    removeBundle
  });
  const { rd, proj, outcomeBalances, cap, side } = sellArgs;
  const userYesAta = splToken.getAssociatedTokenAddressSync(
    params.yesMint,
    params.user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userNoAta = splToken.getAssociatedTokenAddressSync(
    params.noMint,
    params.user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [userYesBefore, userNoBefore, lpDecimalsResolved] = await Promise.all([
    readOutcomeBal2(params.connection, userYesAta),
    readOutcomeBal2(params.connection, userNoAta),
    params.lpDecimals != null ? Promise.resolve(params.lpDecimals) : splToken.getMint(params.connection, pairDecoded.lpMint).then(
      (m) => m.decimals
    )
  ]);
  const redeemPart = await buildSellOutcomePairedRedeemInstructionsFromSnapshot({
    connection: params.connection,
    engine: params.engine,
    user: params.user,
    side,
    yesMint: params.yesMint,
    noMint: params.noMint,
    pairAddress: params.pairAddress,
    marketSlug: params.marketSlug,
    slippageBps,
    outcomeBalances,
    capOutcomeAtoms: cap,
    pairDecodedForSwap: proj.pairForSwap,
    skipComputeBudgetInstruction: true,
    redemptionMintDecimals: rd
  });
  console.info(
    "[predicted][withdraw-usdc-build-debug]",
    JSON.stringify({
      marketSlug: params.marketSlug ?? null,
      user: params.user.toBase58(),
      liquidityHuman: params.liquidityHuman ?? null,
      liquidityInRaw: params.liquidityIn.toString(),
      omLpMint: pairDecoded.lpMint.toBase58(),
      omLpDecimals: lpDecimalsResolved,
      userOmLpAta: userLp.ata.toBase58(),
      userOmLpBalanceRaw: userLp.amount.toString(),
      userOmLpBalanceHuman: atomsToDecimalString(
        userLp.amount,
        lpDecimalsResolved,
        8
      ),
      userYesAta: userYesAta.toBase58(),
      userNoAta: userNoAta.toBase58(),
      userYesBalanceBeforeRaw: userYesBefore.toString(),
      userNoBalanceBeforeRaw: userNoBefore.toString(),
      userYesBeforeHuman: atomsToDecimalString(userYesBefore, rd.outcome, 8),
      userNoBeforeHuman: atomsToDecimalString(userNoBefore, rd.outcome, 8),
      yesFromRemoveWorstRaw: proj.yesFromRemoveWorst.toString(),
      noFromRemoveWorstRaw: proj.noFromRemoveWorst.toString(),
      expectedYesFromRemoveRaw: proj.expectedYesFromRemove.toString(),
      expectedNoFromRemoveRaw: proj.expectedNoFromRemove.toString(),
      yesAfterRemoveWorstRaw: proj.yesAfter.toString(),
      noAfterRemoveWorstRaw: proj.noAfter.toString(),
      outcomePlanBufferAtoms: OUTCOME_WITHDRAW_PLAN_BUFFER_ATOMS.toString(),
      sellPlanYesRaw: outcomeBalances.yes.toString(),
      sellPlanNoRaw: outcomeBalances.no.toString(),
      sellPlanCapRaw: cap.toString(),
      sellPlanSide: side,
      plannedPairedBurnRaw: redeemPart.log.pairedBurnOutcomeAtoms,
      plannedRebalanceSwapIn: redeemPart.log.rebalanceSwapAmountIn,
      plannedUsdcOutAtoms: redeemPart.log.usdcOutAtoms,
      leftoverYesAtoms: redeemPart.log.leftoverYesAtoms,
      leftoverNoAtoms: redeemPart.log.leftoverNoAtoms
    })
  );
  const microLamports = Math.floor(Math.random() * 9e5) + 1;
  const merged = new web3_js.Transaction();
  merged.add(web3_js.ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  merged.add(removeIx);
  merged.add(...redeemPart.instructions);
  merged.feePayer = params.user;
  merged.recentBlockhash = redeemPart.recentBlockhash;
  merged.lastValidBlockHeight = redeemPart.lastValidBlockHeight;
  merged.partialSign(params.engine);
  const removeLog = {
    user: params.user.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    liquidityIn: params.liquidityIn.toString(),
    minAmount0Out: min0.toString(),
    minAmount1Out: min1.toString(),
    poolStateBefore: {
      reserve0: pairDecoded.reserve0.toString(),
      reserve1: pairDecoded.reserve1.toString(),
      totalLpSupply: totalLpSupply.toString()
    }
  };
  return {
    serialized: merged.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    }),
    log: { remove: removeLog, redeem: redeemPart.log },
    recentBlockhash: redeemPart.recentBlockhash,
    lastValidBlockHeight: redeemPart.lastValidBlockHeight
  };
}

// src/liquidity.ts
async function runDepositLiquidity(p) {
  const usdcAmountAtoms = parseUsdcHumanToBaseUnits(p.usdcAmount);
  if (usdcAmountAtoms <= 0n) {
    throw new Error("usdcAmount must be greater than zero.");
  }
  const { serialized, log } = await buildProvideLiquidityWithUsdcTransactionEngineSigned(
    {
      connection: p.connection,
      engine: p.engine,
      user: p.wallet.publicKey,
      yesMint: toPublicKey(p.market.yesMint, "yesMint"),
      noMint: toPublicKey(p.market.noMint, "noMint"),
      pairAddress: toPublicKey(p.market.pairAddress, "pairAddress"),
      usdcAmountAtoms,
      marketSlug: p.marketSlug,
      slippageBps: p.slippageBps
    }
  );
  const tx = web3_js.Transaction.from(serialized);
  const signature = await sendSignedTransaction({
    connection: p.connection,
    transaction: tx,
    signTransaction: (t) => p.wallet.signTransaction(t)
  });
  return {
    signature,
    explorerUrl: solanaTransactionExplorerUrl(signature, p.cluster),
    estimated: { lpTokens: log.estimatedLiquidityOut }
  };
}
async function runWithdrawLiquidityToUsdc(p) {
  const pairAddress = toPublicKey(p.market.pairAddress, "pairAddress");
  const acc = await p.connection.getAccountInfo(pairAddress, "confirmed");
  if (!acc?.data) throw new Error("Omnipair pair account not found for pairAddress.");
  const decoded = decodeOmnipairPairAccount(acc.data);
  const lpDec = (await splToken.getMint(p.connection, decoded.lpMint, "confirmed")).decimals;
  const liquidityIn = humanToTokenAtoms(p.lpAmount, lpDec, "lpAmount");
  if (liquidityIn <= 0n) {
    throw new Error("lpAmount must be greater than zero.");
  }
  const { serialized, log } = await buildWithdrawOmnipairLiquidityToUsdcTransactionEngineSigned({
    connection: p.connection,
    engine: p.engine,
    user: p.wallet.publicKey,
    yesMint: toPublicKey(p.market.yesMint, "yesMint"),
    noMint: toPublicKey(p.market.noMint, "noMint"),
    pairAddress,
    liquidityIn,
    marketSlug: p.marketSlug,
    slippageBps: p.slippageBps
  });
  const tx = web3_js.Transaction.from(serialized);
  const signature = await sendSignedTransaction({
    connection: p.connection,
    transaction: tx,
    signTransaction: (t) => p.wallet.signTransaction(t)
  });
  return {
    signature,
    explorerUrl: solanaTransactionExplorerUrl(signature, p.cluster),
    estimated: { usdcOut: log.redeem.usdcOutAtoms }
  };
}
var ATOMS_GRID = 10n ** (BigInt(OUTCOME_MINT_DECIMALS) - BigInt(MINT_POSITIONS_USDC_DECIMALS));
async function maybeCreateUserUsdcAtaIx2(connection, user) {
  const ata = splToken.getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (info) return null;
  return splToken.createAssociatedTokenAccountIdempotentInstruction(
    user,
    ata,
    user,
    DEVNET_USDC_MINT,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
}
async function readOutcomeBal3(connection, ata) {
  try {
    const a = await splToken.getAccount(connection, ata, "confirmed", splToken.TOKEN_PROGRAM_ID);
    return a.amount;
  } catch {
    return 0n;
  }
}
async function readUsdcBal2(connection, ata) {
  try {
    const a = await splToken.getAccount(connection, ata, "confirmed", splToken.TOKEN_PROGRAM_ID);
    return a.amount;
  } catch {
    return 0n;
  }
}
var SETTLEMENT = "[predicted][resolved-settlement]";
function logResolvedSettlement(payload) {
  console.info(SETTLEMENT, JSON.stringify(payload));
}
function sizeBurnToCustody(cap, custodyUsdcBal) {
  if (cap <= 0n || custodyUsdcBal <= 0n) {
    return { burnAtoms: 0n, usdcOut: 0n };
  }
  const maxByCustody = floorOutcomeAtomsToRedemptionGrid(
    usdcBaseUnitsToOutcomeBaseUnits(custodyUsdcBal)
  );
  const raw = cap < maxByCustody ? cap : maxByCustody;
  let burnAtoms = floorOutcomeAtomsToRedemptionGrid(raw);
  if (burnAtoms <= 0n) {
    return { burnAtoms: 0n, usdcOut: 0n };
  }
  let usdcOut = outcomeBaseUnitsToUsdcBaseUnits(burnAtoms);
  while (usdcOut > custodyUsdcBal && burnAtoms >= ATOMS_GRID) {
    burnAtoms -= ATOMS_GRID;
    burnAtoms = floorOutcomeAtomsToRedemptionGrid(burnAtoms);
    if (burnAtoms <= 0n) return { burnAtoms: 0n, usdcOut: 0n };
    usdcOut = outcomeBaseUnitsToUsdcBaseUnits(burnAtoms);
  }
  if (usdcOut > custodyUsdcBal) {
    return { burnAtoms: 0n, usdcOut: 0n };
  }
  return { burnAtoms, usdcOut };
}
async function planResolvedWinnerRedeem(p) {
  const {
    user,
    side,
    winningOutcome,
    yesMint,
    noMint,
    connection,
    outcomeAmountHuman,
    marketSlug
  } = p;
  if (side !== winningOutcome) {
    throw new Error(
      "After resolution, only the winning outcome can be redeemed for USDC. The losing side has no value."
    );
  }
  const custodyOwner = getMintPositionsCustodyOwnerFromEnv() ?? loadMarketEngineAuthority()?.publicKey;
  if (!custodyOwner) {
    throw new Error(
      "Cannot resolve custody USDC owner \u2014 set MINT_POSITIONS_CUSTODY_PUBKEY or MARKET_ENGINE_AUTHORITY_SECRET."
    );
  }
  const custodyUsdcAta = splToken.getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    custodyOwner,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const custodyUsdcBal = await readUsdcBal2(connection, custodyUsdcAta);
  const winMint = side === "yes" ? yesMint : noMint;
  const userWinAta = splToken.getAssociatedTokenAddressSync(
    winMint,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const winBal = await readOutcomeBal3(connection, userWinAta);
  const userYesAta = splToken.getAssociatedTokenAddressSync(
    yesMint,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userNoAta = splToken.getAssociatedTokenAddressSync(
    noMint,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const yes0 = await readOutcomeBal3(connection, userYesAta);
  const no0 = await readOutcomeBal3(connection, userNoAta);
  const requested = parseOutcomeHumanToBaseUnits(outcomeAmountHuman.trim());
  if (requested <= 0n) {
    throw new Error("Enter a position size greater than zero to redeem.");
  }
  const cap = requested > winBal ? winBal : requested;
  if (cap <= 0n) {
    throw new Error("No winning outcome balance to redeem.");
  }
  const { burnAtoms, usdcOut } = sizeBurnToCustody(cap, custodyUsdcBal);
  if (burnAtoms <= 0n || usdcOut <= 0n) {
    throw new Error(
      "Insufficient USDC in protocol custody to complete this redemption. Try a smaller amount."
    );
  }
  const leftYes = side === "yes" ? yes0 - burnAtoms : yes0;
  const leftNo = side === "no" ? no0 - burnAtoms : no0;
  logResolvedSettlement({
    slug: marketSlug ?? "",
    winningOutcome,
    userYesBalance: yes0.toString(),
    userNoBalance: no0.toString(),
    payoutUsdc: usdcOut.toString()
  });
  return {
    routeKind: "resolved_winner_redeem",
    reserveYes: "0",
    reserveNo: "0",
    requestedCapOutcomeAtoms: cap.toString(),
    eligiblePairedBurnOutcomeAtoms: "0",
    pairedBurnOutcomeAtoms: "0",
    custodyUsdcAtoms: custodyUsdcBal.toString(),
    usdcOutAtoms: usdcOut.toString(),
    winningBurnOutcomeAtoms: burnAtoms.toString(),
    rebalanceSwapAmountIn: "0",
    leftoverYesAtoms: leftYes.toString(),
    leftoverNoAtoms: leftNo.toString(),
    uiSummary: "Resolved settlement: 1 USDC per outcome unit of the winning side (mint parity), from custody. No AMM or paired burn."
  };
}
async function buildResolvedWinnerRedeemTransactionEngineSigned(params) {
  if (!params.engine) {
    throw new Error("Engine keypair required to sign custody USDC transfer.");
  }
  const plan = await planResolvedWinnerRedeem({
    connection: params.connection,
    user: params.user,
    side: params.side,
    winningOutcome: params.winningOutcome,
    yesMint: params.yesMint,
    noMint: params.noMint,
    outcomeAmountHuman: params.outcomeAmountHuman,
    marketSlug: params.marketSlug
  });
  const burnAtoms = BigInt(plan.winningBurnOutcomeAtoms);
  const usdcOut = BigInt(plan.usdcOutAtoms);
  if (burnAtoms <= 0n || usdcOut <= 0n) {
    throw new Error("Invalid resolved redemption build.");
  }
  const { user, side, yesMint, noMint, marketSlug, connection } = params;
  const custodyOwner = getMintPositionsCustodyOwnerFromEnv() ?? params.engine.publicKey;
  if (!custodyOwner.equals(params.engine.publicKey)) {
    throw new Error(
      "MINT_POSITIONS_CUSTODY_PUBKEY must be the market engine for custody USDC release."
    );
  }
  const winMint = side === "yes" ? yesMint : noMint;
  const userWinAta = splToken.getAssociatedTokenAddressSync(
    winMint,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userUsdcAta = splToken.getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    user,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const custodyUsdcAta = splToken.getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    custodyOwner,
    false,
    splToken.TOKEN_PROGRAM_ID,
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const microLamports = Math.floor(Math.random() * 9e5) + 1;
  const ixs = [
    web3_js.ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
  ];
  const ixUserUsdc = await maybeCreateUserUsdcAtaIx2(connection, user);
  if (ixUserUsdc) ixs.push(ixUserUsdc);
  ixs.push(
    splToken.createBurnInstruction(
      userWinAta,
      winMint,
      user,
      burnAtoms,
      [],
      splToken.TOKEN_PROGRAM_ID
    ),
    splToken.createTransferInstruction(
      custodyUsdcAta,
      userUsdcAta,
      custodyOwner,
      usdcOut,
      [],
      splToken.TOKEN_PROGRAM_ID
    )
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new web3_js.Transaction();
  tx.add(...ixs);
  tx.feePayer = user;
  tx.recentBlockhash = blockhash;
  tx.partialSign(params.engine);
  const fullLog = {
    lastValidBlockHeight,
    recentBlockhash: blockhash,
    user: user.toBase58(),
    marketSlug,
    side: params.side,
    yesMint: yesMint.toBase58(),
    noMint: noMint.toBase58(),
    pairAddress: params.poolAddress.toBase58(),
    routeKind: "resolved_winner_redeem",
    reserveYes: plan.reserveYes,
    reserveNo: plan.reserveNo,
    requestedCapOutcomeAtoms: plan.requestedCapOutcomeAtoms,
    eligiblePairedBurnOutcomeAtoms: plan.eligiblePairedBurnOutcomeAtoms,
    pairedBurnOutcomeAtoms: plan.pairedBurnOutcomeAtoms,
    custodyUsdcAtoms: plan.custodyUsdcAtoms,
    usdcOutAtoms: plan.usdcOutAtoms,
    rebalanceSwapAmountIn: "0",
    leftoverYesAtoms: plan.leftoverYesAtoms,
    leftoverNoAtoms: plan.leftoverNoAtoms,
    uiSummary: plan.uiSummary,
    computeBudgetMicroLamports: microLamports,
    custodyOwner: custodyOwner.toBase58(),
    winningBurnOutcomeAtoms: plan.winningBurnOutcomeAtoms
  };
  return {
    log: fullLog,
    serialized: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    recentBlockhash: blockhash,
    lastValidBlockHeight
  };
}

// src/resolver.ts
async function runResolveMarketRedemption(p) {
  const { log, serialized } = await buildResolvedWinnerRedeemTransactionEngineSigned({
    connection: p.connection,
    user: p.wallet.publicKey,
    side: p.side,
    winningOutcome: p.winningOutcome,
    yesMint: toPublicKey(p.market.yesMint, "yesMint"),
    noMint: toPublicKey(p.market.noMint, "noMint"),
    poolAddress: toPublicKey(p.market.pairAddress, "pairAddress"),
    outcomeAmountHuman: p.outcomeAmount,
    marketSlug: p.marketSlug,
    engine: p.engine
  });
  const tx = web3_js.Transaction.from(serialized);
  const signature = await sendSignedTransaction({
    connection: p.connection,
    transaction: tx,
    signTransaction: (t) => p.wallet.signTransaction(t)
  });
  return {
    signature,
    explorerUrl: solanaTransactionExplorerUrl(signature, p.cluster),
    estimated: { usdcOut: log.usdcOutAtoms },
    summary: log.uiSummary
  };
}
function logBuyOutcome(tag, payload) {
  console.info(`[predicted][buy-outcome-usdc] ${tag}`, JSON.stringify(payload));
}
async function buildBuyOutcomeWithUsdcTransactionEngineSigned(params) {
  const slippageBps = params.slippageBps ?? 100;
  const programId = requireOmnipairProgramId();
  const layout = deriveOmnipairLayout(
    programId,
    params.yesMint,
    params.noMint,
    DEFAULT_OMNIPAIR_POOL_PARAMS
  );
  if (!layout.pairAddress.equals(params.pairAddress)) {
    throw new Error(
      "pool_address does not match derived Omnipair pair for these mints."
    );
  }
  const custodyOwner = getMintPositionsCustodyOwnerFromEnv() ?? params.engine.publicKey;
  const mintAuthority = params.engine.publicKey;
  const mintPart = await buildMintPositionsInstructions({
    connection: params.connection,
    user: params.user,
    mintAuthority,
    custodyOwner,
    yesMint: params.yesMint,
    noMint: params.noMint,
    usdcMint: DEVNET_USDC_MINT,
    usdcAmountAtoms: params.usdcAmountAtoms
  });
  const { outcomeMintAtoms, userYesAta, userNoAta } = mintPart;
  const pairInfo = await params.connection.getAccountInfo(params.pairAddress, "confirmed");
  if (!pairInfo?.data) throw new Error("Omnipair pair account missing");
  const pairDecoded = decodeOmnipairPairAccount(pairInfo.data);
  const [futarchyPk] = getGlobalFutarchyAuthorityPDA(programId);
  const futarchyInfo = await params.connection.getAccountInfo(futarchyPk, "confirmed");
  if (!futarchyInfo?.data) throw new Error("Futarchy authority account missing");
  const futarchySwapShareBps = decodeFutarchySwapShareBps(futarchyInfo.data);
  const tokenInMint = params.side === "yes" ? params.noMint : params.yesMint;
  const tokenOutMint = params.side === "yes" ? params.yesMint : params.noMint;
  const userTokenIn = params.side === "yes" ? userNoAta : userYesAta;
  const userTokenOut = params.side === "yes" ? userYesAta : userNoAta;
  const isToken0In = tokenInMint.equals(pairDecoded.token0);
  const estimatedSwapAmountOut = estimateOmnipairSwapAmountOut({
    pair: pairDecoded,
    futarchySwapShareBps,
    amountIn: outcomeMintAtoms,
    isToken0In
  });
  const minSwapAmountOut = applySlippageFloor(estimatedSwapAmountOut, slippageBps);
  const swapIx = buildOmnipairSwapInstruction({
    programId,
    pair: params.pairAddress,
    rateModel: pairDecoded.rateModel,
    tokenInMint,
    tokenOutMint,
    user: params.user,
    userTokenIn,
    userTokenOut,
    amountIn: outcomeMintAtoms,
    minAmountOut: minSwapAmountOut
  });
  const tx = new web3_js.Transaction();
  const microLamports = Math.floor(Math.random() * 9e5) + 1;
  tx.add(web3_js.ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.add(...mintPart.instructions, swapIx);
  tx.feePayer = params.user;
  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.partialSign(params.engine);
  const estimatedFinalChosenSideAtoms = (outcomeMintAtoms + estimatedSwapAmountOut).toString();
  const log = {
    lastValidBlockHeight,
    recentBlockhash: blockhash,
    user: params.user.toBase58(),
    marketSlug: params.marketSlug,
    side: params.side,
    yesMint: params.yesMint.toBase58(),
    noMint: params.noMint.toBase58(),
    pairAddress: params.pairAddress.toBase58(),
    usdcAmountAtoms: params.usdcAmountAtoms.toString(),
    outcomeMintAtomsYes: outcomeMintAtoms.toString(),
    outcomeMintAtomsNo: outcomeMintAtoms.toString(),
    swapTokenInMint: tokenInMint.toBase58(),
    swapTokenOutMint: tokenOutMint.toBase58(),
    swapAmountIn: outcomeMintAtoms.toString(),
    estimatedSwapAmountOut: estimatedSwapAmountOut.toString(),
    minSwapAmountOut: minSwapAmountOut.toString(),
    estimatedFinalChosenSideAtoms
  };
  logBuyOutcome("built", {
    ...log,
    computeBudgetMicroLamports: microLamports,
    buyYesNote: params.side === "yes" ? "mint paired then NO\u2192YES swap using full NO minted" : "mint paired then YES\u2192NO swap using full YES minted"
  });
  return {
    serialized: tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    }),
    log,
    recentBlockhash: blockhash,
    lastValidBlockHeight
  };
}

// src/trade.ts
async function runBuyOutcome(p) {
  const usdcAmountAtoms = parseUsdcHumanToBaseUnits(p.usdcAmount);
  if (usdcAmountAtoms <= 0n) {
    throw new Error("usdcAmount must be greater than zero.");
  }
  const { serialized, log } = await buildBuyOutcomeWithUsdcTransactionEngineSigned({
    connection: p.connection,
    engine: p.engine,
    user: p.wallet.publicKey,
    side: p.side,
    yesMint: toPublicKey(p.market.yesMint, "yesMint"),
    noMint: toPublicKey(p.market.noMint, "noMint"),
    pairAddress: toPublicKey(p.market.pairAddress, "pairAddress"),
    usdcAmountAtoms,
    marketSlug: p.marketSlug,
    slippageBps: p.slippageBps
  });
  const tx = web3_js.Transaction.from(serialized);
  const signature = await sendSignedTransaction({
    connection: p.connection,
    transaction: tx,
    signTransaction: (t) => p.wallet.signTransaction(t)
  });
  return {
    signature,
    explorerUrl: solanaTransactionExplorerUrl(signature, p.cluster),
    estimated: { chosenSideTokens: log.estimatedFinalChosenSideAtoms }
  };
}
async function runSellOutcome(p) {
  const { serialized, log } = await buildSellOutcomeForUsdcTransactionEngineSigned({
    connection: p.connection,
    engine: p.engine,
    user: p.wallet.publicKey,
    side: p.side,
    yesMint: toPublicKey(p.market.yesMint, "yesMint"),
    noMint: toPublicKey(p.market.noMint, "noMint"),
    pairAddress: toPublicKey(p.market.pairAddress, "pairAddress"),
    outcomeAmountHuman: p.outcomeAmount,
    marketSlug: p.marketSlug,
    slippageBps: p.slippageBps
  });
  const tx = web3_js.Transaction.from(serialized);
  const signature = await sendSignedTransaction({
    connection: p.connection,
    transaction: tx,
    signTransaction: (t) => p.wallet.signTransaction(t)
  });
  return {
    signature,
    explorerUrl: solanaTransactionExplorerUrl(signature, p.cluster),
    estimated: { usdcOut: log.usdcOutAtoms },
    summary: log.uiSummary
  };
}

// src/client.ts
function assertDevnetForNow(cluster) {
  if (cluster !== "devnet") {
    throw new Error(
      "predicted-sdk: this release is wired for devnet only. TODO: mainnet-beta \u2014 program + USDC mint + custody and RPC policy."
    );
  }
}
var PredictedClient = class {
  constructor(config) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.cluster = config.cluster;
    this.engine = config.engine;
    this.teamTreasury = config.teamTreasury === void 0 ? void 0 : toPublicKey(config.teamTreasury, "teamTreasury").toBase58();
    applyOmnipairProgramId(config.omnipairProgramId);
  }
  /**
   * Initialize the Omnipair pool for an existing YES/NO mint pair. Requires a funded bootstrap on the
   * engine ATAs. Team treasury (WSOL fee recipient context) is taken from the client config or
   * overridden in this call.
   */
  async createMarket(params) {
    assertDevnetForNow(this.cluster);
    const team = params.teamTreasury ?? this.teamTreasury;
    if (team === void 0) {
      throw new Error(
        "createMarket: set `teamTreasury` on PredictedClient or pass `teamTreasury` in this call (devnet OMNIPAIR_TEAM_TREASURY)."
      );
    }
    const teamResolved = toPublicKey(team, "teamTreasury").toBase58();
    return runCreateOmnipairMarket({
      connection: this.connection,
      engine: this.engine,
      cluster: this.cluster,
      teamTreasury: teamResolved,
      yesMint: params.yesMint,
      noMint: params.noMint,
      authorityYesAta: params.authorityYesAta,
      authorityNoAta: params.authorityNoAta,
      bootstrapPerSide: params.bootstrapPerSide
    });
  }
  async buyOutcome(market, side, usdcAmount, opts) {
    assertDevnetForNow(this.cluster);
    const p = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      side,
      usdcAmount,
      slippageBps: opts?.slippageBps,
      marketSlug: opts?.marketSlug
    };
    return runBuyOutcome(p);
  }
  async sellOutcome(market, side, outcomeAmount, opts) {
    assertDevnetForNow(this.cluster);
    const p = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      side,
      outcomeAmount,
      slippageBps: opts?.slippageBps,
      marketSlug: opts?.marketSlug
    };
    return runSellOutcome(p);
  }
  async depositLiquidity(market, usdcAmount, opts) {
    assertDevnetForNow(this.cluster);
    const p = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      usdcAmount,
      slippageBps: opts?.slippageBps,
      marketSlug: opts?.marketSlug
    };
    return runDepositLiquidity(p);
  }
  /**
   * Remove omLP and unwind to **devnet USDC** in one flow (user + engine co-signed).
   */
  async withdrawLiquidity(market, lpAmount, opts) {
    assertDevnetForNow(this.cluster);
    const p = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      lpAmount,
      slippageBps: opts?.slippageBps,
      marketSlug: opts?.marketSlug
    };
    return runWithdrawLiquidityToUsdc(p);
  }
  /**
   * **Post-resolution** redemption: burn winning tokens for USDC (not an oracle / resolve
   * instruction). `side` and `winningOutcome` must match a resolved market.
   */
  async resolveMarket(market, side, winningOutcome, outcomeAmount, opts) {
    assertDevnetForNow(this.cluster);
    const p = {
      connection: this.connection,
      engine: this.engine,
      wallet: this.wallet,
      cluster: this.cluster,
      market,
      side,
      winningOutcome,
      outcomeAmount,
      marketSlug: opts?.marketSlug
    };
    return runResolveMarketRedemption(p);
  }
};

exports.PredictedClient = PredictedClient;
exports.runBuyOutcome = runBuyOutcome;
exports.runCreateOmnipairMarket = runCreateOmnipairMarket;
exports.runDepositLiquidity = runDepositLiquidity;
exports.runResolveMarketRedemption = runResolveMarketRedemption;
exports.runSellOutcome = runSellOutcome;
exports.runWithdrawLiquidityToUsdc = runWithdrawLiquidityToUsdc;
exports.solanaTransactionExplorerUrl = solanaTransactionExplorerUrl;
exports.toPublicKey = toPublicKey;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map