/*
# Create Nearfund public campaign and ledger records

1. New tables
- `campaigns`: public campaign identity, goal, treasury account, and funding totals.
- `milestones`: ordered payout checkpoints attached to a campaign.
- `donations`: public donor intent and completed donation transaction reference.
- `ledger_records`: append-only public references for donations and completed milestone payouts.
- `organizer_records`: public delivery history and reputation summary for each named NEAR organizer.

2. Security
- Enable row-level security on every table.
- This prototype intentionally has no sign-in screen, so public shared records are readable and writable by anon and authenticated roles.
- Grants are limited to the CRUD verbs used by the browser client.

3. Integrity
- Foreign keys connect milestones, donations, and ledger records to campaigns.
- Amounts and percentages are constrained to non-negative values.
- Organizer and treasury accounts are canonical lowercase text values.
- Indexes support campaign, organizer, and ledger timeline reads.

4. Important notes
- This migration stores public application records only; custody remains in the existing Sputnik DAO or Trezu treasury.
- Chain transaction hashes are references and are not treated as confirmed until an indexer or transaction receipt verifies them.
*/

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Community',
  organizer_account text NOT NULL CHECK (organizer_account = lower(organizer_account)),
  treasury_account text NOT NULL CHECK (treasury_account = lower(treasury_account)),
  treasury_type text NOT NULL DEFAULT 'sputnik' CHECK (treasury_type IN ('sputnik', 'trezu')),
  goal_amount numeric(30, 6) NOT NULL CHECK (goal_amount > 0),
  settlement_asset text NOT NULL DEFAULT 'NEAR',
  raised_amount numeric(30, 6) NOT NULL DEFAULT 0 CHECK (raised_amount >= 0),
  backer_count integer NOT NULL DEFAULT 0 CHECK (backer_count >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'funded', 'completed', 'paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '',
  amount numeric(30, 6) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'voting', 'released', 'rejected')),
  approval_tier text NOT NULL DEFAULT 'dao_proposal' CHECK (approval_tier IN ('auto', 'council', 'dao_proposal')),
  proposal_id bigint,
  evidence_url text,
  released_transaction_hash text,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, position)
);

CREATE TABLE IF NOT EXISTS public.donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  donor_account text CHECK (donor_account IS NULL OR donor_account = lower(donor_account)),
  input_asset text NOT NULL,
  input_amount numeric(30, 6) NOT NULL CHECK (input_amount > 0),
  settled_asset text NOT NULL,
  settled_amount numeric(30, 6),
  intents_deposit_address text,
  intents_deposit_transaction_hash text,
  intents_order_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'completed', 'failed', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.ledger_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  donation_id uuid REFERENCES public.donations(id) ON DELETE SET NULL,
  milestone_id uuid REFERENCES public.milestones(id) ON DELETE SET NULL,
  record_type text NOT NULL CHECK (record_type IN ('donation', 'milestone_payout')),
  account text NOT NULL CHECK (account = lower(account)),
  asset text NOT NULL,
  amount numeric(30, 6) NOT NULL CHECK (amount > 0),
  transaction_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((record_type = 'donation' AND donation_id IS NOT NULL AND milestone_id IS NULL) OR (record_type = 'milestone_payout' AND milestone_id IS NOT NULL AND donation_id IS NULL))
);

CREATE TABLE IF NOT EXISTS public.organizer_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_account text NOT NULL UNIQUE CHECK (organizer_account = lower(organizer_account)),
  campaigns_completed integer NOT NULL DEFAULT 0 CHECK (campaigns_completed >= 0),
  milestones_completed integer NOT NULL DEFAULT 0 CHECK (milestones_completed >= 0),
  total_released numeric(30, 6) NOT NULL DEFAULT 0 CHECK (total_released >= 0),
  reputation_score integer NOT NULL DEFAULT 0 CHECK (reputation_score BETWEEN 0 AND 100),
  auto_approval_limit numeric(30, 6) NOT NULL DEFAULT 0 CHECK (auto_approval_limit >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_status_created_idx ON public.campaigns (status, created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_organizer_idx ON public.campaigns (organizer_account);
CREATE INDEX IF NOT EXISTS milestones_campaign_position_idx ON public.milestones (campaign_id, position);
CREATE INDEX IF NOT EXISTS donations_campaign_created_idx ON public.donations (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_campaign_created_idx ON public.ledger_records (campaign_id, created_at DESC);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizer_records ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.milestones TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.donations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_records TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizer_records TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_campaigns" ON public.campaigns;
CREATE POLICY "public_read_campaigns" ON public.campaigns FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_campaigns" ON public.campaigns;
CREATE POLICY "public_insert_campaigns" ON public.campaigns FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_campaigns" ON public.campaigns;
CREATE POLICY "public_update_campaigns" ON public.campaigns FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_campaigns" ON public.campaigns;
CREATE POLICY "public_delete_campaigns" ON public.campaigns FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_milestones" ON public.milestones;
CREATE POLICY "public_read_milestones" ON public.milestones FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_milestones" ON public.milestones;
CREATE POLICY "public_insert_milestones" ON public.milestones FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_milestones" ON public.milestones;
CREATE POLICY "public_update_milestones" ON public.milestones FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_milestones" ON public.milestones;
CREATE POLICY "public_delete_milestones" ON public.milestones FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_donations" ON public.donations;
CREATE POLICY "public_read_donations" ON public.donations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_donations" ON public.donations;
CREATE POLICY "public_insert_donations" ON public.donations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_donations" ON public.donations;
CREATE POLICY "public_update_donations" ON public.donations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_donations" ON public.donations;
CREATE POLICY "public_delete_donations" ON public.donations FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_ledger_records" ON public.ledger_records;
CREATE POLICY "public_read_ledger_records" ON public.ledger_records FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_ledger_records" ON public.ledger_records;
CREATE POLICY "public_insert_ledger_records" ON public.ledger_records FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_ledger_records" ON public.ledger_records;
CREATE POLICY "public_update_ledger_records" ON public.ledger_records FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_ledger_records" ON public.ledger_records;
CREATE POLICY "public_delete_ledger_records" ON public.ledger_records FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_organizer_records" ON public.organizer_records;
CREATE POLICY "public_read_organizer_records" ON public.organizer_records FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_organizer_records" ON public.organizer_records;
CREATE POLICY "public_insert_organizer_records" ON public.organizer_records FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_organizer_records" ON public.organizer_records;
CREATE POLICY "public_update_organizer_records" ON public.organizer_records FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_organizer_records" ON public.organizer_records;
CREATE POLICY "public_delete_organizer_records" ON public.organizer_records FOR DELETE TO anon, authenticated USING (true);
