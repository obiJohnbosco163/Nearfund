import type { Action } from '@near-wallet-selector/core';
import campaignAbi from './nearfund_campaign_abi.json';
import { getCampaignContractId } from './nearConfig';

const RPC_URL = 'https://test.rpc.fastnear.com';
const STORAGE_CREDIT_TARGET = 10_000_000_000_000_000_000_000n;
const INITIAL_STORAGE_DEPOSIT = 50_000_000_000_000_000_000_000n;
const STORAGE_DEPOSIT_GAS = '30000000000000';
const CAMPAIGN_CALL_GAS = '100000000000000';
const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;

export type OnChainCampaign = {
  id: string;
  creator: string;
  beneficiary: string;
  token: string | null;
  category: string;
  goal: string;
  deadline: string;
  total: string;
  status: string;
  payout_state: string;
};

export type OnChainContribution = {
  amount: string;
  refund_state: string;
};

type RpcResponse = {
  result?: { result: number[] };
  error?: { data?: string; message?: string };
};

function assertAbiMethod(
  methodName: string,
  kind: 'call' | 'view',
  args: Record<string, unknown>,
): void {
  const method = campaignAbi.body.functions.find((entry) => entry.name === methodName);
  if (!method || method.kind !== kind) {
    throw new Error(`Campaign ABI does not define ${kind} method "${methodName}".`);
  }

  const schemaArgs = 'params' in method ? method.params?.args ?? [] : [];
  const expected = schemaArgs.map((arg) => arg.name).sort();
  const provided = Object.keys(args).sort();
  if (expected.length !== provided.length || expected.some((name, index) => name !== provided[index])) {
    throw new Error(`Arguments for ${methodName} do not match the campaign contract ABI.`);
  }
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function view<T>(methodName: string, args: Record<string, unknown>): Promise<T> {
  assertAbiMethod(methodName, 'view', args);
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'nearfund-frontend',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: getCampaignContractId(),
        method_name: methodName,
        args_base64: toBase64(JSON.stringify(args)),
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC returned HTTP ${response.status}.`);

  const payload = (await response.json()) as RpcResponse;
  if (payload.error) {
    throw new Error(payload.error.data ?? payload.error.message ?? `NEAR view call ${methodName} failed.`);
  }
  if (!payload.result) throw new Error(`NEAR RPC returned no result for ${methodName}.`);

  const result = new TextDecoder().decode(new Uint8Array(payload.result.result));
  return JSON.parse(result) as T;
}

function functionCall(methodName: string, args: Record<string, unknown>, gas: string, deposit: string): Action {
  assertAbiMethod(methodName, 'call', args);
  return { type: 'FunctionCall', params: { methodName, args, gas, deposit } };
}

function getTransactionStatuses(outcome: unknown): unknown[] {
  if (typeof outcome !== 'object' || outcome === null) return [];
  const record = outcome as Record<string, unknown>;
  const statuses = [record.status, record.final_execution_status];
  const transactionOutcome = record.transaction_outcome;
  if (typeof transactionOutcome === 'object' && transactionOutcome !== null && 'outcome' in transactionOutcome) {
    const execution = transactionOutcome.outcome;
    if (typeof execution === 'object' && execution !== null && 'status' in execution) statuses.push(execution.status);
  }
  if (Array.isArray(record.receipts_outcome)) {
    for (const receipt of record.receipts_outcome) {
      if (typeof receipt === 'object' && receipt !== null && 'outcome' in receipt) {
        const execution = receipt.outcome;
        if (typeof execution === 'object' && execution !== null && 'status' in execution) statuses.push(execution.status);
      }
    }
  }
  return statuses;
}

function getTransactionFailure(outcome: unknown): string | null {
  for (const status of getTransactionStatuses(outcome)) {
    if (typeof status !== 'object' || status === null || !('Failure' in status)) continue;
    const failure = status.Failure;
    if (typeof failure === 'object' && failure !== null && 'error_message' in failure && typeof failure.error_message === 'string') {
      return failure.error_message;
    }
    return typeof failure === 'string' ? failure : JSON.stringify(failure);
  }
  return null;
}

function getTransactionResult(outcome: unknown): unknown {
  for (const status of getTransactionStatuses(outcome)) {
    if (typeof status !== 'object' || status === null || !('SuccessValue' in status) || typeof status.SuccessValue !== 'string') {
      continue;
    }
    if (!status.SuccessValue) return null;

    const bytes = Uint8Array.from(atob(status.SuccessValue), (character) => character.charCodeAt(0));
    const serialized = new TextDecoder().decode(bytes);
    try {
      return JSON.parse(serialized) as unknown;
    } catch {
      return serialized;
    }
  }
  return null;
}

function getCampaignIdFromEventLogs(outcome: unknown): string | null {
  if (typeof outcome !== 'object' || outcome === null) return null;
  const record = outcome as Record<string, unknown>;
  const executionOutcomes = [record.transaction_outcome, ...(Array.isArray(record.receipts_outcome) ? record.receipts_outcome : [])];
  for (const executionOutcome of executionOutcomes) {
    if (typeof executionOutcome !== 'object' || executionOutcome === null || !('outcome' in executionOutcome)) continue;
    const execution = executionOutcome.outcome;
    if (typeof execution !== 'object' || execution === null || !('logs' in execution) || !Array.isArray(execution.logs)) continue;
    for (const log of execution.logs) {
      if (typeof log !== 'string' || !log.startsWith('EVENT_JSON:')) continue;
      try {
        const event = JSON.parse(log.slice('EVENT_JSON:'.length)) as {
          event?: unknown;
          data?: Array<{ campaign_id?: unknown }>;
        };
        const campaignId = event.data?.[0]?.campaign_id;
        if (event.event === 'campaign_created' && typeof campaignId === 'string' && /^\d+$/.test(campaignId)) {
          return campaignId;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

function getTransactionHash(outcome: unknown): string | null {
  if (typeof outcome !== 'object' || outcome === null || !('transaction' in outcome)) return null;
  const transaction = outcome.transaction;
  if (typeof transaction !== 'object' || transaction === null || !('hash' in transaction)) return null;
  return typeof transaction.hash === 'string' ? transaction.hash : null;
}

async function getAccountAndStorageActions(
  methodName: string,
  args: Record<string, unknown>,
  deposit: string,
  accountId: string,
): Promise<Action[]> {
  const credit = await view<string>('get_storage_credit', { account: accountId });
  if (!/^\d+$/.test(credit)) throw new Error('The campaign contract returned invalid storage credit.');

  const actions: Action[] = [];
  if (BigInt(credit) < STORAGE_CREDIT_TARGET) {
    actions.push(functionCall(
      'storage_deposit',
      {},
      STORAGE_DEPOSIT_GAS,
      INITIAL_STORAGE_DEPOSIT.toString(),
    ));
  }
  actions.push(functionCall(methodName, args, CAMPAIGN_CALL_GAS, deposit));
  return actions;
}

export function nearToYocto(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a valid NEAR amount with up to 24 decimal places.');

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(24, '0') || '0');
  const yocto = whole * YOCTO_PER_NEAR + fraction;
  if (yocto <= 0n) throw new Error('The amount must be greater than zero.');
  return yocto.toString();
}

export async function listOnChainCampaigns(): Promise<OnChainCampaign[]> {
  const count = await getCampaignCount();
  const campaigns: OnChainCampaign[] = [];

  for (let start = 0n; start < count; start += 20n) {
    const end = start + 20n < count ? start + 20n : count;
    const batch = await Promise.all(
      Array.from({ length: Number(end - start) }, (_, index) =>
        view<OnChainCampaign | null>('get_campaign', { campaign_id: (start + BigInt(index)).toString() }),
      ),
    );
    campaigns.push(...batch.filter((campaign): campaign is OnChainCampaign => campaign !== null));
  }

  return campaigns.reverse();
}

async function getCampaignCount(): Promise<bigint> {
  const rawCount = await view<string>('get_campaign_count', {});
  if (!/^\d+$/.test(rawCount)) throw new Error('The campaign contract returned an invalid campaign count.');
  return BigInt(rawCount);
}

async function findNewCampaignId(
  firstNewId: bigint,
  input: { creator: string; beneficiary: string; category: string; goal: string; deadline: string },
): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const count = await getCampaignCount();
    const scanStart = count - firstNewId > 50n ? count - 50n : firstNewId;
    if (count > firstNewId) {
      const campaignIds = Array.from(
        { length: Number(count - scanStart) },
        (_, index) => scanStart + BigInt(index),
      );
      const campaigns = await Promise.all(
        campaignIds.map((id) => view<OnChainCampaign | null>('get_campaign', { campaign_id: id.toString() })),
      );
      const created = campaigns.find((campaign) =>
        campaign !== null
        && campaign.creator === input.creator
        && campaign.beneficiary === input.beneficiary
        && campaign.category === input.category
        && campaign.goal === input.goal
        && campaign.deadline === input.deadline
        && campaign.token === null,
      );
      if (created) return created.id;
    }

    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

export async function createCampaignOnChain(input: {
  goal: string;
  deadline: string;
  category: string;
  beneficiary: string;
}): Promise<string> {
  const { getSignedAccountId, signAndSendNearTransaction } = await import('./nearWallet');
  const accountId = await getSignedAccountId();
  if (!accountId) throw new Error('Connect a NEAR testnet wallet before creating a campaign.');

  const firstNewId = await getCampaignCount();
  const args = {
    goal: nearToYocto(input.goal),
    deadline: input.deadline,
    category: input.category,
    beneficiary: input.beneficiary.trim(),
    token: null,
  };
  const outcome = await signAndSendNearTransaction(
    getCampaignContractId(),
    await getAccountAndStorageActions(
      'create_campaign',
      args,
      '0',
      accountId,
    ),
  );
  const transactionFailure = getTransactionFailure(outcome);
  if (transactionFailure) {
    throw new Error(`The NEAR transaction failed: ${transactionFailure}`);
  }

  const result = getTransactionResult(outcome);
  if (typeof result === 'string' && /^\d+$/.test(result)) return result;
  if (typeof result === 'number' && Number.isSafeInteger(result) && result >= 0) return String(result);

  const eventCampaignId = getCampaignIdFromEventLogs(outcome);
  if (eventCampaignId) return eventCampaignId;

  const recoveredId = await findNewCampaignId(firstNewId, {
    creator: accountId,
    beneficiary: args.beneficiary,
    category: args.category,
    goal: args.goal,
    deadline: args.deadline,
  });
  if (recoveredId) return recoveredId;

  const transactionHash = getTransactionHash(outcome);
  const transactionReference = transactionHash ? ` Transaction hash: ${transactionHash}.` : '';
  throw new Error(`The wallet returned without a campaign ID, and the contract does not yet show a matching new campaign. Check your wallet transaction before retrying.${transactionReference}`);
}

export async function donateToCampaignOnChain(
  campaignId: string,
  amount: string,
  sponsorGas = false,
): Promise<string> {
  const { getSignedAccountId, signAndSendNearTransaction, signNearDelegateActions } = await import('./nearWallet');
  const accountId = await getSignedAccountId();
  if (!accountId) throw new Error('Connect a NEAR testnet wallet before donating.');

  const actions = await getAccountAndStorageActions(
    'donate',
    { campaign_id: campaignId },
    nearToYocto(amount),
    accountId,
  );
  if (sponsorGas) {
    const { relaySignedNearDonation } = await import('./nearRelayer');
    const signedDelegate = await signNearDelegateActions(getCampaignContractId(), actions);
    return relaySignedNearDonation(signedDelegate);
  }

  const outcome = await signAndSendNearTransaction(getCampaignContractId(), actions);
  if (!outcome) {
    throw new Error('The wallet did not return transaction confirmation. Check your wallet activity before retrying.');
  }
  return outcome.transaction.hash;
}

export async function getOnChainCampaign(campaignId: string): Promise<OnChainCampaign | null> {
  return view<OnChainCampaign | null>('get_campaign', { campaign_id: campaignId });
}

export async function getOnChainContribution(
  campaignId: string,
  donor: string,
): Promise<OnChainContribution | null> {
  return view<OnChainContribution | null>('get_contribution', { campaign_id: campaignId, donor });
}

async function submitClaim(
  methodName: 'claim_payout' | 'claim_refund',
  args: Record<string, unknown>,
): Promise<string> {
  const { getSignedAccountId, signAndSendNearTransaction } = await import('./nearWallet');
  const accountId = await getSignedAccountId();
  if (!accountId) throw new Error('Connect a NEAR testnet wallet before claiming.');

  const outcome = await signAndSendNearTransaction(getCampaignContractId(), [
    functionCall(methodName, args, CAMPAIGN_CALL_GAS, '0'),
  ]);
  if (!outcome) {
    throw new Error('The wallet did not return transaction confirmation. Check your wallet activity before retrying.');
  }
  return outcome.transaction.hash;
}

export async function claimPayoutOnChain(campaignId: string): Promise<string> {
  return submitClaim('claim_payout', { campaign_id: campaignId });
}

export async function claimRefundOnChain(campaignId: string, donor: string): Promise<string> {
  return submitClaim('claim_refund', { campaign_id: campaignId, donor });
}
