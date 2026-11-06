import { setupWalletSelector, type WalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupSender } from '@near-wallet-selector/sender';
import '@near-wallet-selector/modal-ui/styles.css';

let selectorPromise: Promise<WalletSelector> | undefined;

export async function getNearSelector(): Promise<WalletSelector> {
  selectorPromise ??= setupWalletSelector({
    network: 'testnet',
    modules: [setupMyNearWallet(), setupMeteorWallet(), setupSender()],
  });
  return selectorPromise;
}

export async function showNearWalletModal(): Promise<void> {
  const selector = await getNearSelector();
  setupModal(selector, { contractId: 'nearfund.testnet' }).show();
}

export async function getSignedAccountId(): Promise<string | null> {
  const selector = await getNearSelector();
  return selector.store.getState().accounts.find((account) => account.active)?.accountId ?? null;
}

export async function signNearTransfer(receiverId: string, amount: string): Promise<void> {
  const selector = await getNearSelector();
  const accountId = await getSignedAccountId();
  if (!accountId) throw new Error('Connect a NEAR wallet first.');
  const wallet = await selector.wallet();
  await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId,
    actions: [{ type: 'Transfer', params: { deposit: amount } }],
  });
}
