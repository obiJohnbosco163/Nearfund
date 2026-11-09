export function getCampaignContractId(): string {
  const contractId = import.meta.env.VITE_NEAR_CONTRACT_ID?.trim();
  if (!contractId) {
    throw new Error('Set VITE_NEAR_CONTRACT_ID in .env.local to the deployed NEAR testnet campaign contract account.');
  }
  return contractId;
}
