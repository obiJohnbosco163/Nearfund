import { deserialize } from 'npm:borsh@2.0.0';
import {
  Account,
  KeyType,
  JsonRpcProvider,
  KeyPair,
  KeyPairSigner,
  PublicKey,
  SCHEMA,
  encodeDelegateAction,
  type KeyPairString,
  encodeSignedDelegate,
} from 'npm:near-api-js@7.4.0';

const YOCTO_PER_NEAR = 10n ** 24n;
const MAX_STORAGE_DEPOSIT = YOCTO_PER_NEAR / 20n;
const STORAGE_CREDIT_TARGET = 10_000_000_000_000_000_000_000n;
const DONATION_GAS = 100_000_000_000_000n;
const STORAGE_GAS = 30_000_000_000_000n;
const MAX_DELEGATE_TTL_BLOCKS = 200n;
const MAX_REQUEST_BYTES = 12_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_RELAYS_PER_SIGNER_PER_WINDOW = 1;
const MAX_RELAYS_PER_INSTANCE_PER_WINDOW = 50;

type JsonRecord = Record<string, unknown>;
type Delegate = Parameters<Account['relayMetaTransaction']>[0];

const recentRelays = new Map<string, number[]>();

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonResponse(status: number, body: JsonRecord, origin?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function getAllowedOrigins(): Set<string> {
  return new Set(
    (Deno.env.get('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function parseRelayerPrivateKey(value: string): KeyPairString {
  if (!/^(ed25519|secp256k1):.+$/.test(value)) {
    throw new Error('NEAR_RELAYER_PRIVATE_KEY must be a NEAR keypair string.');
  }
  return value as KeyPairString;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('The wallet returned an invalid signed delegate.');
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function getFunctionCall(action: unknown): JsonRecord {
  if (!isRecord(action) || Object.keys(action).length !== 1 || !isRecord(action.functionCall)) {
    throw new Error('Only campaign donation function calls can be sponsored.');
  }
  return action.functionCall;
}

function parseFunctionArgs(args: unknown): JsonRecord {
  if (
    !Array.isArray(args)
    || args.length > 1_024
    || !args.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
  ) {
    throw new Error('The signed call has invalid arguments.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(args)));
  } catch {
    throw new Error('The signed call arguments are not valid JSON.');
  }
  if (!isRecord(parsed)) throw new Error('The signed call arguments must be a JSON object.');
  return parsed;
}

function requireEmptyArgs(args: JsonRecord): void {
  if (Object.keys(args).length !== 0) throw new Error('The storage call must not include arguments.');
}

function requireDonationArgs(args: JsonRecord): void {
  if (
    Object.keys(args).length !== 1
    || typeof args.campaign_id !== 'string'
    || !/^\d+$/.test(args.campaign_id)
    || BigInt(args.campaign_id) > (1n << 64n) - 1n
  ) {
    throw new Error('The signed donation must identify one valid campaign.');
  }
}

function encodeJsonBase64(value: JsonRecord): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function callContractView(contractId: string, methodName: string, args: JsonRecord): Promise<unknown> {
  const response = await fetch('https://rpc.testnet.near.org', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'nearfund-relayer',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: methodName,
        args_base64: encodeJsonBase64(args),
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC returned HTTP ${response.status}.`);

  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error('NEAR RPC returned an invalid view response.');
  if (isRecord(payload.error)) {
    throw new Error(
      typeof payload.error.data === 'string'
        ? payload.error.data
        : typeof payload.error.message === 'string'
          ? payload.error.message
          : `NEAR view call ${methodName} failed.`,
    );
  }
  if (!isRecord(payload.result) || !Array.isArray(payload.result.result)) {
    throw new Error(`NEAR RPC returned no result for ${methodName}.`);
  }

  const resultBytes = payload.result.result;
  if (!resultBytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error('NEAR RPC returned invalid view result bytes.');
  }
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(resultBytes))) as unknown;
}

function getKeyMaterial(
  value: unknown,
  variants: Array<[string, KeyType]>,
): { keyType: KeyType; data: Uint8Array } {
  if (!isRecord(value)) throw new Error('The signed delegate has invalid key material.');
  const found = variants.filter(([variant]) => variant in value);
  if (found.length !== 1) throw new Error('The signed delegate has an unsupported key type.');

  const payload = value[found[0][0]];
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('The signed delegate has invalid key bytes.');
  }
  const bytes = payload.data;
  if (
    bytes.length === 0
    || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    throw new Error('The signed delegate has invalid key bytes.');
  }
  return { keyType: found[0][1], data: Uint8Array.from(bytes) };
}

async function verifyDelegateSignature(signedDelegate: Delegate): Promise<PublicKey> {
  const keyTypes: Array<[string, KeyType]> = [
    ['ed25519Key', KeyType.ED25519],
    ['secp256k1Key', KeyType.SECP256K1],
  ];
  const signatureTypes: Array<[string, KeyType]> = [
    ['ed25519Signature', KeyType.ED25519],
    ['secp256k1Signature', KeyType.SECP256K1],
  ];
  const publicKeyBytes = getKeyMaterial(signedDelegate.delegateAction.publicKey, keyTypes);
  const signatureBytes = getKeyMaterial(signedDelegate.signature, signatureTypes);
  if (publicKeyBytes.keyType !== signatureBytes.keyType) {
    throw new Error('The signed delegate public key and signature types do not match.');
  }

  const message = encodeDelegateAction(signedDelegate.delegateAction);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', message));
  const publicKey = new PublicKey(publicKeyBytes);
  if (!publicKey.verify(hash, signatureBytes.data)) {
    throw new Error('The signed delegate signature is invalid.');
  }
  return publicKey;
}

function enforceRateLimit(signerId: string): boolean {
  const now = Date.now();
  for (const [key, timestamps] of recentRelays) {
    const active = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (active.length) recentRelays.set(key, active);
    else recentRelays.delete(key);
  }

  const signerRequests = recentRelays.get(signerId) ?? [];
  const instanceRequests = [...recentRelays.values()].flat();
  if (
    signerRequests.length >= MAX_RELAYS_PER_SIGNER_PER_WINDOW
    || instanceRequests.length >= MAX_RELAYS_PER_INSTANCE_PER_WINDOW
  ) {
    return false;
  }
  recentRelays.set(signerId, [...signerRequests, now]);
  return true;
}

function validateDonationDelegate(
  value: unknown,
  contractId: string,
  currentHeight: bigint,
): asserts value is Delegate {
  if (!isRecord(value) || !isRecord(value.delegateAction)) {
    throw new Error('The wallet returned an invalid signed delegate.');
  }
  const delegateAction = value.delegateAction;
  if (
    typeof delegateAction.senderId !== 'string'
    || delegateAction.senderId.length === 0
    || delegateAction.senderId.length > 64
    || delegateAction.receiverId !== contractId
    || typeof delegateAction.nonce !== 'bigint'
    || delegateAction.nonce <= 0n
    || delegateAction.nonce > currentHeight * 1_000_000n
    || typeof delegateAction.maxBlockHeight !== 'bigint'
    || delegateAction.maxBlockHeight <= currentHeight
    || delegateAction.maxBlockHeight > currentHeight + MAX_DELEGATE_TTL_BLOCKS
    || !Array.isArray(delegateAction.actions)
    || delegateAction.actions.length < 1
    || delegateAction.actions.length > 2
    || !isRecord(value.signature)
  ) {
    throw new Error('The signed delegate is expired, malformed, or targets a different contract.');
  }

  const actions = delegateAction.actions;
  const donationIndex = actions.length - 1;
  for (const [index, rawAction] of actions.entries()) {
    const call = getFunctionCall(rawAction);
    if (typeof call.methodName !== 'string' || typeof call.gas !== 'bigint' || typeof call.deposit !== 'bigint') {
      throw new Error('The signed delegate contains an invalid function call.');
    }

    if (index === donationIndex) {
      if (call.methodName !== 'donate' || call.gas !== DONATION_GAS || call.deposit <= 0n) {
        throw new Error('The signed delegate must contain one payable campaign donation.');
      }
      requireDonationArgs(parseFunctionArgs(call.args));
      continue;
    }

    if (
      index !== 0
      || actions.length !== 2
      || call.methodName !== 'storage_deposit'
      || call.gas !== STORAGE_GAS
      || call.deposit <= 0n
      || call.deposit > MAX_STORAGE_DEPOSIT
    ) {
      throw new Error('The optional storage deposit is outside the sponsorship policy.');
    }
    requireEmptyArgs(parseFunctionArgs(call.args));
  }

}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') ?? undefined;
  const allowedOrigins = getAllowedOrigins();
  if (!origin || !allowedOrigins.has(origin)) {
    return jsonResponse(403, { error: 'This origin is not allowed to use the Nearfund gas sponsor.' });
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
    });
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, origin);
  }

  const contractId = Deno.env.get('NEAR_TESTNET_CONTRACT_ID');
  const relayerAccountId = Deno.env.get('NEAR_RELAYER_ACCOUNT_ID');
  const relayerPrivateKey = Deno.env.get('NEAR_RELAYER_PRIVATE_KEY');
  if (!contractId || !relayerAccountId || !relayerPrivateKey) {
    console.error('Nearfund relayer secrets are not configured.');
    return jsonResponse(503, { error: 'Sponsored donations are not configured yet.' }, origin);
  }

  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_REQUEST_BYTES) {
      return jsonResponse(413, { error: 'The signed donation request is too large.' }, origin);
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonResponse(400, { error: 'Request body must be valid JSON.' }, origin);
    }
    if (!isRecord(body) || typeof body.signedDelegate !== 'string') {
      return jsonResponse(400, { error: 'Provide a signedDelegate from a connected NEAR testnet wallet.' }, origin);
    }

    let decoded: unknown;
    try {
      const bytes = decodeBase64(body.signedDelegate);
      if (bytes.length > MAX_REQUEST_BYTES) {
        return jsonResponse(413, { error: 'The signed donation request is too large.' }, origin);
      }
      decoded = deserialize(SCHEMA.SignedDelegate, bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The signed delegate could not be decoded.';
      return jsonResponse(400, { error: message }, origin);
    }

    const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
    const block = await provider.viewBlock({ finality: 'final' });
    let signedDelegate: Delegate;
    let publicKey: PublicKey;
    try {
      validateDonationDelegate(decoded, contractId, BigInt(block.header.height));
      encodeSignedDelegate(decoded);
      signedDelegate = decoded;
      publicKey = await verifyDelegateSignature(signedDelegate);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The signed delegate is invalid.';
      return jsonResponse(400, { error: message }, origin);
    }

    const signerId = signedDelegate.delegateAction.senderId;
    const accessKey = await provider.viewAccessKey({ accountId: signerId, publicKey });
    if (accessKey.permission !== 'FullAccess') {
      return jsonResponse(400, { error: 'Sponsored donations require a full-access wallet key.' }, origin);
    }
    if (signedDelegate.delegateAction.nonce <= accessKey.nonce) {
      return jsonResponse(400, { error: 'The signed delegate nonce is stale or already used.' }, origin);
    }

    const donationCall = getFunctionCall(
      signedDelegate.delegateAction.actions[signedDelegate.delegateAction.actions.length - 1],
    );
    const donationArgs = parseFunctionArgs(donationCall.args);
    const campaignId = donationArgs.campaign_id;
    if (typeof campaignId !== 'string') {
      return jsonResponse(400, { error: 'The signed donation does not identify a campaign.' }, origin);
    }
    const [campaign, storageCredit] = await Promise.all([
      callContractView(contractId, 'get_campaign', { campaign_id: campaignId }),
      callContractView(contractId, 'get_storage_credit', { account: signerId }),
    ]);
    if (!isRecord(campaign) || campaign.token !== null || campaign.status !== 'active') {
      return jsonResponse(400, { error: 'This campaign is missing, inactive, or does not accept native NEAR.' }, origin);
    }
    if (typeof storageCredit !== 'string' || !/^\d+$/.test(storageCredit)) {
      throw new Error('The campaign contract returned invalid donor storage credit.');
    }
    const hasStorageDeposit = signedDelegate.delegateAction.actions.length === 2;
    if (!hasStorageDeposit && BigInt(storageCredit) < STORAGE_CREDIT_TARGET) {
      return jsonResponse(400, { error: 'This donor needs to add contract storage before donating.' }, origin);
    }

    if (!enforceRateLimit(signerId)) {
      return jsonResponse(429, { error: 'Please wait before requesting another sponsored transaction.' }, origin);
    }

    const signer = new KeyPairSigner(KeyPair.fromString(parseRelayerPrivateKey(relayerPrivateKey)));
    const relayer = new Account(relayerAccountId, provider, signer);
    const outcome = await relayer.relayMetaTransaction(decoded);
    const transactionHash = outcome.transaction?.hash;
    if (typeof transactionHash !== 'string' || transactionHash.length === 0) {
      throw new Error('NEAR accepted the relay without returning a transaction hash.');
    }
    return jsonResponse(200, { transactionHash }, origin);
  } catch (error) {
    console.error('Unable to relay Nearfund donation.', error);
    const message = error instanceof Error ? error.message : 'The signed donation could not be relayed.';
    return jsonResponse(502, { error: message }, origin);
  }
});
