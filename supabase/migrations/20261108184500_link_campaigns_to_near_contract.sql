ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS contract_id text,
  ADD COLUMN IF NOT EXISTS contract_campaign_id text;

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_contract_campaign_unique
  ON public.campaigns (contract_id, contract_campaign_id)
  WHERE contract_id IS NOT NULL AND contract_campaign_id IS NOT NULL;
