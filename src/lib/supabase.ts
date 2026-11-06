import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey);

export type CampaignRow = {
  id: string;
  title: string;
  description: string;
  category: string;
  organizer_account: string;
  treasury_account: string;
  treasury_type: 'sputnik' | 'trezu';
  goal_amount: number;
  settlement_asset: string;
  raised_amount: number;
  backer_count: number;
  status: string;
};
