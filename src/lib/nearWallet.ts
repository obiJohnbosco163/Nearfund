import { setupWalletSelector, type WalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import { setupSender } from '@near-wallet-selector/sender';
import { setupWelldoneWallet } from '@near-wallet-selector/welldone-wallet';
import { NearConnector, type EventMap, type NearWalletBase } from '@hot-labs/near-connect';
import '@near-wallet-selector/modal-ui/styles.css';
import { getCampaignContractId } from './nearConfig';

let selectorPromise: Promise<WalletSelector> | undefined;
let connectorPromise: Promise<NearConnector> | undefined;
let selectorAccountId: string | null = null;
let connectorAccountId: string | null = null;
let activeWalletSource: 'selector' | 'connector' | null = null;
let activeConnectorWallet: NearWalletBase | null = null;
const accountListeners = new Set<(accountId: string | null) => void>();

function getActiveAccountId(): string | null {
  if (activeWalletSource === 'connector') return connectorAccountId;
  if (activeWalletSource === 'selector') return selectorAccountId;
  return connectorAccountId ?? selectorAccountId;
}

function notifyAccountListeners(): void {
  const accountId = getActiveAccountId();
  accountListeners.forEach((listener) => listener(accountId));
}

export async function getNearSelector(): Promise<WalletSelector> {
  selectorPromise ??= setupWalletSelector({
    network: 'testnet',
    modules: [
      setupMyNearWallet(),
      setupMeteorWallet(),
      setupSender(),
      setupWelldoneWallet(),
    ],
  });
  return selectorPromise;
}

export async function getNearConnector(): Promise<NearConnector> {
  connectorPromise ??= Promise.resolve(new NearConnector({
    network: 'testnet',
    features: { testnet: true },
    autoConnect: false,
    footerBranding: null,
  }));
  return connectorPromise;
}

export async function showNearWalletModal(): Promise<void> {
  const selector = await getNearSelector();
  const contractId = import.meta.env.VITE_NEAR_CONTRACT_ID?.trim() || 'nearfund.testnet';
  setupModal(selector, { contractId }).show();
}

export async function disconnectNearWallet(): Promise<void> {
  if (activeWalletSource === 'connector' && activeConnectorWallet) {
    const connector = await getNearConnector();
    await connector.disconnect(activeConnectorWallet);
    connectorAccountId = null;
    activeConnectorWallet = null;
    activeWalletSource = selectorAccountId ? 'selector' : null;
    notifyAccountListeners();
    return;
  }

  if (activeWalletSource === 'selector' || selectorAccountId) {
    const selector = await getNearSelector();
    const wallet = await selector.wallet();
    await wallet.signOut();
    selectorAccountId = null;
    activeWalletSource = connectorAccountId ? 'connector' : null;
    notifyAccountListeners();
  }
}

export async function connectNearTestnetWallet(walletId?: string): Promise<string> {
  const connector = await getNearConnector();
  const wallet = await connector.connect(walletId ? { walletId } : undefined);
  const accounts = await wallet.getAccounts({ network: 'testnet' });
  const accountId = accounts[0]?.accountId;
  if (!accountId) throw new Error('The selected wallet did not return a NEAR testnet account.');

  activeWalletSource = 'connector';
  activeConnectorWallet = wallet;
  connectorAccountId = accountId;
  notifyAccountListeners();
  return accountId;
}

export async function getSignedAccountId(): Promise<string | null> {
  if (activeWalletSource === 'connector') return connectorAccountId;
  const selector = await getNearSelector();
  selectorAccountId = selector.store.getState().accounts.find((account) => account.active)?.accountId ?? null;
  return selectorAccountId ?? connectorAccountId;
}

export async function subscribeToNearAccount(
  onChange: (accountId: string | null) => void,
): Promise<() => void> {
  const [selector, connector] = await Promise.all([getNearSelector(), getNearConnector()]);
  const listener = (accountId: string | null) => onChange(accountId);
  accountListeners.add(listener);

  const subscription = selector.store.observable.subscribe((state) => {
    selectorAccountId = state.accounts.find((account) => account.active)?.accountId ?? null;
    if (selectorAccountId) activeWalletSource = 'selector';
    else if (activeWalletSource === 'selector') activeWalletSource = connectorAccountId ? 'connector' : null;
    notifyAccountListeners();
  });

  const handleSignIn = (event: EventMap['wallet:signIn']) => {
    activeWalletSource = 'connector';
    activeConnectorWallet = event.wallet;
    connectorAccountId = event.accounts[0]?.accountId ?? null;
    notifyAccountListeners();
  };
  const handleSignOut = () => {
    connectorAccountId = null;
    activeConnectorWallet = null;
    if (activeWalletSource === 'connector') activeWalletSource = selectorAccountId ? 'selector' : null;
    notifyAccountListeners();
  };

  connector.on('wallet:signIn', handleSignIn);
  connector.on('wallet:signOut', handleSignOut);

  try {
    const connected = await connector.getConnectedWallet();
    activeWalletSource = 'connector';
    activeConnectorWallet = connected.wallet;
    connectorAccountId = connected.accounts[0]?.accountId ?? null;
    notifyAccountListeners();
  } catch (error) {
    if (!(error instanceof Error) || !['No wallet selected', 'No accounts found'].includes(error.message)) {
      subscription.unsubscribe();
      connector.off('wallet:signIn', handleSignIn);
      connector.off('wallet:signOut', handleSignOut);
      accountListeners.delete(listener);
      throw error;
    }
  }

  return () => {
    subscription.unsubscribe();
    connector.off('wallet:signIn', handleSignIn);
    connector.off('wallet:signOut', handleSignOut);
    accountListeners.delete(listener);
  };
}

export async function signAndSendNearTransaction(receiverId: string, actions: import('@near-wallet-selector/core').Action[]) {
  const signerId = await getSignedAccountId();
  if (!signerId) throw new Error('Connect a NEAR testnet wallet first.');

  if (activeWalletSource === 'connector' && activeConnectorWallet) {
    return activeConnectorWallet.signAndSendTransaction({
      network: 'testnet',
      signerId,
      receiverId,
      actions,
    });
  }

  const selector = await getNearSelector();
  const wallet = await selector.wallet();
  return wallet.signAndSendTransaction({ signerId, receiverId, actions });
}

export async function signNearDelegateActions(
  receiverId: string,
  actions: import('@near-wallet-selector/core').Action[],
): Promise<string> {
  const signerId = await getSignedAccountId();
  if (!signerId || activeWalletSource !== 'connector' || !activeConnectorWallet) {
    throw new Error('Connect using a testnet wallet that supports NEAR Connect to request gas sponsorship.');
  }
  if (!activeConnectorWallet.manifest.features.signDelegateActions) {
    throw new Error(`${activeConnectorWallet.manifest.name} does not support gasless delegated actions.`);
  }

  const { signedDelegateActions } = await activeConnectorWallet.signDelegateActions({
    network: 'testnet',
    signerId,
    delegateActions: [{ receiverId, actions }],
  });
  const signedDelegate = signedDelegateActions[0];
  if (!signedDelegate) throw new Error('The wallet did not return a signed delegate action.');
  return signedDelegate;
}

export function canSponsorNearGas(): boolean {
  return activeWalletSource === 'connector'
    && Boolean(activeConnectorWallet?.manifest.features.signDelegateActions);
}

export async function signNearTransfer(receiverId: string, amount: string): Promise<void> {
  const accountId = await getSignedAccountId();
  if (!accountId) throw new Error('Connect a NEAR wallet first.');
  await signAndSendNearTransaction(receiverId, [
    { type: 'Transfer', params: { deposit: amount } },
  ]);
}
