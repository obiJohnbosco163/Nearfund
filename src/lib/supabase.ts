import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const supabaseConfigurationMessage =
  'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local to enable live data.';

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
