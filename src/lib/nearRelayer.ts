import { supabase } from './supabase';

type RelayResponse = {
  transactionHash?: string;
  error?: string;
};

export async function relaySignedNearDonation(signedDelegate: string): Promise<string> {
  if (!supabase) {
    throw new Error('Configure Supabase before requesting sponsored transaction gas.');
  }

  const { data, error } = await supabase.functions.invoke<RelayResponse>('near-relay', {
    body: { signedDelegate },
  });
  if (error) throw new Error(`The gas sponsor could not relay this donation: ${error.message}`);
  if (!data || typeof data.transactionHash !== 'string' || !data.transactionHash) {
    throw new Error(data?.error ?? 'The gas sponsor returned no transaction hash.');
  }
  return data.transactionHash;
}
