import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Bookmark, CalendarDays, Check, ChevronRight, CircleDollarSign, Copy, ExternalLink, Menu, ShieldCheck, Sparkles, Users, Wallet, X } from 'lucide-react';
import { claimPayoutOnChain, claimRefundOnChain, createCampaignOnChain, donateToCampaignOnChain, getOnChainCampaign, getOnChainContribution, listOnChainCampaigns, nearToYocto, type OnChainCampaign, type OnChainContribution } from './lib/campaignContract';
import { getCampaignContractId } from './lib/nearConfig';
import { supabase, supabaseConfigurationMessage, type CampaignRow } from './lib/supabase';

type Milestone = { name: string; amount: string; status: 'Released' | 'Voting' | 'Locked'; detail: string };
type Campaign = {
  id: string;
  databaseId?: string;
  title: string;
  summary: string;
  description: string;
  coverUrl: string;
  region: string;
  beneficiaryType: string;
  suggestedMinimum: string;
  verificationUrl: string;
  updates: CampaignUpdate[];
  organizer: string;
  treasury: string;
  category: string;
  raised: number;
  goal: number;
  backers: number;
  deadline: number;
  status: string;
  payoutState: string;
  color: string;
  milestones: Milestone[];
};

type CampaignDraft = {
  title: string;
  category: string;
  region: string;
  beneficiaryType: string;
  goal: string;
  suggestedMinimum: string;
  deadline: string;
  summary: string;
  story: string;
  coverUrl: string;
  beneficiary: string;
  verificationUrl: string;
};
type CampaignUpdate = {
  id: string;
  title: string;
  body: string;
  mediaUrl: string;
  createdAt: string;
};
type LedgerRow = {
  id: string;
  campaign_id: string;
  record_type: 'donation' | 'milestone_payout';
  account: string;
  asset: string;
  amount: number;
  created_at: string;
  transaction_hash?: string | null;
  donations?: { is_anonymous: boolean; message: string | null }[] | null;
  campaign?: { title: string } | { title: string }[] | null;
};
type DonationReceipt = { amount: number; transactionHash: string; metadataWarning: string };
type ProfileDonation = {
  id: string;
  campaign_id: string;
  input_asset: string;
  input_amount: number;
  settled_asset: string;
  settled_amount: number | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  campaigns?: { title: string; contract_campaign_id: string | null } | { title: string; contract_campaign_id: string | null }[] | null;
  ledger_records?: { transaction_hash: string | null }[] | null;
};

const YOCTO_PER_NEAR = 1e24;
const MAX_DEADLINE_DATE = new Date(Number(((1n << 64n) - 1n) / 1_000_000n)).toISOString().slice(0, 10);
const INTRO_LINES = [
  '> init nearfund',
  '> connect near',
  '> campaign.create()',
  '> donations.settle()',
  '> ready',
];
const CAMPAIGN_DRAFT_KEY = 'nearfund-campaign-draft-v1';
const SAVED_CAUSES_KEY = 'nearfund-saved-causes-v1';
const CAMPAIGN_CATEGORIES = ['Medical', 'Education', 'Emergency', 'Community', 'Faith', 'Creative', 'Animals', 'Other'];

function emptyCampaignDraft(): CampaignDraft {
  return {
    title: '',
    category: 'Education',
    region: '',
    beneficiaryType: 'Myself',
    goal: '',
    suggestedMinimum: '',
    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary: '',
    story: '',
    coverUrl: '',
    beneficiary: '',
    verificationUrl: '',
  };
}

function isCampaignDraft(value: unknown): value is CampaignDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  return ['title', 'category', 'region', 'beneficiaryType', 'goal', 'suggestedMinimum', 'deadline', 'summary', 'story', 'coverUrl', 'beneficiary', 'verificationUrl']
    .every((key) => typeof draft[key] === 'string');
}

function campaignDescription(draft: CampaignDraft, updates: CampaignUpdate[] = []): string {
  return JSON.stringify({ version: 1, ...draft, updates });
}

function campaignToDraft(campaign: Campaign): CampaignDraft {
  return {
    title: campaign.title,
    category: campaign.category,
    region: campaign.region,
    beneficiaryType: campaign.beneficiaryType || 'Myself',
    goal: String(campaign.goal),
    suggestedMinimum: campaign.suggestedMinimum,
    deadline: new Date(campaign.deadline).toISOString().slice(0, 10),
    summary: campaign.summary,
    story: campaign.description,
    coverUrl: campaign.coverUrl,
    beneficiary: campaign.treasury,
    verificationUrl: campaign.verificationUrl,
  };
}

function campaignFromDescription(description: string | undefined) {
  const empty = { summary: '', story: '', coverUrl: '', region: '', beneficiaryType: '', suggestedMinimum: '', verificationUrl: '', updates: [] as CampaignUpdate[] };
  if (!description) return empty;
  try {
    const parsed: unknown = JSON.parse(description);
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'version' in parsed
      && parsed.version === 1
      && 'summary' in parsed && typeof parsed.summary === 'string'
      && 'story' in parsed && typeof parsed.story === 'string'
    ) {
      return {
        summary: parsed.summary,
        story: parsed.story,
        coverUrl: 'coverUrl' in parsed && typeof parsed.coverUrl === 'string' ? parsed.coverUrl : '',
        region: 'region' in parsed && typeof parsed.region === 'string' ? parsed.region : '',
        beneficiaryType: 'beneficiaryType' in parsed && typeof parsed.beneficiaryType === 'string' ? parsed.beneficiaryType : '',
        suggestedMinimum: 'suggestedMinimum' in parsed && typeof parsed.suggestedMinimum === 'string' ? parsed.suggestedMinimum : '',
        verificationUrl: 'verificationUrl' in parsed && typeof parsed.verificationUrl === 'string' ? parsed.verificationUrl : '',
        updates: 'updates' in parsed && Array.isArray(parsed.updates)
          ? parsed.updates.filter((update): update is CampaignUpdate => (
            typeof update === 'object'
            && update !== null
            && 'id' in update && typeof update.id === 'string'
            && 'title' in update && typeof update.title === 'string'
            && 'body' in update && typeof update.body === 'string'
            && 'mediaUrl' in update && typeof update.mediaUrl === 'string'
            && 'createdAt' in update && typeof update.createdAt === 'string'
          ))
          : [],
      };
    }
  } catch {
    return { ...empty, story: description };
  }
  return { ...empty, story: description };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function WalletConnectionButtons({
  connectingWallet,
  onConnect,
  onCliConnect,
  onOtherWallets,
}: {
  connectingWallet: boolean;
  onConnect: () => void;
  onCliConnect: () => void;
  onOtherWallets: () => void;
}) {
  return <>
    <button className="wallet-button" onClick={onConnect} disabled={connectingWallet}>
      <Wallet size={16} />{connectingWallet ? 'Connecting…' : 'Intear Wallet'}
    </button>
    <button className="wallet-alt-button wallet-cli-button" onClick={onCliConnect} disabled={connectingWallet}>
      {connectingWallet ? 'Connecting…' : 'NEAR CLI'}
    </button>
    <button className="wallet-alt-button" onClick={onOtherWallets} disabled={connectingWallet}>Other wallets</button>
  </>;
}

function ledgerCampaignTitle(row: LedgerRow): string | undefined {
  return Array.isArray(row.campaign) ? row.campaign[0]?.title : row.campaign?.title;
}

function profileCampaign(row: ProfileDonation) {
  return Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
}

function profileTransactionHash(row: ProfileDonation): string | null {
  return row.ledger_records?.find((record) => record.transaction_hash)?.transaction_hash ?? null;
}

function isMissingContractAccountError(error: unknown): boolean {
  return /does not exist while viewing|unknown_account/i.test(errorMessage(error));
}

function campaignFromChain(row: OnChainCampaign, metadata?: CampaignRow): Campaign {
  const content = campaignFromDescription(metadata?.description);
  return {
    id: row.id,
    databaseId: metadata?.id,
    title: metadata?.title ?? `${row.category} campaign #${row.id}`,
    summary: content.summary,
    description: content.story,
    coverUrl: content.coverUrl,
    region: content.region,
    beneficiaryType: content.beneficiaryType,
    suggestedMinimum: content.suggestedMinimum,
    verificationUrl: content.verificationUrl,
    updates: content.updates,
    organizer: row.creator,
    treasury: row.beneficiary,
    category: row.category,
    raised: Number(BigInt(row.total)) / YOCTO_PER_NEAR,
    goal: Number(BigInt(row.goal)) / YOCTO_PER_NEAR,
    backers: metadata?.backer_count ?? 0,
    deadline: Number(BigInt(row.deadline) / 1_000_000n),
    status: row.status,
    payoutState: row.payout_state,
    color: 'mint',
    milestones: [],
  };
}

function App() {
  const [showIntro, setShowIntro] = useState(() => (
    typeof window !== 'undefined'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && !window.sessionStorage.getItem('nearfund-intro-seen')
  ));
  const [typedLines, setTypedLines] = useState<string[]>([]);
  const [introProgress, setIntroProgress] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [profileDonations, setProfileDonations] = useState<ProfileDonation[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [savedCampaignIds, setSavedCampaignIds] = useState<string[]>([]);
  const [savedCausesError, setSavedCausesError] = useState('');
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [userContribution, setUserContribution] = useState<OnChainContribution | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [showDonate, setShowDonate] = useState(false);
  const [donationReceipt, setDonationReceipt] = useState<DonationReceipt | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [canSponsorGas, setCanSponsorGas] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [submittingCampaign, setSubmittingCampaign] = useState(false);
  const [savingCampaignMetadata, setSavingCampaignMetadata] = useState(false);
  const [submittingDonation, setSubmittingDonation] = useState(false);
  const [claimingPayout, setClaimingPayout] = useState(false);
  const [claimingRefund, setClaimingRefund] = useState(false);
  const [contributionError, setContributionError] = useState('');
  const [dataError, setDataError] = useState('');
  const [ledgerError, setLedgerError] = useState('');
  const walletUnsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!accountId) {
      setSavedCampaignIds([]);
      setSavedCausesError('');
      return;
    }

    try {
      const saved = window.localStorage.getItem(`${SAVED_CAUSES_KEY}:${accountId}`);
      if (saved === null) {
        setSavedCampaignIds([]);
        setSavedCausesError('');
        return;
      }
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
        throw new Error('Saved causes data is not a list of campaign IDs.');
      }
      setSavedCampaignIds([...new Set(parsed)]);
      setSavedCausesError('');
    } catch (error) {
      setSavedCampaignIds([]);
      setSavedCausesError(`Saved causes could not be loaded: ${errorMessage(error)}`);
    }
  }, [accountId]);

  useEffect(() => {
    let mounted = true;
    if (!accountId || !/^\/profile\/?$/.test(window.location.pathname)) {
      setProfileDonations([]);
      setProfileLoading(false);
      setProfileError('');
      return () => { mounted = false; };
    }
    if (!supabase) {
      setProfileDonations([]);
      setProfileLoading(false);
      setProfileError(`${supabaseConfigurationMessage} Donation receipts are not available.`);
      return () => { mounted = false; };
    }

    setProfileLoading(true);
    setProfileDonations([]);
    setProfileError('');
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('donations')
          .select('id,campaign_id,input_asset,input_amount,settled_asset,settled_amount,status,created_at,completed_at,campaigns(title,contract_campaign_id),ledger_records(transaction_hash)')
          .eq('donor_account', accountId)
          .order('created_at', { ascending: false });
        if (error) throw new Error(`Donation history could not be loaded: ${error.message}`);
        if (mounted) setProfileDonations((data ?? []) as ProfileDonation[]);
      } catch (error) {
        if (mounted) setProfileError(errorMessage(error));
      } finally {
        if (mounted) setProfileLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [accountId]);

  const finishIntro = () => {
    window.sessionStorage.setItem('nearfund-intro-seen', 'true');
    setShowIntro(false);
  };

  useEffect(() => {
    if (!showIntro) return;

    let lineIndex = 0;
    let characterIndex = 0;
    let timeout = 0;
    const totalCharacters = INTRO_LINES.reduce((total, line) => total + line.length, 0);
    let typedCharacters = 0;

    const typeNextCharacter = () => {
      if (lineIndex >= INTRO_LINES.length) {
        timeout = window.setTimeout(finishIntro, 450);
        return;
      }

      const line = INTRO_LINES[lineIndex];
      characterIndex += 1;
      typedCharacters += 1;
      setTypedLines((current) => {
        const next = [...current];
        next[lineIndex] = line.slice(0, characterIndex);
        return next;
      });
      setIntroProgress(Math.round((typedCharacters / totalCharacters) * 100));

      if (characterIndex === line.length) {
        lineIndex += 1;
        characterIndex = 0;
        timeout = window.setTimeout(typeNextCharacter, 180);
      } else {
        timeout = window.setTimeout(typeNextCharacter, 20);
      }
    };

    timeout = window.setTimeout(typeNextCharacter, 180);
    return () => window.clearTimeout(timeout);
  }, [showIntro]);

  useEffect(() => {
    return () => {
      walletUnsubscribe.current?.();
      walletUnsubscribe.current = null;
    };
  }, []);

  useEffect(() => {
    if (!selected || !accountId) {
      setUserContribution(null);
      setContributionError('');
      return;
    }

    let mounted = true;
    void getOnChainContribution(selected.id, accountId).then((contribution) => {
      if (mounted) {
        setUserContribution(contribution);
        setContributionError('');
      }
    }).catch((error: unknown) => {
      if (mounted) setContributionError(errorMessage(error));
    });
    return () => {
      mounted = false;
    };
  }, [selected?.id, accountId]);

  useEffect(() => {
    let mounted = true;
    const loadCampaigns = async () => {
      try {
        const contractId = getCampaignContractId();
        const onChain = await listOnChainCampaigns();
        const nativeCampaigns = onChain.filter((campaign) => campaign.token === null);
        let metadata: CampaignRow[] = [];

        if (supabase) {
          const { data, error } = await supabase.from('campaigns').select('*').eq('contract_id', contractId);
          if (error) {
            setDataError(`Campaigns are on NEAR, but saved titles are unavailable: ${error.message}`);
          } else {
            metadata = (data ?? []) as CampaignRow[];
          }
        } else {
          setDataError(`${supabaseConfigurationMessage} Campaign names will not persist without Supabase.`);
        }
        if (nativeCampaigns.length !== onChain.length) {
          setDataError('Some campaigns use fungible tokens; this frontend currently supports native NEAR campaigns only.');
        }

        if (!mounted) return;
        const metadataById = new Map(
          metadata
            .filter((row) => row.contract_campaign_id !== null)
            .map((row) => [row.contract_campaign_id as string, row]),
        );
        const loadedCampaigns = nativeCampaigns.map((row) => campaignFromChain(row, metadataById.get(row.id)));
        setCampaigns(loadedCampaigns);
        const campaignRoute = window.location.pathname.match(/^\/campaign\/([^/]+)\/?$/);
        const routeSlug = campaignRoute ? decodeURIComponent(campaignRoute[1]).toLowerCase() : '';
        const routeCampaign = loadedCampaigns.find((campaign) =>
          campaign.id === routeSlug
          || campaign.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === routeSlug,
        );
        setSelected(routeCampaign ?? loadedCampaigns[0] ?? null);
      } catch (error) {
        if (mounted) {
          setDataError(isMissingContractAccountError(error)
            ? 'The configured NEAR contract account does not exist on testnet. Initialize the deployed contract, then reload the page.'
            : errorMessage(error));
        }
      } finally {
        if (mounted) setLoadingCampaigns(false);
      }
    };
    void loadCampaigns();

    if (supabase) {
      void (async () => {
        try {
          const { data, error } = await supabase
            .from('ledger_records')
            .select('id, campaign_id, record_type, account, asset, amount, transaction_hash, created_at, donations(is_anonymous, message), campaigns(title)')
            .order('created_at', { ascending: false });
          if (!mounted) return;
          if (error) setLedgerError(`Public activity could not be loaded: ${error.message}`);
          else if (data) setLedger(data as LedgerRow[]);
        } catch (error) {
          if (mounted) setLedgerError(errorMessage(error));
        }
      })();
    } else {
      setLedgerError('Connect Supabase to save readable ledger entries. NEAR remains the source of truth for donations.');
    }

    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(
    () => campaigns.filter((campaign) =>
      `${campaign.title} ${campaign.category} ${campaign.organizer}`.toLowerCase().includes(query.toLowerCase()),
    ),
    [campaigns, query],
  );
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 5000);
  };
  const toggleSavedCause = (campaignId: string) => {
    if (!accountId) {
      notify('Connect a NEAR wallet to save causes to your profile.');
      return;
    }

    const next = savedCampaignIds.includes(campaignId)
      ? savedCampaignIds.filter((id) => id !== campaignId)
      : [...savedCampaignIds, campaignId];
    try {
      window.localStorage.setItem(`${SAVED_CAUSES_KEY}:${accountId}`, JSON.stringify(next));
      setSavedCampaignIds(next);
      setSavedCausesError('');
      notify(next.includes(campaignId) ? 'Cause saved to your profile.' : 'Cause removed from your profile.');
    } catch (error) {
      const message = `Saved causes could not be updated: ${errorMessage(error)}`;
      setSavedCausesError(message);
      notify(message);
    }
  };
  const connectWallet = async (source: 'connector' | 'selector', walletId?: 'intear-wallet' | 'near-cli') => {
    setConnectingWallet(true);
    try {
      const wallet = await import('./lib/nearWallet');
      if (!walletUnsubscribe.current) {
        walletUnsubscribe.current = await wallet.subscribeToNearAccount((nextAccountId) => {
          setAccountId(nextAccountId);
          setCanSponsorGas(wallet.canSponsorNearGas());
        });
      }
      if (source === 'connector') {
        setAccountId(await wallet.connectNearTestnetWallet(walletId));
      } else {
        setAccountId(await wallet.getSignedAccountId());
        await wallet.showNearWalletModal();
      }
      setCanSponsorGas(wallet.canSponsorNearGas());
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setConnectingWallet(false);
    }
  };
  const disconnectWallet = async () => {
    setConnectingWallet(true);
    try {
      const wallet = await import('./lib/nearWallet');
      await wallet.disconnectNearWallet();
      setAccountId(await wallet.getSignedAccountId());
      setCanSponsorGas(wallet.canSponsorNearGas());
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setConnectingWallet(false);
    }
  };
  const percent = selected ? Math.min(100, Math.round((selected.raised / selected.goal) * 100)) : 0;
  const contributionAmount = userContribution
    ? Number(BigInt(userContribution.amount)) / YOCTO_PER_NEAR
    : 0;
  const totalRaised = campaigns.reduce((sum, campaign) => sum + campaign.raised, 0);

  const openDonation = (campaign: Campaign) => {
    setSelected(campaign);
    setDonationReceipt(null);
    setShowDonate(true);
  };

  const closeDonation = () => {
    setShowDonate(false);
    setDonationReceipt(null);
  };

  const handleCreateCampaign = async (draft: CampaignDraft): Promise<string | null> => {
    setSubmittingCampaign(true);
    try {
      const { getSignedAccountId } = await import('./lib/nearWallet');
      const creator = await getSignedAccountId();
      if (!creator) throw new Error('Connect a NEAR testnet wallet before creating a campaign.');
      setAccountId(creator);

      const title = draft.title.trim();
      const goal = draft.goal.trim();
      const category = draft.category.trim();
      const beneficiary = draft.beneficiary.trim();
      const contractId = getCampaignContractId();
      const deadlineDate = draft.deadline;
      const deadlineMs = new Date(`${deadlineDate}T23:59:59.999Z`).getTime();
      if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
        throw new Error('Choose a campaign deadline in the future.');
      }
      nearToYocto(goal);
      if (!/^[a-z0-9._-]{2,64}$/.test(beneficiary)) {
        throw new Error('Enter a valid lowercase NEAR account ID for the beneficiary.');
      }
      if (beneficiary.toLowerCase() === contractId.toLowerCase()) {
        throw new Error('The campaign contract cannot be its own beneficiary. Enter your connected NEAR account or the intended recipient account.');
      }

      const campaignId = await createCampaignOnChain({
        goal,
        deadline: (BigInt(deadlineMs) * 1_000_000n).toString(),
        category,
        beneficiary,
      });

      const next: Campaign = {
        id: campaignId,
        title,
        summary: draft.summary.trim(),
        description: draft.story.trim(),
        coverUrl: draft.coverUrl.trim(),
        region: draft.region.trim(),
        beneficiaryType: draft.beneficiaryType,
        suggestedMinimum: draft.suggestedMinimum.trim(),
        verificationUrl: draft.verificationUrl.trim(),
        organizer: creator,
        treasury: beneficiary,
        category,
        raised: 0,
        goal: Number(goal),
        backers: 0,
        deadline: deadlineMs,
        status: 'active',
        payoutState: 'unclaimed',
        color: 'mint',
        milestones: [],
        updates: [],
      };

      let metadataError = '';
      if (supabase) {
        const { data, error } = await supabase
          .from('campaigns')
          .insert({
            title,
            description: campaignDescription(draft),
            category,
            organizer_account: next.organizer,
            treasury_account: beneficiary,
            treasury_type: 'sputnik',
            goal_amount: Number(goal),
            settlement_asset: 'NEAR',
            raised_amount: 0,
            backer_count: 0,
            status: 'active',
            contract_id: contractId,
            contract_campaign_id: campaignId,
          })
          .select('id')
          .single();
        if (error) metadataError = error.message;
        else next.databaseId = data.id;
      } else {
        metadataError = 'Supabase is not configured; the on-chain campaign is live, but its custom title will not persist.';
      }

      setCampaigns((previous) => [next, ...previous]);
      setSelected(next);
      notify(
        metadataError
          ? `Campaign #${campaignId} created on NEAR, but its display details were not saved: ${metadataError}`
          : `Campaign "${title}" created on NEAR testnet.`,
      );
      return campaignId;
    } catch (error) {
      notify(errorMessage(error));
      return null;
    } finally {
      setSubmittingCampaign(false);
    }
  };

  const handleSaveCampaignMetadata = async (
    campaign: Campaign,
    draft: CampaignDraft,
    updates: CampaignUpdate[],
  ): Promise<void> => {
    if (!accountId || accountId !== campaign.organizer) {
      throw new Error('Connect the wallet that created this campaign to edit its story and updates.');
    }
    if (!supabase) throw new Error('Supabase is not configured. Campaign display details cannot be saved.');
    if (!campaign.databaseId) {
      throw new Error('This campaign has no linked Supabase metadata record. Its NEAR contract state is unchanged.');
    }

    setSavingCampaignMetadata(true);
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .update({
          title: draft.title.trim(),
          category: draft.category.trim(),
          description: campaignDescription(draft, updates),
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.databaseId)
        .eq('contract_id', getCampaignContractId())
        .eq('contract_campaign_id', campaign.id)
        .eq('organizer_account', accountId)
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`Campaign metadata was not saved: ${error.message}`);
      if (!data) throw new Error('Campaign metadata was not updated. Confirm that this wallet is the campaign creator and the database record is writable.');

      const content = campaignFromDescription(campaignDescription(draft, updates));
      setCampaigns((previous) => previous.map((item) => item.id === campaign.id
        ? {
          ...item,
          title: draft.title.trim(),
          category: draft.category.trim(),
          summary: content.summary,
          description: content.story,
          coverUrl: content.coverUrl,
          region: content.region,
          beneficiaryType: content.beneficiaryType,
          suggestedMinimum: content.suggestedMinimum,
          verificationUrl: content.verificationUrl,
          updates: content.updates,
        }
        : item));
    } finally {
      setSavingCampaignMetadata(false);
    }
  };

  const handleDonate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    setSubmittingDonation(true);
    try {
      const form = new FormData(event.currentTarget);
      const amount = String(form.get('amount')).trim();
      const sponsorGas = form.get('gas') === 'sponsored';
      const message = String(form.get('message') ?? '').trim();
      const isAnonymous = form.get('anonymous') === 'on';
      nearToYocto(amount);
      const { getSignedAccountId } = await import('./lib/nearWallet');
      const donor = await getSignedAccountId();
      if (!donor) throw new Error('Connect a NEAR testnet wallet before donating.');
      setAccountId(donor);

      const transactionHash = await donateToCampaignOnChain(selected.id, amount, sponsorGas);
      let updated: OnChainCampaign | null = null;
      let refreshError = '';
      try {
        updated = await getOnChainCampaign(selected.id);
      } catch (error) {
        refreshError = errorMessage(error);
      }
      if (updated) {
        const fresh = campaignFromChain(updated);
        setCampaigns((previous) => previous.map((campaign) =>
          campaign.id === selected.id
            ? { ...campaign, raised: fresh.raised, status: fresh.status, payoutState: fresh.payoutState }
            : campaign,
        ));
        setSelected((previous) =>
          previous?.id === selected.id
            ? { ...previous, raised: fresh.raised, status: fresh.status, payoutState: fresh.payoutState }
            : previous,
        );
      }

      let ledgerWarning = '';
      if (supabase && selected.databaseId) {
        const databaseCampaignId = selected.databaseId;
        const { data: donation, error: donationError } = await supabase
          .from('donations')
          .insert({
            campaign_id: databaseCampaignId,
            donor_account: donor,
            input_asset: 'NEAR',
            input_amount: Number(amount),
            settled_asset: 'NEAR',
            settled_amount: Number(amount),
            message: message || null,
            is_anonymous: isAnonymous,
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (donationError) {
          ledgerWarning = donationError.message;
        } else {
          const { data: record, error: recordError } = await supabase
            .from('ledger_records')
            .insert({
              campaign_id: databaseCampaignId,
              donation_id: donation.id,
              record_type: 'donation',
              account: donor,
              asset: 'NEAR',
              amount: Number(amount),
              transaction_hash: transactionHash,
            })
            .select('id, created_at')
            .single();
          if (recordError) ledgerWarning = recordError.message;
          else if (record) {
            setLedger((previous) => [{
              id: record.id,
              campaign_id: databaseCampaignId,
              record_type: 'donation',
              account: donor,
              asset: 'NEAR',
              amount: Number(amount),
              created_at: record.created_at,
              transaction_hash: transactionHash,
              donations: [{ is_anonymous: isAnonymous, message: message || null }],
              campaign: { title: selected.title },
            }, ...previous]);
          }
        }
      } else {
        ledgerWarning = 'No linked Supabase campaign record is available for the public display ledger.';
      }

      const warnings = [refreshError, ledgerWarning].filter(Boolean).join(' ');
      const confirmation = sponsorGas
        ? 'Donation confirmed; Nearfund sponsored the transaction gas.'
        : 'Donation confirmed and held by the campaign contract.';
      setDonationReceipt({ amount: Number(amount), transactionHash, metadataWarning: warnings });
      notify(warnings ? `${confirmation} ${warnings}` : confirmation);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setSubmittingDonation(false);
    }
  };

  const refreshSelectedCampaign = async (campaignId: string) => {
    const updated = await getOnChainCampaign(campaignId);
    if (!updated) throw new Error(`Campaign #${campaignId} was not found on the contract.`);
    const fresh = campaignFromChain(updated);
    setCampaigns((previous) => previous.map((campaign) =>
      campaign.id === campaignId
        ? { ...campaign, raised: fresh.raised, status: fresh.status, payoutState: fresh.payoutState }
        : campaign,
    ));
    setSelected((previous) =>
      previous?.id === campaignId
        ? { ...previous, raised: fresh.raised, status: fresh.status, payoutState: fresh.payoutState }
        : previous,
    );
  };

  const handleClaimPayout = async (campaignId = selected?.id) => {
    if (!campaignId) return;
    setClaimingPayout(true);
    try {
      const transactionHash = await claimPayoutOnChain(campaignId);
      await refreshSelectedCampaign(campaignId);
      notify(`Payout claim submitted on NEAR. Transaction: ${transactionHash}`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setClaimingPayout(false);
    }
  };

  const handleClaimRefund = async () => {
    if (!selected || !accountId) {
      notify('Connect the wallet that made the donation to claim its refund.');
      return;
    }
    setClaimingRefund(true);
    try {
      const transactionHash = await claimRefundOnChain(selected.id, accountId);
      const contribution = await getOnChainContribution(selected.id, accountId);
      setUserContribution(contribution);
      notify(`Refund claim submitted on NEAR. Transaction: ${transactionHash}`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setClaimingRefund(false);
    }
  };

  if (window.location.pathname === '/campaign/new' || window.location.pathname === '/campaign/new/') {
    return <div className="app-shell">
      <CampaignWizardPage
        accountId={accountId}
        connectingWallet={connectingWallet}
        submitting={submittingCampaign}
        onConnect={() => void connectWallet('connector', 'intear-wallet')}
        onCliConnect={() => void connectWallet('connector', 'near-cli')}
        onOtherWallets={() => void connectWallet('selector')}
        onDisconnect={() => void disconnectWallet()}
        onPublish={handleCreateCampaign}
      />
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>;
  }

  if (/^\/profile\/?$/.test(window.location.pathname)) {
    return <div className="app-shell">
      <DonorProfilePage
        accountId={accountId}
        connectingWallet={connectingWallet}
        donations={profileDonations}
        loading={profileLoading}
        error={profileError}
        campaigns={campaigns}
        campaignsLoading={loadingCampaigns}
        savedCampaignIds={savedCampaignIds}
        savedError={savedCausesError}
        onConnect={() => void connectWallet('connector', 'intear-wallet')}
        onCliConnect={() => void connectWallet('connector', 'near-cli')}
        onOtherWallets={() => void connectWallet('selector')}
        onDisconnect={() => void disconnectWallet()}
        onToggleSave={toggleSavedCause}
      />
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>;
  }

  if (/^\/(how-it-works|about)\/?$/.test(window.location.pathname)) {
    const page = window.location.pathname.startsWith('/about') ? 'about' : 'how-it-works';
    return <InfoPage page={page} accountId={accountId} connectingWallet={connectingWallet} toast={toast} onConnect={() => void connectWallet('connector', 'intear-wallet')} onCliConnect={() => void connectWallet('connector', 'near-cli')} onOtherWallets={() => void connectWallet('selector')} onDisconnect={() => void disconnectWallet()} />;
  }

  if (window.location.pathname === '/dashboard' || window.location.pathname === '/dashboard/') {
    return <div className="app-shell">
      <DashboardPage
        accountId={accountId}
        campaigns={campaigns}
        ledger={ledger}
        loading={loadingCampaigns}
        error={dataError || ledgerError}
        connectingWallet={connectingWallet}
        claimingPayout={claimingPayout}
        onConnect={() => void connectWallet('connector', 'intear-wallet')}
        onCliConnect={() => void connectWallet('connector', 'near-cli')}
        onOtherWallets={() => void connectWallet('selector')}
        onDisconnect={() => void disconnectWallet()}
        onCreate={() => { window.location.href = '/campaign/new'; }}
        onClaimPayout={(campaignId) => void handleClaimPayout(campaignId)}
        onShare={notify}
      />
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>;
  }

  const manageRoute = window.location.pathname.match(/^\/dashboard\/campaign\/([^/]+)\/?$/);
  if (manageRoute) {
    const campaignId = decodeURIComponent(manageRoute[1]);
    const campaign = campaigns.find((item) => item.id === campaignId) ?? null;
    return <div className="app-shell">
      <ManageCampaignPage
        campaign={campaign}
        loading={loadingCampaigns}
        error={dataError || ledgerError}
        accountId={accountId}
        connectingWallet={connectingWallet}
        saving={savingCampaignMetadata}
        claimingPayout={claimingPayout}
        ledger={campaign?.databaseId ? ledger.filter((row) => row.campaign_id === campaign.databaseId) : []}
        onConnect={() => void connectWallet('connector', 'intear-wallet')}
        onCliConnect={() => void connectWallet('connector', 'near-cli')}
        onOtherWallets={() => void connectWallet('selector')}
        onDisconnect={() => void disconnectWallet()}
        onSave={(draft, updates) => campaign
          ? handleSaveCampaignMetadata(campaign, draft, updates)
          : Promise.reject(new Error('Campaign is not available.'))}
        onClaimPayout={() => void handleClaimPayout(campaignId)}
        onShare={notify}
      />
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>;
  }

  const campaignPathMatch = window.location.pathname.match(/^\/campaign\/([^/]+)\/?$/);
  if (campaignPathMatch) {
    const campaignSlug = decodeURIComponent(campaignPathMatch[1]).toLowerCase();
    const campaign = campaigns.find((item) =>
      item.id === campaignSlug
      || item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === campaignSlug,
    ) ?? null;

    return <div className="app-shell">
      <CampaignPage
        campaign={campaign}
        campaignsLoading={loadingCampaigns}
        error={dataError}
        ledger={campaign ? ledger.filter((row) => ledgerCampaignTitle(row) === campaign.title) : []}
        accountId={accountId}
        connectingWallet={connectingWallet}
        isSaved={campaign ? savedCampaignIds.includes(campaign.id) : false}
        onToggleSave={toggleSavedCause}
        onConnect={() => void connectWallet('connector', 'intear-wallet')}
        onCliConnect={() => void connectWallet('connector', 'near-cli')}
        onOtherWallets={() => void connectWallet('selector')}
        onDisconnect={() => void disconnectWallet()}
        onDonate={campaign ? () => openDonation(campaign) : undefined}
        onShare={notify}
      />
      {showDonate && selected && <DonationModal
        campaign={selected}
        canSponsorGas={canSponsorGas}
        submitting={submittingDonation}
        receipt={donationReceipt}
        onSubmit={handleDonate}
        onClose={closeDonation}
        onShare={notify}
      />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>;
  }

  if (window.location.pathname === '/explore') {
    return <div className="app-shell">
      <ExplorePage
        campaigns={campaigns}
        loading={loadingCampaigns}
        error={dataError}
        accountId={accountId}
        connectingWallet={connectingWallet}
        savedCampaignIds={savedCampaignIds}
        onToggleSave={toggleSavedCause}
        onConnect={() => void connectWallet('connector', 'intear-wallet')}
        onCliConnect={() => void connectWallet('connector', 'near-cli')}
        onOtherWallets={() => void connectWallet('selector')}
        onDisconnect={() => void disconnectWallet()}
        onDonate={openDonation}
      />
      {showDonate && selected && <DonationModal
        campaign={selected}
        canSponsorGas={canSponsorGas}
        submitting={submittingDonation}
        receipt={donationReceipt}
        onSubmit={handleDonate}
        onClose={closeDonation}
        onShare={notify}
      />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>;
  }

  return <div className="app-shell">
    {showIntro && <div className="intro-screen" role="status" aria-live="polite">
      <div className="intro-content">
        <div className="intro-brand"><span className="pulse" /> NEARFUND / TESTNET</div>
        <div className="intro-terminal">
          {typedLines.map((line, index) => <div key={index}>{line}</div>)}
          <span className="intro-cursor" aria-hidden="true">▌</span>
        </div>
        <div className="intro-progress"><span style={{ width: `${introProgress}%` }} /></div>
        <div className="intro-footer"><span>INITIALIZING {introProgress}%</span><button onClick={finishIntro}>Skip intro <ArrowUpRight size={13} /></button></div>
      </div>
    </div>}
    <header className="topbar">
      <a className="brand" href="#top">
        <img className="brand-logo" src="/assets/images/mint_presentation.png" alt="Nearfund" />
        <span>Nearfund</span>
      </a>
      <nav><a href="/explore">Explore</a><a href="/dashboard">Dashboard</a><a href="/profile">Profile</a><a href="/how-it-works">How it works</a><a href="/about">About</a><a href="#ledger">Public ledger</a></nav>
      <div className="top-actions">
        <div className="wallet-options">
          {accountId ? <>
            <span className="wallet-account">{accountId}</span>
            <button className="wallet-alt-button" onClick={() => void disconnectWallet()} disabled={connectingWallet}>
              {connectingWallet ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </> : <>
            <WalletConnectionButtons
              connectingWallet={connectingWallet}
              onConnect={() => void connectWallet('connector', 'intear-wallet')}
              onCliConnect={() => void connectWallet('connector', 'near-cli')}
              onOtherWallets={() => void connectWallet('selector')}
            />
          </>}
        </div>
        <button className="icon-button mobile-menu"><Menu size={19} /></button>
      </div>
    </header>
    <main id="top">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse" /> Open funding, accountable delivery</div>
          <h1>Fund the work.<br /><em>Follow the proof.</em></h1>
          <p>Nearfund connects community causes with the treasuries that already govern them. Every donation is visible. Every payout follows the campaign’s on-chain goal and deadline rules.</p>
          <div className="hero-actions">
            <a className="primary-button" href="/campaign/new">Start a campaign <ArrowUpRight size={17} /></a>
            <a className="text-button" href="/explore">Explore campaigns <ChevronRight size={16} /></a>
          </div>
          <div className="hero-proof">
            <span><strong>{totalRaised.toLocaleString()}</strong> NEAR raised</span>
            <span><strong>{campaigns.length.toLocaleString()}</strong> campaigns</span>
            <span><strong>{ledger.length.toLocaleString()}</strong> ledger records</span>
          </div>
        </div>
        <div className="hero-art">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="art-card">
            <div className="art-label">LIVE TREASURY ROUTE</div>
            <div className="art-flow">
              <div className="flow-node">DONORS<span>NEAR testnet</span></div>
              <div className="flow-line" />
              <div className="flow-node accent">CONTRACT<span>escrow accounting</span></div>
            </div>
            <div className="art-footer"><ShieldCheck size={15} /> payout follows contract rules</div>
          </div>
        </div>
      </section>

      <div className="mission-ticker" aria-label="Build without borders, give without limits, make your signal matter">
        <div className="mission-ticker-track" aria-hidden="true">
          {[0, 1].map((copy) => (
            <span className="mission-ticker-copy" key={copy}>
              BUILD WITHOUT BORDERS <i>✳</i> GIVE WITHOUT LIMITS <i>✳</i> MAKE YOUR SIGNAL MATTER <i>✳</i> EVERY GIFT LEAVES A TRACE <i>✳</i>
            </span>
          ))}
        </div>
      </div>

      <section className="section" id="discover">
        <div className="section-heading">
          <div>
            <div className="eyebrow">01 / Featured campaigns</div>
            <h2><span className="terminal-prompt">&gt;_ campaigns.list</span><br />Back a clear next step.</h2>
            {loadingCampaigns && <p className="live-note">Loading campaigns from NEAR…</p>}
            {dataError && <p className="live-note">{dataError}</p>}
          </div>
          <div className="discover-tools">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search causes or accounts" />
            <button className="filter-chip active">All causes</button>
          </div>
        </div>
        <div className="campaign-layout">
          <div className="campaign-list">
            {filtered.map((campaign) => (
              <button key={campaign.id} className={`campaign-row ${selected?.id === campaign.id ? 'selected' : ''}`} onClick={() => setSelected(campaign)}>
                <span className={`campaign-dot ${campaign.color}`} />
                <span className="campaign-meta"><strong>{campaign.title}</strong><small>{campaign.category} · {campaign.organizer}</small></span>
                <span className="campaign-amount"><b>{campaign.raised.toLocaleString()}</b><small>of {campaign.goal.toLocaleString()} NEAR</small></span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
          <article className="campaign-detail">
            {selected ? <>
              <div className="detail-top">
                <span className="status-pill"><span /> {selected.status} campaign</span>
                <span className="detail-category">{selected.category}</span>
              </div>
              <h3>{selected.title}</h3>
              <p className="organizer">Created by <strong>{selected.organizer}</strong> <span className="verified"><Check size={11} /></span></p>
              <div className="progress-wrap">
                <div className="progress-label"><strong>{selected.raised.toLocaleString()} NEAR</strong><span>{percent}% funded</span></div>
                <div className="progress"><span style={{ width: `${percent}%` }} /></div>
                <div className="progress-foot"><span>Goal {selected.goal.toLocaleString()} NEAR</span><span>Deadline {new Date(selected.deadline).toLocaleDateString()}</span></div>
              </div>
              <button className="primary-button full" onClick={() => openDonation(selected)} disabled={selected.status !== 'active'}>
                Donate to this campaign <CircleDollarSign size={17} />
              </button>
              <div className="milestone-heading"><strong>Contract escrow rules</strong><span>NEAR testnet · #{selected.id}</span></div>
              <p className="live-note">
                {selected.status === 'active'
                  ? 'NEAR donations are held by the contract until the deadline. The goal determines payout or donor refund eligibility.'
                  : selected.status === 'successful'
                    ? 'The goal was reached. The beneficiary can claim the campaign funds after the deadline.'
                    : 'The goal was not reached. Contributors can claim refunds after the deadline.'}
              </p>
              {contributionError && <p className="live-note">{contributionError}</p>}
              {selected.status === 'successful' && selected.payoutState !== 'paid' && (
                <button className="primary-button full" onClick={() => void handleClaimPayout()} disabled={claimingPayout || selected.payoutState === 'pending'}>
                  {claimingPayout || selected.payoutState === 'pending' ? 'Payout is pending…' : 'Trigger beneficiary payout'}
                </button>
              )}
              {selected.status === 'failed' && contributionAmount > 0 && userContribution?.refund_state !== 'paid' && (
                <button className="primary-button full" onClick={handleClaimRefund} disabled={claimingRefund || userContribution?.refund_state === 'pending'}>
                  {claimingRefund || userContribution?.refund_state === 'pending'
                    ? 'Refund is pending…'
                    : `Claim your ${contributionAmount.toLocaleString()} NEAR refund`}
                </button>
              )}
            </> : <div className="empty-state">
              <strong>{loadingCampaigns ? 'Loading campaigns…' : 'No campaigns found on this contract.'}</strong>
              <span>Create the first campaign to begin the on-chain public record.</span>
              <a className="primary-button" href="/campaign/new">Create a campaign <ArrowUpRight size={17} /></a>
            </div>}
          </article>
        </div>
      </section>

      <section className="trust-strip" id="how">
        <div className="trust-heading">
          <div className="eyebrow">02 / How it works</div>
          <h2><span className="terminal-prompt">&gt;_ how.nearfund.works</span></h2>
        </div>
        <div><Sparkles size={18} /><strong>Built on existing governance</strong><span>Campaign funds stay in the contract until its payout rules are met.</span></div>
        <div><ShieldCheck size={18} /><strong>Deadline-aware payouts</strong><span>Successful campaigns pay the beneficiary; unsuccessful campaigns allow donor refunds.</span></div>
        <div><CircleDollarSign size={18} /><strong>NEAR testnet giving</strong><span>Native NEAR donations are recorded by the campaign contract.</span></div>
      </section>

      <section className="section ledger-section" id="ledger">
        <div className="section-heading">
          <div><div className="eyebrow">02 / Public ledger</div><h2>Nothing disappears after “send.”</h2></div>
          <button className="text-button" onClick={() => notify('Ledger export is ready for the next release')}>Export ledger <ArrowUpRight size={16} /></button>
        </div>
        {ledgerError && <p className="live-note">{ledgerError}</p>}
        <div className="ledger-table">
          <div className="ledger-head"><span>Type</span><span>Account</span><span>Amount</span><span>Reference</span><span>Time</span></div>
          {ledger.length ? ledger.map((row) => (
            <div className="ledger-row" key={row.id}>
              <span><i className={`ledger-icon ${row.record_type === 'donation' ? 'donation' : 'milestone'}`}>{row.record_type === 'donation' ? '+' : '−'}</i>{row.record_type === 'donation' ? 'Donation' : 'Milestone'}</span>
              <span className="mono">{row.donations?.[0]?.is_anonymous ? 'Anonymous supporter' : row.account}</span>
              <span className={row.record_type === 'donation' ? 'positive' : 'negative'}>{row.amount.toLocaleString()} {row.asset}</span>
              <span>{ledgerCampaignTitle(row) ?? 'Campaign record'}</span>
              <span className="muted">{new Date(row.created_at).toLocaleDateString()}</span>
            </div>
          )) : <div className="empty-ledger">No public records yet.</div>}
        </div>
      </section>
    </main>
    <footer>
      <span className="brand"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="Nearfund" /><span>Nearfund</span></span>
      <span>Community funding with a visible trail.</span>
      <span>NEAR testnet demo</span>
      <span className="info-footer-links"><a href="/how-it-works">How it works</a><a href="/about">About Nearfund</a></span>
    </footer>

    {showDonate && selected && <DonationModal
      campaign={selected}
      canSponsorGas={canSponsorGas}
      submitting={submittingDonation}
      receipt={donationReceipt}
      onSubmit={handleDonate}
      onClose={closeDonation}
      onShare={notify}
    />}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>;
}

function CampaignWizardPage({
  accountId,
  connectingWallet,
  submitting,
  onConnect,
  onCliConnect,
  onOtherWallets,
  onDisconnect,
  onPublish,
}: {
  accountId: string | null;
  connectingWallet: boolean;
  submitting: boolean;
  onConnect: () => void;
  onCliConnect: () => void;
  onOtherWallets: () => void;
  onDisconnect: () => void;
  onPublish: (draft: CampaignDraft) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaignDraft);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [step, setStep] = useState(0);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');
  const formRef = useRef<HTMLFormElement | null>(null);
  const steps = ['Basics', 'Goal', 'Story', 'Payout & trust', 'Preview'];

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CAMPAIGN_DRAFT_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isCampaignDraft(parsed)) setDraft(parsed);
        else setDraftError('The saved campaign draft is invalid and has been replaced with a fresh draft.');
      }
    } catch (error) {
      setDraftError(`Unable to load the saved campaign draft: ${errorMessage(error)}`);
    } finally {
      setDraftLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (draftLoaded && accountId && !draft.beneficiary) {
      setDraft((current) => ({ ...current, beneficiary: accountId }));
    }
  }, [accountId, draft.beneficiary, draftLoaded]);

  useEffect(() => {
    if (!draftLoaded || publishedId) return;
    try {
      window.localStorage.setItem(CAMPAIGN_DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      setDraftError(`Unable to save this draft in your browser: ${errorMessage(error)}`);
    }
  }, [draft, draftLoaded, publishedId]);

  const updateDraft = <K extends keyof CampaignDraft>(field: K, value: CampaignDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const moveForward = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError('');
    if (!formRef.current?.reportValidity()) return;

    if (step === 1) {
      try {
        nearToYocto(draft.goal);
        if (draft.suggestedMinimum) nearToYocto(draft.suggestedMinimum);
      } catch (error) {
        setValidationError(errorMessage(error));
        return;
      }
      if (new Date(`${draft.deadline}T23:59:59.999Z`).getTime() <= Date.now()) {
        setValidationError('Choose a campaign deadline in the future. The current contract requires a deadline.');
        return;
      }
    }
    if (step === 2 && draft.coverUrl) {
      try {
        const url = new URL(draft.coverUrl);
        if (url.protocol !== 'https:') throw new Error('Cover media must use a secure HTTPS URL.');
      } catch (error) {
        setValidationError(error instanceof TypeError ? 'Enter a valid HTTPS URL for the cover image.' : errorMessage(error));
        return;
      }
    }
    if (step === 3 && draft.verificationUrl) {
      try {
        const url = new URL(draft.verificationUrl);
        if (url.protocol !== 'https:') throw new Error('Verification links must use HTTPS.');
      } catch (error) {
        setValidationError(error instanceof TypeError ? 'Enter a valid HTTPS verification link.' : errorMessage(error));
        return;
      }
    }
    if (step === 3 && !/^[a-z0-9._-]{2,64}$/.test(draft.beneficiary.trim())) {
      setValidationError('Enter a valid lowercase NEAR account ID for the beneficiary.');
      return;
    }
    if (step === 3 && draft.beneficiary.trim().toLowerCase() === getCampaignContractId().toLowerCase()) {
      setValidationError('The campaign contract cannot be its own beneficiary. Enter your connected NEAR account or the intended recipient account.');
      return;
    }

    if (step < steps.length - 1) {
      setStep((current) => current + 1);
      return;
    }

    const campaignId = await onPublish(draft);
    if (campaignId) {
      setPublishedId(campaignId);
      try {
        window.localStorage.removeItem(CAMPAIGN_DRAFT_KEY);
      } catch (error) {
        setDraftError(`Campaign published, but the saved draft could not be cleared: ${errorMessage(error)}`);
      }
    }
  };

  return <>
    <header className="topbar create-topbar">
      <a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="Nearfund" /><span>Nearfund</span></a>
      <nav><a href="/explore">Explore</a><a href="/dashboard">Dashboard</a><a href="/profile">Profile</a><a href="/#how">How it works</a><a href="/#ledger">Public ledger</a></nav>
      <div className="top-actions">
        {accountId
          ? <div className="wallet-options"><span className="wallet-account">{accountId}</span><button className="wallet-alt-button" onClick={onDisconnect} disabled={connectingWallet}>Disconnect</button></div>
          : <div className="wallet-options"><WalletConnectionButtons connectingWallet={connectingWallet} onConnect={onConnect} onCliConnect={onCliConnect} onOtherWallets={onOtherWallets} /></div>}
      </div>
    </header>
    <main className="create-page">
      <div className="create-heading">
        <a className="create-back-link" href="/">← Back to Nearfund</a>
        <p className="eyebrow">NEARFUND / CAMPAIGN LAUNCH</p>
        <h1><span className="terminal-prompt">&gt;_ campaign.create</span><br />Make your cause visible.</h1>
        <p>Tell your story, set a NEAR goal and publish the campaign contract.</p>
      </div>
      <div className="create-wizard-layout">
        <section className="create-wizard" aria-label="Campaign creation wizard">
          <div className="create-progress">
            <div className="create-progress-meta"><span className="eyebrow">STEP {String(step + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span><span>{Math.round(((step + 1) / steps.length) * 100)}% COMPLETE</span></div>
            <div className="create-progress-track"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
            <div className="create-step-list">{steps.map((label, index) => <button key={label} type="button" className={index === step ? 'active' : index < step ? 'complete' : ''} onClick={() => index < step && setStep(index)} disabled={index > step || submitting}>{String(index + 1).padStart(2, '0')} <span>{label}</span></button>)}</div>
          </div>
          {draftError && <p className="create-draft-alert" role="status">{draftError}</p>}
          {publishedId ? <div className="create-published">
            <span className="create-published-mark"><Check size={25} /></span>
            <span className="eyebrow">ON-CHAIN / PUBLISHED</span>
            <h2>Your campaign is live on NEAR.</h2>
            <p>Campaign #{publishedId} has been created. The contract stores its goal, deadline, category and beneficiary. Your story and cover are saved as display metadata.</p>
            <a className="primary-button" href={`/campaign/${encodeURIComponent(publishedId)}`}>View campaign <ArrowUpRight size={16} /></a>
          </div> : <form ref={formRef} className="create-step-form" onSubmit={(event) => void moveForward(event)}>
            {step === 0 && <div className="create-step-content">
              <span className="eyebrow">01 / THE BASICS</span><h2>What are you raising for?</h2>
              <label>Campaign title<input required minLength={2} maxLength={120} value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder="A clear name for your cause" /></label>
              <div className="create-field-grid">
                <label>Category<select value={draft.category} onChange={(event) => updateDraft('category', event.target.value)}>{CAMPAIGN_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label>Country or region<input required value={draft.region} onChange={(event) => updateDraft('region', event.target.value)} placeholder="e.g. Lagos, Nigeria" /></label>
              </div>
              <label>Who are the funds for?<select value={draft.beneficiaryType} onChange={(event) => updateDraft('beneficiaryType', event.target.value)}><option>Myself</option><option>Someone else</option><option>A group or organization</option></select></label>
            </div>}
            {step === 1 && <div className="create-step-content">
              <span className="eyebrow">02 / THE GOAL</span><h2>Set a clear target.</h2>
              <label>Funding goal (NEAR)<input required type="number" min="0.000001" step="0.000001" value={draft.goal} onChange={(event) => updateDraft('goal', event.target.value)} placeholder="24" /></label>
              <div className="create-field-grid">
                <label>Deadline<input required type="date" min={new Date().toISOString().slice(0, 10)} max={MAX_DEADLINE_DATE} value={draft.deadline} onChange={(event) => updateDraft('deadline', event.target.value)} /></label>
                <label>Settlement asset<select value="NEAR" disabled><option>NEAR</option></select></label>
              </div>
              <label>Suggested minimum gift (NEAR)<input type="number" min="0.000001" step="0.000001" value={draft.suggestedMinimum} onChange={(event) => updateDraft('suggestedMinimum', event.target.value)} placeholder="Optional" /></label>
              <p className="create-capability-note">This deployed contract supports NEAR and requires a deadline. The suggested minimum is display guidance only; the contract does not enforce it. USDC settlement and campaigns without deadlines need a contract update.</p>
            </div>}
            {step === 2 && <div className="create-step-content">
              <span className="eyebrow">03 / YOUR STORY</span><h2>Help supporters understand.</h2>
              <label>Short summary <span className="create-counter">{draft.summary.length}/140</span><input required maxLength={140} value={draft.summary} onChange={(event) => updateDraft('summary', event.target.value)} placeholder="One sentence that brings the cause into focus" /></label>
              <label>Full story<textarea required rows={7} maxLength={5000} value={draft.story} onChange={(event) => updateDraft('story', event.target.value)} placeholder="Explain the need, your plan and the impact each gift can make." /></label>
              <label>Cover image URL <span className="create-optional">OPTIONAL · HTTPS</span><input type="url" value={draft.coverUrl} onChange={(event) => updateDraft('coverUrl', event.target.value)} placeholder="https://…" /></label>
              <p className="create-capability-note">Story and cover details are saved as Supabase display metadata. The campaign contract remains the source of truth for funds and status.</p>
            </div>}
            {step === 3 && <div className="create-step-content">
              <span className="eyebrow">04 / PAYOUT & TRUST</span><h2>Choose where funds go.</h2>
              <label>Beneficiary NEAR account<input required minLength={2} maxLength={64} value={draft.beneficiary} onChange={(event) => updateDraft('beneficiary', event.target.value)} placeholder="beneficiary.testnet" /></label>
              <label>Verification link <span className="create-optional">OPTIONAL</span><input type="url" value={draft.verificationUrl} onChange={(event) => updateDraft('verificationUrl', event.target.value)} placeholder="Organization page or public profile" /></label>
              <div className="create-contract-note"><ShieldCheck size={17} /><div><strong>Contract-controlled payout</strong><span>Goal, deadline and beneficiary are written on NEAR. Milestone release and co-signer approvals are not supported by this deployed contract yet.</span></div></div>
              {!accountId && <div className="create-connect-note"><strong>Connect a NEAR testnet wallet to publish.</strong><span>You can finish the draft first. A wallet signature is required at the final step.</span></div>}
            </div>}
            {step === 4 && <div className="create-step-content create-review">
              <span className="eyebrow">05 / REVIEW & PUBLISH</span><h2>Check everything once.</h2>
              <div className="create-review-section"><span className="eyebrow">CAMPAIGN</span><strong>{draft.title || 'Untitled campaign'}</strong><span>{draft.category} · {draft.region} · Funds for {draft.beneficiaryType.toLowerCase()}</span></div>
              <div className="create-review-grid"><div><span className="eyebrow">GOAL</span><strong>{draft.goal || '0'} NEAR</strong></div><div><span className="eyebrow">DEADLINE</span><strong>{draft.deadline ? new Date(`${draft.deadline}T00:00:00`).toLocaleDateString() : 'Not set'}</strong></div><div><span className="eyebrow">BENEFICIARY</span><strong>{draft.beneficiary || 'Not set'}</strong></div></div>
              <div className="create-review-story"><span className="eyebrow">STORY</span><p>{draft.summary}</p><div>{draft.story}</div></div>
              {draft.suggestedMinimum && <p className="create-capability-note">Suggested minimum gift: {draft.suggestedMinimum} NEAR. This is display guidance only.</p>}
              {draft.verificationUrl && <a className="create-review-link" href={draft.verificationUrl} target="_blank" rel="noreferrer">Open verification link <ExternalLink size={13} /></a>}
              <p className="create-capability-note">Publishing asks your wallet to create this campaign on NEAR testnet. Its on-chain fields are goal, deadline, category and beneficiary. The title, region, story, cover and verification link are display metadata.</p>
            </div>}
            {validationError && <p className="create-validation-error" role="alert">{validationError}</p>}
            <div className="create-step-actions">
              {step > 0 && <button className="create-back-button" type="button" onClick={() => { setValidationError(''); setStep((current) => current - 1); }} disabled={submitting}>Back</button>}
              <button className="primary-button" type="submit" disabled={submitting}>
                {step === steps.length - 1 ? submitting ? 'Waiting for wallet…' : 'Publish on NEAR' : 'Continue'}
                {step === steps.length - 1 ? <ArrowUpRight size={17} /> : <ChevronRight size={17} />}
              </button>
            </div>
          </form>}
        </section>
        <aside className="create-live-preview">
          <div className="create-preview-head"><span className="eyebrow">LIVE PREVIEW</span><span>NEAR TESTNET</span></div>
          <div className={`create-preview-art ${draft.coverUrl ? 'has-image' : ''}`}>
            {draft.coverUrl && <img src={draft.coverUrl} alt="" />}
            <span className="eyebrow">NEARFUND / YOUR CAUSE</span><strong>{draft.category || 'Community'}</strong>
          </div>
          <div className="create-preview-body">
            <span className="eyebrow">{draft.region || 'YOUR REGION'}</span>
            <h3>{draft.title || 'Your campaign title'}</h3>
            <p>{draft.summary || 'Your short campaign summary will appear here.'}</p>
            <div className="create-preview-goal"><span>GOAL</span><strong>{draft.goal ? Number(draft.goal).toLocaleString() : '0'} NEAR</strong></div>
            <div className="create-preview-bar"><span /></div>
            <span className="create-preview-deadline">Deadline {draft.deadline ? new Date(`${draft.deadline}T00:00:00`).toLocaleDateString() : 'not set'}</span>
          </div>
        </aside>
      </div>
    </main>
    <footer className="explore-footer"><a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="" /><span>Nearfund</span></a><span>Community funding with a visible trail.</span><a href="/explore">Explore campaigns <ArrowUpRight size={14} /></a></footer>
  </>;
}

function DashboardPage({
  accountId,
  campaigns,
  ledger,
  loading,
  error,
  connectingWallet,
  claimingPayout,
  onConnect,
  onCliConnect,
  onOtherWallets,
  onDisconnect,
  onCreate,
  onClaimPayout,
  onShare,
}: {
  accountId: string | null;
  campaigns: Campaign[];
  ledger: LedgerRow[];
  loading: boolean;
  error: string;
  connectingWallet: boolean;
  claimingPayout: boolean;
  onConnect: () => void;
  onCliConnect: () => void;
  onOtherWallets: () => void;
  onDisconnect: () => void;
  onCreate: () => void;
  onClaimPayout: (campaignId: string) => void;
  onShare: (message: string) => void;
}) {
  const [shareError, setShareError] = useState('');
  const ownedCampaigns = useMemo(() => accountId
    ? campaigns.filter((campaign) => campaign.organizer === accountId || campaign.treasury === accountId)
    : [], [accountId, campaigns]);
  const createdCampaigns = ownedCampaigns.filter((campaign) => campaign.organizer === accountId);
  const totalRaised = createdCampaigns.reduce((sum, campaign) => sum + campaign.raised, 0);
  const activeCampaignCount = createdCampaigns.filter((campaign) => campaign.status === 'active').length;
  const campaignDatabaseIds = new Set(ownedCampaigns.map((campaign) => campaign.databaseId).filter((id): id is string => Boolean(id)));
  const recentActivity = ledger.filter((row) => campaignDatabaseIds.has(row.campaign_id)).slice(0, 8);

  const shareCampaign = async (campaign: Campaign) => {
    setShareError('');
    const url = new URL(`/campaign/${encodeURIComponent(campaign.id)}`, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: campaign.title, text: `Support ${campaign.title} on Nearfund.`, url });
      } else {
        await navigator.clipboard.writeText(url);
        onShare('Campaign link copied to clipboard.');
      }
    } catch (shareFailure) {
      if (shareFailure instanceof DOMException && shareFailure.name === 'AbortError') return;
      setShareError(errorMessage(shareFailure));
    }
  };

  return <>
    <header className="topbar dashboard-topbar">
      <a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="Nearfund" /><span>Nearfund</span></a>
      <nav><a href="/explore">Explore</a><a href="/dashboard">Dashboard</a><a href="/profile">Profile</a><a href="/#how">How it works</a><a href="/#ledger">Public ledger</a></nav>
      <div className="top-actions">
        {accountId
          ? <div className="wallet-options"><span className="wallet-account">{accountId}</span><button className="wallet-alt-button" onClick={onDisconnect} disabled={connectingWallet}>Disconnect</button></div>
          : <div className="wallet-options"><WalletConnectionButtons connectingWallet={connectingWallet} onConnect={onConnect} onCliConnect={onCliConnect} onOtherWallets={onOtherWallets} /></div>}
      </div>
    </header>
    <main className="dashboard-page">
      <section className="dashboard-heading">
        <div>
          <span className="eyebrow">NEARFUND / CREATOR SPACE</span>
          <h1><span className="terminal-prompt">&gt;_ dashboard</span><br />Your work, in view.</h1>
          <p>Track campaigns and on-chain progress from the wallet that created or receives funds.</p>
        </div>
        <button className="primary-button" onClick={onCreate}>Start a campaign <ArrowUpRight size={16} /></button>
      </section>
      {error && <p className="dashboard-notice" role="status">{error}</p>}
      {!accountId ? <section className="dashboard-connect">
        <span className="eyebrow">WALLET REQUIRED</span>
        <h2>Connect your NEAR testnet wallet.</h2>
        <p>Your campaigns are read from the NEAR contract and matched to this wallet account.</p>
        <div className="wallet-options"><WalletConnectionButtons connectingWallet={connectingWallet} onConnect={onConnect} onCliConnect={onCliConnect} onOtherWallets={onOtherWallets} /></div>
      </section> : <>
        <div className="dashboard-account"><span className="pulse" /> CONNECTED / <strong>{accountId}</strong></div>
        <section className="dashboard-stats" aria-label="Campaign summary">
          <article><span className="eyebrow">TOTAL RAISED</span><strong>{totalRaised.toLocaleString()} <small>NEAR</small></strong><span>Across campaigns you created</span></article>
          <article><span className="eyebrow">YOUR CAMPAIGNS</span><strong>{createdCampaigns.length}</strong><span>{activeCampaignCount} active on NEAR</span></article>
          <article><span className="eyebrow">CAMPAIGN RECORD</span><strong>{loading ? 'SYNCING' : 'ON-CHAIN'}</strong><span>Contract is the source of truth</span></article>
        </section>
        <section className="dashboard-section">
          <div className="dashboard-section-heading"><div><span className="eyebrow">01 / CAMPAIGNS</span><h2>&gt;_ your.portfolio</h2></div><a className="text-button" href="/explore">Explore all <ArrowUpRight size={14} /></a></div>
          {loading && campaigns.length === 0
            ? <div className="dashboard-empty"><span className="pulse" /><strong>Loading campaigns from NEAR…</strong></div>
            : ownedCampaigns.length > 0
              ? <div className="dashboard-campaign-list">{ownedCampaigns.map((campaign) => {
                const isCreator = campaign.organizer === accountId;
                const payoutReady = campaign.treasury === accountId
                  && campaign.status === 'successful'
                  && campaign.payoutState !== 'paid';
                const progress = campaign.goal > 0 ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100)) : 0;
                return <article className="dashboard-campaign" key={campaign.id}>
                  <div className="dashboard-campaign-main">
                    <div className="dashboard-campaign-top"><span className={`status-pill ${campaign.status === 'successful' ? 'dashboard-success' : ''}`}><span />{campaign.status}</span><span className="detail-category">#{campaign.id} / {isCreator ? 'CREATOR' : 'BENEFICIARY'}</span></div>
                    <h3><a href={`/campaign/${encodeURIComponent(campaign.id)}`}>{campaign.title}</a></h3>
                    <p>{campaign.category}{campaign.region ? ` · ${campaign.region}` : ''}</p>
                    <div className="dashboard-campaign-progress"><div className="progress-label"><strong>{campaign.raised.toLocaleString()} NEAR</strong><span>{progress}%</span></div><div className="progress"><span style={{ width: `${progress}%` }} /></div><div className="progress-foot"><span>Goal {campaign.goal.toLocaleString()} NEAR</span><span>Due {new Date(campaign.deadline).toLocaleDateString()}</span></div></div>
                  </div>
                  <div className="dashboard-campaign-actions">
                    <a className="dashboard-secondary-action" href={`/campaign/${encodeURIComponent(campaign.id)}`}>View <ArrowUpRight size={14} /></a>
                    {isCreator && <a className="dashboard-secondary-action" href={`/dashboard/campaign/${encodeURIComponent(campaign.id)}`}>Manage <ArrowUpRight size={14} /></a>}
                    <button className="dashboard-secondary-action" onClick={() => void shareCampaign(campaign)}>Share <Copy size={13} /></button>
                    {payoutReady && <button className="primary-button dashboard-payout" onClick={() => onClaimPayout(campaign.id)} disabled={claimingPayout || campaign.payoutState === 'pending'}>
                      {claimingPayout ? 'Submitting…' : 'Claim payout'} <ArrowUpRight size={14} />
                    </button>}
                    {campaign.payoutState === 'paid' && <span className="dashboard-payout-paid"><Check size={14} /> Paid</span>}
                  </div>
                </article>;
              })}</div>
              : <div className="dashboard-empty"><strong>No campaigns are linked to this wallet yet.</strong><span>Create your first campaign or connect the creator/beneficiary wallet.</span><button className="primary-button" onClick={onCreate}>Create a campaign <ArrowUpRight size={15} /></button></div>}
          {shareError && <p className="dashboard-share-error" role="alert">{shareError}</p>}
        </section>
        <section className="dashboard-section dashboard-activity">
          <div className="dashboard-section-heading"><div><span className="eyebrow">02 / RECENT ACTIVITY</span><h2>&gt;_ ledger.latest</h2></div><a className="text-button" href="/#ledger">Public ledger <ArrowUpRight size={14} /></a></div>
          {recentActivity.length > 0 ? <div className="dashboard-activity-list">{recentActivity.map((row) => (
            <div className="dashboard-activity-row" key={row.id}>
              <span className={`ledger-icon ${row.record_type === 'donation' ? 'donation' : 'milestone'}`}>{row.record_type === 'donation' ? '+' : '−'}</span>
              <span className="dashboard-activity-detail"><strong>{row.record_type === 'donation' ? 'Donation received' : 'Payout recorded'}</strong><small>{ledgerCampaignTitle(row) ?? 'Campaign'} · {new Date(row.created_at).toLocaleString()}</small></span>
              <strong className={row.record_type === 'donation' ? 'positive' : 'negative'}>{row.amount.toLocaleString()} {row.asset}</strong>
              {row.transaction_hash && <a className="dashboard-transaction-link" href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(row.transaction_hash)}`} target="_blank" rel="noreferrer" aria-label="View transaction"><ExternalLink size={14} /></a>}
            </div>
          ))}</div> : <div className="dashboard-empty dashboard-activity-empty"><span>{ledger.length === 0 ? 'No linked ledger activity yet.' : 'No activity for your campaigns yet.'}</span><small>Recent activity appears when a donation or payout is saved to the public ledger.</small></div>}
        </section>
      </>}
    </main>
    <footer className="explore-footer"><a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="" /><span>Nearfund</span></a><span>Community funding with a visible trail.</span><a href="/explore">Explore campaigns <ArrowUpRight size={14} /></a></footer>
  </>;
}

function ManageCampaignPage({
  campaign,
  loading,
  error,
  accountId,
  connectingWallet,
  saving,
  claimingPayout,
  ledger,
  onConnect,
  onCliConnect,
  onOtherWallets,
  onDisconnect,
  onSave,
  onClaimPayout,
  onShare,
}: {
  campaign: Campaign | null;
  loading: boolean;
  error: string;
  accountId: string | null;
  connectingWallet: boolean;
  saving: boolean;
  claimingPayout: boolean;
  ledger: LedgerRow[];
  onConnect: () => void;
  onCliConnect: () => void;
  onOtherWallets: () => void;
  onDisconnect: () => void;
  onSave: (draft: CampaignDraft, updates: CampaignUpdate[]) => Promise<void>;
  onClaimPayout: () => void;
  onShare: (message: string) => void;
}) {
  const [draft, setDraft] = useState<CampaignDraft>(() => campaign ? campaignToDraft(campaign) : emptyCampaignDraft());
  const [updates, setUpdates] = useState<CampaignUpdate[]>(campaign?.updates ?? []);
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateBody, setUpdateBody] = useState('');
  const [updateMedia, setUpdateMedia] = useState('');
  const [saveError, setSaveError] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [shareError, setShareError] = useState('');

  useEffect(() => {
    if (!campaign) return;
    setDraft(campaignToDraft(campaign));
    setUpdates(campaign.updates);
  }, [campaign?.id]);

  const canEdit = Boolean(campaign && accountId === campaign.organizer && campaign.databaseId);
  const canClaimPayout = Boolean(
    campaign
    && accountId === campaign.treasury
    && campaign.status === 'successful'
    && campaign.payoutState !== 'paid',
  );
  const donations = ledger.filter((row) => row.record_type === 'donation');
  const payouts = ledger.filter((row) => row.record_type === 'milestone_payout');

  const saveMetadata = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError('');
    if (!canEdit) {
      setSaveError('Connect the campaign creator wallet to edit this campaign.');
      return;
    }
    if (draft.title.trim().length < 2 || !draft.category.trim()) {
      setSaveError('Enter a campaign title with at least two characters and a category.');
      return;
    }
    if (draft.summary.length > 140) {
      setSaveError('The campaign summary must be 140 characters or fewer.');
      return;
    }
    if ([draft.coverUrl, draft.verificationUrl].some((url) => url && !/^https:\/\//i.test(url))) {
      setSaveError('Cover and verification links must use HTTPS.');
      return;
    }
    try {
      await onSave(draft, updates);
      onShare('Campaign story and display details saved.');
    } catch (failure) {
      setSaveError(errorMessage(failure));
    }
  };

  const addUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUpdateError('');
    if (!canEdit) {
      setUpdateError('Connect the campaign creator wallet to post an update.');
      return;
    }
    const title = updateTitle.trim();
    const body = updateBody.trim();
    const mediaUrl = updateMedia.trim();
    if (!title || !body) {
      setUpdateError('Add a title and an update message.');
      return;
    }
    if (mediaUrl && !/^https:\/\//i.test(mediaUrl)) {
      setUpdateError('Update media links must use HTTPS.');
      return;
    }
    const nextUpdates = [{
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`,
      title,
      body,
      mediaUrl,
      createdAt: new Date().toISOString(),
    }, ...updates];
    try {
      await onSave(draft, nextUpdates);
      setUpdates(nextUpdates);
      setUpdateTitle('');
      setUpdateBody('');
      setUpdateMedia('');
      onShare('Campaign update published.');
    } catch (failure) {
      setUpdateError(errorMessage(failure));
    }
  };

  const shareCampaign = async () => {
    if (!campaign) return;
    setShareError('');
    const url = new URL(`/campaign/${encodeURIComponent(campaign.id)}`, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      onShare('Campaign link copied to clipboard.');
    } catch (failure) {
      setShareError(errorMessage(failure));
    }
  };

  const exportDonations = () => {
    if (!campaign || donations.length === 0) return;
    const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ['created_at', 'donor_account', 'amount', 'asset', 'transaction_hash'],
      ...donations.map((row) => [
        row.created_at,
        row.donations?.[0]?.is_anonymous ? 'Anonymous on Nearfund' : row.account,
        row.amount,
        row.asset,
        row.transaction_hash ?? '',
      ]),
    ];
    const csv = rows.map((row) => row.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nearfund-campaign-${campaign.id}-donations.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <>
    <header className="topbar dashboard-topbar">
      <a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="Nearfund" /><span>Nearfund</span></a>
      <nav><a href="/explore">Explore</a><a href="/dashboard">Dashboard</a><a href="/profile">Profile</a><a href="/#how">How it works</a><a href="/#ledger">Public ledger</a></nav>
      <div className="top-actions">
        {accountId
          ? <div className="wallet-options"><span className="wallet-account">{accountId}</span><button className="wallet-alt-button" onClick={onDisconnect} disabled={connectingWallet}>Disconnect</button></div>
          : <div className="wallet-options"><WalletConnectionButtons connectingWallet={connectingWallet} onConnect={onConnect} onCliConnect={onCliConnect} onOtherWallets={onOtherWallets} /></div>}
      </div>
    </header>
    <main className="manage-page">
      <a className="manage-back" href="/dashboard">← Back to dashboard</a>
      {error && <p className="dashboard-notice" role="status">{error}</p>}
      {loading && !campaign
        ? <section className="manage-empty"><span className="pulse" /><strong>Loading campaign from NEAR…</strong></section>
        : !campaign
          ? <section className="manage-empty"><span className="eyebrow">CAMPAIGN NOT FOUND</span><h1>&gt;_ campaign.missing</h1><p>This campaign is not available from the configured NEAR contract.</p><a className="primary-button" href="/dashboard">Return to dashboard <ArrowUpRight size={15} /></a></section>
          : <>
            <section className="manage-heading">
              <div><span className="eyebrow">NEARFUND / CAMPAIGN MANAGER · #{campaign.id}</span><h1>&gt;_ campaign.manage</h1><p>NEAR is authoritative for funds, deadlines and payout status. Campaign story and updates are saved as Supabase display metadata.</p></div>
              <div className="manage-heading-actions"><a className="dashboard-secondary-action" href={`/campaign/${encodeURIComponent(campaign.id)}`}>View public page <ArrowUpRight size={14} /></a><button className="dashboard-secondary-action" onClick={() => void shareCampaign()}>Share <Copy size={14} /></button></div>
            </section>
            {shareError && <p className="manage-error" role="alert">{shareError}</p>}
            <section className="manage-overview" aria-label="On-chain campaign status">
              <div><span className="eyebrow">STATUS</span><strong className="manage-status">{campaign.status}</strong></div>
              <div><span className="eyebrow">RAISED / GOAL</span><strong>{campaign.raised.toLocaleString()} / {campaign.goal.toLocaleString()} <small>NEAR</small></strong></div>
              <div><span className="eyebrow">DEADLINE</span><strong>{new Date(campaign.deadline).toLocaleDateString()}</strong></div>
              <div><span className="eyebrow">PAYOUT</span><strong>{campaign.payoutState}</strong></div>
            </section>
            {!accountId && <section className="manage-notice"><strong>Connect a NEAR wallet to manage this campaign.</strong><span>Editing is limited in the interface to the creator wallet; payout claims are limited to the beneficiary wallet.</span></section>}
            {accountId && accountId !== campaign.organizer && accountId !== campaign.treasury && <section className="manage-notice"><strong>This wallet is not the creator or beneficiary.</strong><span>You can still review the public campaign activity and ledger.</span></section>}
            {accountId === campaign.organizer && !campaign.databaseId && <section className="manage-notice"><strong>Campaign display metadata is not linked.</strong><span>The on-chain campaign is safe, but story edits and updates cannot be saved because its Supabase record is missing.</span></section>}
            <div className="manage-grid">
              <section className="manage-card">
                <div className="manage-card-heading"><div><span className="eyebrow">01 / CAMPAIGN STORY</span><h2>Edit display details</h2></div></div>
                <form className="manage-form" onSubmit={(event) => void saveMetadata(event)}>
                  <label>Campaign title<input value={draft.title} maxLength={100} disabled={!canEdit || saving} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                  <div className="manage-form-row">
                    <label>Category<input value={draft.category} maxLength={60} disabled={!canEdit || saving} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
                    <label>Region<input value={draft.region} maxLength={100} disabled={!canEdit || saving} onChange={(event) => setDraft({ ...draft, region: event.target.value })} /></label>
                  </div>
                  <label>Short summary <small>{draft.summary.length}/140</small><textarea rows={2} maxLength={140} disabled={!canEdit || saving} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
                  <label>Campaign story<textarea rows={8} disabled={!canEdit || saving} value={draft.story} onChange={(event) => setDraft({ ...draft, story: event.target.value })} /></label>
                  <label>Cover image URL<input type="url" placeholder="https://" disabled={!canEdit || saving} value={draft.coverUrl} onChange={(event) => setDraft({ ...draft, coverUrl: event.target.value })} /></label>
                  <label>Verification link<input type="url" placeholder="https://" disabled={!canEdit || saving} value={draft.verificationUrl} onChange={(event) => setDraft({ ...draft, verificationUrl: event.target.value })} /></label>
                  {saveError && <p className="manage-error" role="alert">{saveError}</p>}
                  <button className="primary-button" disabled={!canEdit || saving}>{saving ? 'Saving…' : 'Save campaign details'} <Check size={15} /></button>
                </form>
                {!canEdit && <p className="manage-helper">Only the connected creator wallet can edit campaign display details.</p>}
              </section>
              <div className="manage-side">
                <section className="manage-card">
                  <div className="manage-card-heading"><div><span className="eyebrow">02 / UPDATES</span><h2>Share progress</h2></div></div>
                  <form className="manage-form" onSubmit={(event) => void addUpdate(event)}>
                    <label>Update title<input value={updateTitle} maxLength={100} disabled={!canEdit || saving} onChange={(event) => setUpdateTitle(event.target.value)} /></label>
                    <label>Message<textarea rows={4} maxLength={2000} disabled={!canEdit || saving} value={updateBody} onChange={(event) => setUpdateBody(event.target.value)} /></label>
                    <label>Optional media link<input type="url" placeholder="https://" disabled={!canEdit || saving} value={updateMedia} onChange={(event) => setUpdateMedia(event.target.value)} /></label>
                    {updateError && <p className="manage-error" role="alert">{updateError}</p>}
                    <button className="dashboard-secondary-action" disabled={!canEdit || saving}>{saving ? 'Publishing…' : 'Post campaign update'} <ArrowUpRight size={14} /></button>
                  </form>
                  <div className="manage-updates">
                    {updates.length > 0 ? updates.map((update) => <article key={update.id}>
                      <span className="eyebrow">{new Date(update.createdAt).toLocaleDateString()}</span><h3>{update.title}</h3><p>{update.body}</p>
                      {update.mediaUrl && <a href={update.mediaUrl} target="_blank" rel="noreferrer">View update media <ExternalLink size={12} /></a>}
                    </article>) : <p className="manage-helper">No updates have been posted yet.</p>}
                  </div>
                </section>
                <section className="manage-card manage-trust-card">
                  <span className="eyebrow">03 / MILESTONES & CO-SIGNERS</span><h2>Not enforced by this contract</h2>
                  <p>The deployed campaign contract has no milestone-release or co-signer approval methods. This interface will not present a plan as if it controls the funds. Payout rules remain the contract’s goal, deadline and beneficiary.</p>
                </section>
              </div>
            </div>
            <section className="manage-card manage-ledger-card">
              <div className="manage-card-heading"><div><span className="eyebrow">04 / PUBLIC RECORD</span><h2>Campaign activity</h2></div><button className="dashboard-secondary-action" onClick={exportDonations} disabled={donations.length === 0}>Export donations CSV <ArrowUpRight size={14} /></button></div>
              <p className="manage-helper">Donation and payout records below are Supabase display records, not an on-chain event indexer. Verify each transaction on NEAR.</p>
              {ledger.length > 0 ? <div className="manage-ledger">
                {ledger.map((row) => <article key={row.id}>
                  <span className={`ledger-icon ${row.record_type === 'donation' ? 'donation' : 'milestone'}`}>{row.record_type === 'donation' ? '+' : '−'}</span>
                  <span><strong>{row.record_type === 'donation' ? 'Donation' : 'Payout'}</strong><small>{row.record_type === 'donation' && row.donations?.[0]?.is_anonymous ? 'Anonymous on Nearfund' : row.account} · {new Date(row.created_at).toLocaleString()}</small></span>
                  <strong>{row.amount.toLocaleString()} {row.asset}</strong>
                  {row.transaction_hash && <a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(row.transaction_hash)}`} target="_blank" rel="noreferrer" aria-label="View NEAR transaction"><ExternalLink size={14} /></a>}
                </article>)}
              </div> : <div className="manage-ledger-empty">No saved donation or payout records are linked to this campaign yet.</div>}
              {canClaimPayout && <div className="manage-payout-action"><p>The campaign reached its goal. The beneficiary wallet can claim the contract payout.</p><button className="primary-button" onClick={onClaimPayout} disabled={claimingPayout || campaign.payoutState === 'pending'}>{claimingPayout ? 'Submitting…' : 'Claim campaign payout'} <ArrowUpRight size={15} /></button></div>}
              {campaign.payoutState === 'paid' && <p className="manage-paid"><Check size={15} /> The contract reports this campaign payout as paid.</p>}
            </section>
          </>}
    </main>
    <footer className="explore-footer"><a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="" /><span>Nearfund</span></a><span>Community funding with a visible trail.</span><a href="/explore">Explore campaigns <ArrowUpRight size={14} /></a></footer>
  </>;
}

function DonorProfilePage({
  accountId,
  connectingWallet,
  donations,
  loading,
  error,
  campaigns,
  campaignsLoading,
  savedCampaignIds,
  savedError,
  onConnect,
  onCliConnect,
  onOtherWallets,
  onDisconnect,
  onToggleSave,
}: {
  accountId: string | null;
  connectingWallet: boolean;
  donations: ProfileDonation[];
  loading: boolean;
  error: string;
  campaigns: Campaign[];
  campaignsLoading: boolean;
  savedCampaignIds: string[];
  savedError: string;
  onConnect: () => void;
  onCliConnect: () => void;
  onOtherWallets: () => void;
  onDisconnect: () => void;
  onToggleSave: (campaignId: string) => void;
}) {
  const completedDonations = donations.filter((donation) => donation.status === 'completed');
  const totalsByAsset = completedDonations.reduce<Record<string, number>>((totals, donation) => {
    const asset = donation.settled_asset || donation.input_asset;
    const amount = donation.settled_amount ?? donation.input_amount;
    totals[asset] = (totals[asset] ?? 0) + Number(amount);
    return totals;
  }, {});
  const supportedCampaignCount = new Set(completedDonations.map((donation) => donation.campaign_id)).size;
  const savedCampaigns = savedCampaignIds
    .map((id) => campaigns.find((campaign) => campaign.id === id))
    .filter((campaign): campaign is Campaign => Boolean(campaign));
  const unavailableSavedCount = savedCampaignIds.length - savedCampaigns.length;

  return <>
    <header className="topbar dashboard-topbar">
      <a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="Nearfund" /><span>Nearfund</span></a>
      <nav><a href="/explore">Explore</a><a href="/dashboard">Dashboard</a><a className="nav-active" href="/profile">Profile</a><a href="/#how">How it works</a></nav>
      <div className="top-actions">
        {accountId
          ? <div className="wallet-options"><span className="wallet-account">{accountId}</span><button className="wallet-alt-button" onClick={onDisconnect} disabled={connectingWallet}>Disconnect</button></div>
          : <div className="wallet-options"><WalletConnectionButtons connectingWallet={connectingWallet} onConnect={onConnect} onCliConnect={onCliConnect} onOtherWallets={onOtherWallets} /></div>}
      </div>
    </header>
    <main className="profile-page">
      <section className="profile-heading">
        <div><span className="eyebrow">NEARFUND / DONOR SPACE</span><h1><span className="terminal-prompt">&gt;_ profile</span><br />Your generosity, in view.</h1><p>Review saved Nearfund receipts and revisit causes you have bookmarked.</p></div>
        {accountId && <div className="profile-account"><span className="pulse" />CONNECTED / <strong>{accountId}</strong></div>}
      </section>
      {error && <p className="dashboard-notice" role="status">{error}</p>}
      {savedError && <p className="dashboard-notice" role="alert">{savedError}</p>}
      {!accountId
        ? <section className="dashboard-connect">
          <span className="eyebrow">WALLET REQUIRED</span>
          <h2>Connect the NEAR wallet you use to give.</h2>
          <p>Donation receipts are matched to the connected account. Saved causes are stored in this browser for that wallet.</p>
          <div className="wallet-options"><WalletConnectionButtons connectingWallet={connectingWallet} onConnect={onConnect} onCliConnect={onCliConnect} onOtherWallets={onOtherWallets} /></div>
        </section>
        : <>
          <section className="profile-stats" aria-label="Giving summary">
            <article><span className="eyebrow">CONFIRMED GIFTS</span><strong>{loading ? 'SYNCING' : completedDonations.length}</strong><span>Nearfund receipt records</span></article>
            <article><span className="eyebrow">CAUSES SUPPORTED</span><strong>{loading ? '—' : supportedCampaignCount}</strong><span>Unique campaigns with saved receipts</span></article>
            <article><span className="eyebrow">TOTAL BY ASSET</span><strong>{loading ? 'SYNCING' : Object.keys(totalsByAsset).length ? Object.entries(totalsByAsset).map(([asset, amount]) => `${amount.toLocaleString()} ${asset}`).join(' · ') : '—'}</strong><span>Completed Nearfund records only</span></article>
          </section>
          <section className="profile-section">
            <div className="dashboard-section-heading"><div><span className="eyebrow">01 / YOUR GIVING</span><h2>&gt;_ donation.receipts</h2></div><a className="text-button" href="/explore">Find a cause <ArrowUpRight size={14} /></a></div>
            <p className="profile-data-note">Receipts are Nearfund display records saved after donations; they are not a complete on-chain transaction index. Verify linked transactions on NEAR.</p>
            {loading
              ? <div className="dashboard-empty"><span className="pulse" /><strong>Loading donation receipts…</strong></div>
              : donations.length > 0
                ? <div className="profile-receipt-list">{donations.map((donation) => {
                  const campaign = profileCampaign(donation);
                  const campaignId = campaign?.contract_campaign_id;
                  const transactionHash = profileTransactionHash(donation);
                  const asset = donation.settled_asset || donation.input_asset;
                  const amount = donation.settled_amount ?? donation.input_amount;
                  return <article className="profile-receipt" key={donation.id}>
                    <span className={`ledger-icon ${donation.status === 'completed' ? 'donation' : 'milestone'}`}>{donation.status === 'completed' ? '+' : '·'}</span>
                    <span className="profile-receipt-main">
                      <strong>{campaign?.title ?? 'Nearfund campaign'}</strong>
                      <small>{new Date(donation.completed_at ?? donation.created_at).toLocaleString()} · {donation.status}</small>
                      {donation.status !== 'completed' && <small className="profile-receipt-state">This receipt record is not marked completed.</small>}
                    </span>
                    <strong className="profile-receipt-amount">{Number(amount).toLocaleString()} {asset}</strong>
                    {transactionHash
                      ? <a className="profile-receipt-link" href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(transactionHash)}`} target="_blank" rel="noreferrer" aria-label="View NEAR transaction"><ExternalLink size={15} /><span>Receipt</span></a>
                      : <span className="profile-receipt-missing">No transaction link</span>}
                    {campaignId && <a className="profile-receipt-campaign" href={`/campaign/${encodeURIComponent(campaignId)}`}>Campaign <ArrowUpRight size={13} /></a>}
                  </article>;
                })}</div>
                : <div className="dashboard-empty"><strong>{error ? 'Donation history is unavailable.' : 'No Nearfund receipts found for this wallet.'}</strong><span>{error ? 'Resolve the data issue above and reload this page.' : 'Only receipts saved by Nearfund appear here. Your NEAR activity may include gifts made outside this app.'}</span><a className="primary-button" href="/explore">Explore campaigns <ArrowUpRight size={15} /></a></div>}
          </section>
          <section className="profile-section">
            <div className="dashboard-section-heading"><div><span className="eyebrow">02 / BOOKMARKS</span><h2>&gt;_ saved.causes</h2></div><a className="text-button" href="/explore">Explore more <ArrowUpRight size={14} /></a></div>
            <p className="profile-data-note">Saved causes are stored locally in this browser and scoped to this NEAR account. They are not synced across devices.</p>
            {campaignsLoading && savedCampaignIds.length > 0
              ? <div className="dashboard-empty"><span className="pulse" /><strong>Loading saved campaigns…</strong></div>
              : savedCampaigns.length > 0
                ? <div className="profile-saved-grid">{savedCampaigns.map((campaign) => {
                  const progress = campaign.goal > 0 ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100)) : 0;
                  return <article className="profile-saved-card" key={campaign.id}>
                    <div className="profile-saved-card-top"><span className="status-pill"><span />{campaign.status}</span><button className="profile-unsave" onClick={() => onToggleSave(campaign.id)} aria-label={`Remove ${campaign.title} from saved causes`}><Bookmark size={15} fill="currentColor" /> Saved</button></div>
                    <a className="profile-saved-title" href={`/campaign/${encodeURIComponent(campaign.id)}`}>{campaign.title}</a>
                    <span className="detail-category">{campaign.category} · #{campaign.id}</span>
                    <div className="progress-label"><strong>{campaign.raised.toLocaleString()} NEAR</strong><span>{progress}%</span></div>
                    <div className="progress"><span style={{ width: `${progress}%` }} /></div>
                    <a className="dashboard-secondary-action" href={`/campaign/${encodeURIComponent(campaign.id)}`}>View campaign <ArrowUpRight size={14} /></a>
                  </article>;
                })}</div>
                : <div className="dashboard-empty"><strong>No causes saved yet.</strong><span>Bookmark campaigns in Explore or on their public pages to keep them here.</span><a className="primary-button" href="/explore">Browse causes <ArrowUpRight size={15} /></a></div>}
            {unavailableSavedCount > 0 && <p className="profile-data-note">{unavailableSavedCount} saved {unavailableSavedCount === 1 ? 'campaign is' : 'campaigns are'} not currently available from the configured NEAR contract.</p>}
          </section>
        </>}
    </main>
    <footer className="explore-footer"><a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="" /><span>Nearfund</span></a><span>Community funding with a visible trail.</span><a href="/explore">Explore campaigns <ArrowUpRight size={14} /></a></footer>
  </>;
}

function InfoPage({
  page,
  accountId,
  connectingWallet,
  toast,
  onConnect,
  onCliConnect,
  onOtherWallets,
  onDisconnect,
}: {
  page: 'how-it-works' | 'about';
  accountId: string | null;
  connectingWallet: boolean;
  toast: string;
  onConnect: () => void;
  onCliConnect: () => void;
  onOtherWallets: () => void;
  onDisconnect: () => void;
}) {
  const isHowItWorks = page === 'how-it-works';

  return <>
    <header className="topbar info-topbar">
      <a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="Nearfund" /><span>Nearfund</span></a>
      <nav><a href="/explore">Explore</a><a href="/dashboard">Dashboard</a><a href="/profile">Profile</a><a className={isHowItWorks ? 'nav-active' : ''} href="/how-it-works">How it works</a><a className={!isHowItWorks ? 'nav-active' : ''} href="/about">About</a></nav>
      <div className="top-actions">
        {accountId
          ? <div className="wallet-options"><span className="wallet-account">{accountId}</span><button className="wallet-alt-button" onClick={onDisconnect} disabled={connectingWallet}>Disconnect</button></div>
          : <div className="wallet-options"><WalletConnectionButtons connectingWallet={connectingWallet} onConnect={onConnect} onCliConnect={onCliConnect} onOtherWallets={onOtherWallets} /></div>}
      </div>
    </header>
    <main className="info-page">
      <section className="info-hero">
        <div className="eyebrow"><span className="pulse" /> NEARFUND / {isHowItWorks ? 'THE PROCESS' : 'OUR MISSION'}</div>
        <div className="info-hero-grid">
          <div>
            <p className="info-terminal">&gt;_ {isHowItWorks ? 'giving.protocol' : 'nearfund.about'}</p>
            <h1>{isHowItWorks ? <>A clear path<br /><em>from gift to impact.</em></> : <>Generosity<br /><em>without borders.</em></>}</h1>
            <p className="info-intro">{isHowItWorks
              ? 'Nearfund connects community campaigns with supporters through a simple flow, while NEAR provides the public record and contract rules.'
              : 'Nearfund is a community fundraising platform built to make it easier to launch a cause, give across borders and follow how funds move.'}</p>
            <div className="info-hero-actions">
              <a className="primary-button" href={isHowItWorks ? '/explore' : '/campaign/new'}>{isHowItWorks ? 'Explore campaigns' : 'Start a campaign'} <ArrowUpRight size={16} /></a>
              <a className="info-text-link" href={isHowItWorks ? '/about' : '/how-it-works'}>{isHowItWorks ? 'About Nearfund' : 'How it works'} <ChevronRight size={15} /></a>
            </div>
          </div>
          <div className="info-hero-art" aria-hidden="true">
            <span className="info-art-label">A PUBLIC PATH</span>
            <div className="info-flow-step"><span>01</span><strong>CAUSE</strong><small>Story and goal</small></div>
            <div className="info-flow-line" />
            <div className="info-flow-step accent"><span>02</span><strong>GIFT</strong><small>NEAR testnet</small></div>
            <div className="info-flow-line" />
            <div className="info-flow-step"><span>03</span><strong>PROOF</strong><small>Contract record</small></div>
          </div>
        </div>
      </section>
      {isHowItWorks ? <>
        <section className="info-section">
          <div className="info-section-heading"><span className="eyebrow">01 / THREE STEPS</span><h2>&gt;_ how.giving.works</h2><p>One focused flow for organizers and supporters. The contract, not the page, decides campaign funding status.</p></div>
          <div className="info-steps">
            <article><span className="info-step-index">01 / CREATE</span><h3>Publish the cause</h3><p>A creator connects a NEAR testnet wallet, sets a goal, deadline, category and beneficiary, then confirms campaign creation in the wallet.</p><small>The campaign terms are stored on the NEAR contract. Story, cover and other presentation details are optional Supabase metadata.</small><a href="/campaign/new">Create a campaign <ArrowUpRight size={14} /></a></article>
            <article><span className="info-step-index">02 / GIVE</span><h3>Support the campaign</h3><p>A donor opens a campaign, chooses an amount in NEAR and approves the transaction in a compatible testnet wallet.</p><small>For this prototype, donations settle in native NEAR on testnet. The donor needs NEAR for the gift and any required storage deposit.</small><a href="/explore">Explore causes <ArrowUpRight size={14} /></a></article>
            <article><span className="info-step-index">03 / VERIFY</span><h3>Follow the record</h3><p>NEAR records the donation and enforces the goal and deadline rules. Nearfund may also save a readable receipt and message for its pages.</p><small>Saved app receipts are not a complete chain index. Use the transaction link to verify the transaction on NEAR.</small><a href="/#ledger">View public ledger <ArrowUpRight size={14} /></a></article>
          </div>
        </section>
        <section className="info-outcome">
          <div><span className="eyebrow">02 / AFTER THE DEADLINE</span><h2>Outcome follows the contract.</h2><p>If a campaign reaches its goal, the beneficiary can claim the payout according to contract rules. If it does not, eligible contributors can claim refunds. The interface does not override those conditions.</p></div>
          <div className="info-outcome-rules"><article><Check size={17} /><span><strong>Goal reached</strong><small>Campaign is successful; beneficiary payout becomes eligible under contract rules.</small></span></article><article><X size={17} /><span><strong>Goal not reached</strong><small>Campaign fails; donors can claim eligible refunds from the contract.</small></span></article></div>
        </section>
        <section className="info-section info-fees">
          <div className="info-section-heading"><span className="eyebrow">03 / COSTS & TRUST</span><h2>&gt;_ transparent.by.design</h2></div>
          <div className="info-fee-grid"><article><span className="eyebrow">PLATFORM FEE</span><strong>No platform fee in this prototype</strong><p>Nearfund currently takes no campaign payout fee. This is not a promise about future product pricing.</p></article><article><span className="eyebrow">NETWORK COST</span><strong>NEAR testnet transaction costs</strong><p>Wallets may require NEAR for transaction gas and contract storage. Gas sponsorship, where configured and compatible, does not cover the donation or storage deposit.</p></article><article><span className="eyebrow">PUBLIC RECORD</span><strong>Wallet activity is public</strong><p>Choosing anonymous display hides the donor account only on Nearfund donor displays; the NEAR transaction and wallet remain publicly visible.</p></article></div>
        </section>
        <section className="info-section info-faq">
          <div className="info-section-heading"><span className="eyebrow">04 / FAQ</span><h2>&gt;_ common.questions</h2></div>
          <div className="info-faq-list">
            <details><summary>Can I donate with another chain or token?</summary><p>Not in the current testnet prototype. Native NEAR is the supported donation asset. NEAR Intents cross-chain settlement is planned but is not available in this flow.</p></details>
            <details><summary>Do I need a NEAR wallet?</summary><p>Yes. The current donation flow requires a compatible NEAR testnet wallet and enough testnet NEAR for the gift and any required storage deposit. Social sign-in and guest checkout are not enabled.</p></details>
            <details><summary>Are milestones and co-signers available?</summary><p>No. The deployed campaign contract does not enforce milestone releases or co-signer approval. Payout eligibility follows the contract’s goal, deadline and beneficiary rules.</p></details>
            <details><summary>What does an anonymous donation mean?</summary><p>It hides the donor account on Nearfund’s donor-facing display only. It does not hide the wallet or transaction on the public NEAR network.</p></details>
          </div>
        </section>
      </> : <>
        <section className="info-section info-mission">
          <div className="info-section-heading"><span className="eyebrow">01 / WHY NEARFUND</span><h2>&gt;_ generosity.has.no.borders</h2></div>
          <div className="info-mission-copy"><p>Good causes are everywhere; access to funding is not. Community organizers can struggle to reach supporters across geography, payment systems and currencies. Donors, in turn, want a clearer way to understand where support goes.</p><p>Nearfund is being built around a simple idea: make causes easier to share, make giving easier to follow, and let public infrastructure provide evidence of money movement.</p></div>
        </section>
        <section className="info-section">
          <div className="info-section-heading"><span className="eyebrow">02 / WHO IT SERVES</span><h2>&gt;_ built.for.people</h2></div>
          <div className="info-audience-grid"><article><span className="eyebrow">FOR ORGANIZERS</span><h3>Make a cause visible.</h3><p>Individuals, community groups, student teams and grassroots organizations can publish a campaign with a goal, a deadline and a shareable story.</p><a href="/campaign/new">Launch a campaign <ArrowUpRight size={14} /></a></article><article><span className="eyebrow">FOR SUPPORTERS</span><h3>Give with a clearer trail.</h3><p>Supporters can discover campaigns, donate with a NEAR testnet wallet and revisit Nearfund receipts and saved causes in their profile.</p><a href="/explore">Find a cause <ArrowUpRight size={14} /></a></article></div>
        </section>
        <section className="info-section">
          <div className="info-section-heading"><span className="eyebrow">03 / PRODUCT PRINCIPLES</span><h2>&gt;_ trust.is.a.feature</h2></div>
          <div className="info-principles"><article><ShieldCheck size={19} /><div><strong>Rules you can inspect</strong><p>The NEAR campaign contract is authoritative for campaign funds and status. Nearfund’s display database does not control escrow or payout eligibility.</p></div></article><article><CircleDollarSign size={19} /><div><strong>Plain about the prototype</strong><p>The current build is a testnet prototype. Cross-chain Intents, social sign-in, milestone approvals and co-signer controls are planned, not live.</p></div></article><article><Users size={19} /><div><strong>Designed for real communities</strong><p>Campaigns can represent personal needs, local projects and community causes; the interface aims to keep wallet and contract details understandable.</p></div></article></div>
        </section>
        <section className="info-roadmap"><span className="eyebrow">04 / WHAT’S NEXT</span><h2>Build the rails, then widen the reach.</h2><p>The roadmap includes verified cross-chain settlement, better indexed public receipts, gasless giving and community-controlled payout options. Each will be labeled available only when it is implemented and verifiable.</p><div><a className="primary-button" href="/how-it-works">See how it works <ArrowUpRight size={15} /></a><a className="info-text-link" href="/explore">Explore the prototype <ChevronRight size={15} /></a></div></section>
      </>}
    </main>
    <footer className="explore-footer"><a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="" /><span>Nearfund</span></a><span>Community funding with a visible trail.</span><span className="info-footer-links"><a href="/how-it-works">How it works</a><a href="/about">About Nearfund</a><a href="/explore">Explore campaigns</a></span></footer>
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </>;
}

function DonationModal({
  campaign,
  canSponsorGas,
  submitting,
  receipt,
  onSubmit,
  onClose,
  onShare,
}: {
  campaign: Campaign;
  canSponsorGas: boolean;
  submitting: boolean;
  receipt: DonationReceipt | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onShare: (message: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [shareError, setShareError] = useState('');
  const presets = ['0.1', '0.5', '1', '5'];

  const shareCampaign = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: campaign.title, text: `I supported ${campaign.title} on Nearfund.`, url });
      } else {
        await navigator.clipboard.writeText(url);
        onShare('Campaign link copied to clipboard.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareError(errorMessage(error));
    }
  };

  return <Modal title={receipt ? 'Gift confirmed' : `Support ${campaign.title}`} close={onClose}>
    {receipt ? <div className="donation-success">
      <div className="donation-success-mark"><Check size={30} /></div>
      <span className="eyebrow">NEAR TESTNET / CONFIRMED</span>
      <h3>Your generosity moved this cause forward.</h3>
      <p className="donation-success-amount">{receipt.amount.toLocaleString()} <span>NEAR</span></p>
      <p className="donation-success-copy">Your donation was submitted to the campaign contract. Its transaction is publicly verifiable.</p>
      <a className="donation-transaction-link" href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(receipt.transactionHash)}`} target="_blank" rel="noreferrer">
        View NEAR transaction <ExternalLink size={14} />
      </a>
      {receipt.metadataWarning && <p className="donation-metadata-warning">The donation is on-chain, but the Nearfund receipt or message could not be saved: {receipt.metadataWarning}</p>}
      <div className="donation-success-actions">
        <button className="primary-button" onClick={onClose}>Done <Check size={16} /></button>
        <button className="text-button" onClick={() => void shareCampaign()}>Share campaign <ArrowUpRight size={15} /></button>
      </div>
      {shareError && <p className="donation-form-error" role="alert">{shareError}</p>}
    </div> : <form onSubmit={onSubmit}>
      <div className="donate-note">Your NEAR donation is held by the campaign contract until payout rules are met. Gas sponsorship pays transaction fees only; you still need NEAR for your donation and any first-time storage deposit.</div>
      <fieldset className="donation-presets">
        <legend>Choose an amount <span>NEAR</span></legend>
        <div>{presets.map((preset) => (
          <button key={preset} type="button" className={amount === preset ? 'active' : ''} onClick={() => setAmount(preset)}>{preset}</button>
        ))}</div>
      </fieldset>
      <label>Custom amount (NEAR)<input required name="amount" type="number" min="0.000001" step="0.000001" placeholder="Enter amount" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>Message to the organizer <span className="donation-optional">OPTIONAL</span><textarea name="message" rows={3} maxLength={280} placeholder="Leave a short note of support (280 characters max)" /></label>
      <label className="donation-checkbox"><input type="checkbox" name="anonymous" /><span>Hide my name on the campaign donor wall</span></label>
      <p className="donation-privacy-note">This only hides your account on Nearfund’s donor wall. Your wallet and transaction amount remain publicly visible on NEAR and in the public ledger.</p>
      <label>Transaction gas
        <select name="gas" defaultValue="wallet">
          <option value="wallet">Pay gas with my wallet</option>
          <option value="sponsored" disabled={!canSponsorGas}>
            Sponsor gas with Nearfund {!canSponsorGas ? '(connect a compatible testnet wallet)' : ''}
          </option>
        </select>
      </label>
      <button className="primary-button full donation-submit" disabled={submitting}>
        {submitting ? 'Confirming on NEAR…' : 'Confirm donation'} <Wallet size={17} />
      </button>
      <p className="donation-footnote">Messages and donor-wall preferences are Nearfund display data; only the NEAR transfer is written to the contract.</p>
    </form>}
  </Modal>;
}

function CampaignPage({
  campaign,
  campaignsLoading,
  error,
  ledger,
  accountId,
  connectingWallet,
  isSaved,
  onToggleSave,
  onConnect,
  onCliConnect,
  onOtherWallets,
  onDisconnect,
  onDonate,
  onShare,
}: {
  campaign: Campaign | null;
  campaignsLoading: boolean;
  error: string;
  ledger: LedgerRow[];
  accountId: string | null;
  connectingWallet: boolean;
  isSaved: boolean;
  onToggleSave: (campaignId: string) => void;
  onConnect: () => void;
  onCliConnect: () => void;
  onOtherWallets: () => void;
  onDisconnect: () => void;
  onDonate?: () => void;
  onShare: (message: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'updates' | 'ledger'>('overview');
  const donors = useMemo(() => {
    const seen = new Set<string>();
    return ledger.filter((row) => {
      if (row.record_type !== 'donation') return false;
      if (row.donations?.[0]?.is_anonymous) return true;
      if (seen.has(row.account)) return false;
      seen.add(row.account);
      return true;
    });
  }, [ledger]);
  const progress = campaign ? Math.min(100, Math.round((campaign.raised / campaign.goal) * 100)) : 0;

  const shareCampaign = async () => {
    if (!campaign) return;
    const shareData = {
      title: campaign.title,
      text: `Support ${campaign.title} on Nearfund`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        onShare('Campaign link copied to clipboard.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onShare(errorMessage(error));
    }
  };

  return <>
    <header className="topbar campaign-topbar">
      <a className="brand" href="/">
        <img className="brand-logo" src="/assets/images/mint_presentation.png" alt="Nearfund" />
        <span>Nearfund</span>
      </a>
      <nav><a href="/explore">Explore</a><a href="/dashboard">Dashboard</a><a href="/profile">Profile</a><a href="/#how">How it works</a><a href="/#ledger">Public ledger</a></nav>
      <div className="top-actions">
        {accountId
          ? <div className="wallet-options"><span className="wallet-account">{accountId}</span><button className="wallet-alt-button" onClick={onDisconnect} disabled={connectingWallet}>Disconnect</button></div>
          : <div className="wallet-options">
            <WalletConnectionButtons connectingWallet={connectingWallet} onConnect={onConnect} onCliConnect={onCliConnect} onOtherWallets={onOtherWallets} />
          </div>}
      </div>
    </header>
    <main className="campaign-page">
      <div className="campaign-breadcrumb"><a href="/">HOME</a><span>/</span><a href="/explore">CAMPAIGNS</a><span>/</span><span>{campaign ? `#${campaign.id}` : 'CAMPAIGN'}</span></div>
      {campaign ? <>
        <section className={`campaign-cover ${campaign.coverUrl ? 'has-image' : ''}`}>
          <div className="campaign-cover-grid" />
          {campaign.coverUrl && <img className="campaign-cover-image" src={campaign.coverUrl} alt="" />}
          <div className="campaign-cover-content">
            <span className="campaign-cover-kicker"><span className="pulse" /> COMMUNITY CAMPAIGN / NEAR TESTNET</span>
            <span className="campaign-cover-number" aria-hidden="true">{campaign.id.padStart(2, '0')}</span>
            <div className="campaign-cover-bottom"><span>{campaign.category}{campaign.region ? ` · ${campaign.region}` : ''}</span><span>PUBLIC FUNDING RECORD</span></div>
          </div>
        </section>
        <section className="campaign-detail-page">
          <div className="campaign-story-column">
            <div className="campaign-detail-heading">
              <span className="eyebrow">01 / THE CAUSE</span>
              <h1>{campaign.title}</h1>
              <div className="campaign-detail-subline">
                <span>Organized by <strong>{campaign.organizer}</strong></span>
                <span className="campaign-onchain-badge"><ShieldCheck size={14} /> VERIFIED ON NEAR TESTNET</span>
              </div>
            </div>
            <div className="campaign-tabs" role="tablist" aria-label="Campaign information">
              {(['overview', 'updates', 'ledger'] as const).map((tab) => (
                <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
                  {tab === 'ledger' ? 'Public ledger' : tab}
                  {tab === 'ledger' && <span>{ledger.length}</span>}
                </button>
              ))}
            </div>
            {activeTab === 'overview' && <div className="campaign-overview">
              <div className="campaign-overview-heading"><span className="eyebrow">CAMPAIGN BRIEF</span><span className="campaign-id">NEAR / #{campaign.id}</span></div>
              {campaign.summary && <p className="campaign-summary">{campaign.summary}</p>}
              <p className="campaign-description">{campaign.description || `This ${campaign.category.toLowerCase()} campaign is raising funds for its community. Contributions are recorded by the NEAR campaign contract, and its payout or refund rules are enforced on-chain after the campaign deadline.`}</p>
              {(campaign.region || campaign.beneficiaryType) && <p className="campaign-context">{campaign.region}{campaign.beneficiaryType ? `${campaign.region ? ' · ' : ''}Funds for ${campaign.beneficiaryType.toLowerCase()}` : ''}</p>}
              {campaign.suggestedMinimum && <p className="campaign-context">Suggested minimum gift: {campaign.suggestedMinimum} NEAR. This is guidance only and is not enforced by the contract.</p>}
              {campaign.verificationUrl && <a className="campaign-verification-link" href={campaign.verificationUrl} target="_blank" rel="noreferrer">Organizer verification link <ExternalLink size={13} /></a>}
              <div className="campaign-facts">
                <div><CalendarDays size={16} /><span>DEADLINE</span><strong>{new Date(campaign.deadline).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</strong></div>
                <div><Users size={16} /><span>SUPPORTERS</span><strong>{donors.length || campaign.backers}</strong></div>
                <div><ShieldCheck size={16} /><span>CONTRACT STATUS</span><strong>{campaign.status}</strong></div>
              </div>
            </div>}
            {activeTab === 'updates' && <div className="campaign-tab-empty">
              <span className="eyebrow">02 / ORGANIZER UPDATES</span>
              <strong>No updates have been posted yet.</strong>
              <p>Updates will appear here when the campaign organizer publishes them.</p>
            </div>}
            {activeTab === 'ledger' && <CampaignLedger ledger={ledger} />}
            <section className="donor-wall">
              <div className="donor-wall-heading"><div><span className="eyebrow">03 / COMMUNITY</span><h2>People backing this cause</h2></div><span>{donors.length} DONORS</span></div>
              {donors.length > 0
                ? <div className="donor-list">{donors.slice(0, 8).map((donor) => (
                  <div className="donor-entry" key={donor.id}>
                    <span className="donor-avatar">{donor.donations?.[0]?.is_anonymous ? 'A' : donor.account.slice(0, 1).toUpperCase()}</span>
                    <span className="donor-account">{donor.donations?.[0]?.is_anonymous ? 'Anonymous supporter' : donor.account}{donor.donations?.[0]?.message && <small className="donor-message">{donor.donations[0].message}</small>}</span>
                    <strong>{donor.amount.toLocaleString()} {donor.asset}</strong>
                  </div>
                ))}</div>
                : <div className="donor-empty">Be the first to support this campaign.</div>}
            </section>
          </div>
          <aside className="campaign-give-column">
            <div className="campaign-give-card">
              <div className="campaign-give-top"><span className="status-pill"><span />{campaign.status} campaign</span><div className="campaign-give-tools"><button className={`campaign-save ${isSaved ? 'saved' : ''}`} onClick={() => onToggleSave(campaign.id)} aria-label={isSaved ? 'Remove from saved causes' : 'Save cause'} aria-pressed={isSaved}><Bookmark size={15} fill={isSaved ? 'currentColor' : 'none'} /><span>{isSaved ? 'Saved' : 'Save'}</span></button><button className="campaign-share" onClick={() => void shareCampaign()} aria-label="Share campaign"><Copy size={16} /></button></div></div>
              <div className="campaign-progress-ring" style={{ '--campaign-progress': `${progress}%` } as React.CSSProperties}>
                <div><strong>{progress}%</strong><span>FUNDED</span></div>
              </div>
              <div className="campaign-raised"><strong>{campaign.raised.toLocaleString()} <span>NEAR</span></strong><small>raised of {campaign.goal.toLocaleString()} NEAR goal</small></div>
              <div className="campaign-give-progress"><div className="progress"><span style={{ width: `${progress}%` }} /></div><div className="progress-foot"><span>Goal {campaign.goal.toLocaleString()} NEAR</span><span>{Math.max(0, campaign.backers || donors.length)} supporters</span></div></div>
              <button className="primary-button full campaign-donate-button" onClick={onDonate} disabled={!onDonate || campaign.status !== 'active'}>
                {campaign.status === 'active' ? 'Donate to this campaign' : 'Campaign closed'} <ArrowUpRight size={17} />
              </button>
              <p className="campaign-give-note">Native NEAR on testnet. Your donation is recorded by the campaign contract.</p>
              <div className="campaign-trust-row"><ShieldCheck size={15} /><span>Contract-enforced goal, deadline and payouts</span></div>
            </div>
            <div className="organizer-card"><span className="eyebrow">CAMPAIGN ORGANIZER</span><div className="organizer-avatar">{campaign.organizer.slice(0, 1).toUpperCase()}</div><strong>{campaign.organizer}</strong><span>NEAR testnet account</span></div>
          </aside>
        </section>
      </> : <section className="campaign-route-empty">
        <span className="eyebrow">{campaignsLoading ? 'SYNCING WITH NEAR TESTNET' : 'CAMPAIGN NOT FOUND'}</span>
        <h1>{campaignsLoading ? 'Reading the public record…' : 'This campaign could not be found.'}</h1>
        {error && <p>{error}</p>}
        {!campaignsLoading && <a className="primary-button" href="/explore">Back to campaigns <ArrowUpRight size={16} /></a>}
      </section>}
    </main>
    <footer className="explore-footer">
      <a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="" /><span>Nearfund</span></a>
      <span>Community funding with a visible trail.</span>
      <a href="/explore">Explore campaigns <ArrowUpRight size={14} /></a>
    </footer>
  </>;
}

function CampaignLedger({ ledger }: { ledger: LedgerRow[] }) {
  return ledger.length > 0
    ? <div className="campaign-ledger" role="tabpanel">
      {ledger.map((row) => (
        <div className="campaign-ledger-row" key={row.id}>
          <span className={`ledger-icon ${row.record_type === 'donation' ? 'donation' : 'milestone'}`}>{row.record_type === 'donation' ? '+' : '−'}</span>
          <span className="campaign-ledger-main"><strong>{row.record_type === 'donation' ? 'Donation' : 'Payout'}</strong><small>{row.donations?.[0]?.is_anonymous ? 'Anonymous supporter' : row.account} · {new Date(row.created_at).toLocaleDateString()}</small></span>
          <strong>{row.amount.toLocaleString()} {row.asset}</strong>
          {row.transaction_hash && <a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(row.transaction_hash)}`} target="_blank" rel="noreferrer" aria-label="View transaction on NEAR testnet"><ExternalLink size={14} /></a>}
        </div>
      ))}
    </div>
    : <div className="campaign-tab-empty" role="tabpanel"><span className="eyebrow">ON-CHAIN ACTIVITY</span><strong>No public records yet.</strong><p>Completed campaign donations and payouts will appear here.</p></div>;
}

function ExplorePage({
  campaigns,
  loading,
  error,
  accountId,
  connectingWallet,
  savedCampaignIds,
  onToggleSave,
  onConnect,
  onCliConnect,
  onOtherWallets,
  onDisconnect,
  onDonate,
}: {
  campaigns: Campaign[];
  loading: boolean;
  error: string;
  accountId: string | null;
  connectingWallet: boolean;
  savedCampaignIds: string[];
  onToggleSave: (campaignId: string) => void;
  onConnect: () => void;
  onCliConnect: () => void;
  onOtherWallets: () => void;
  onDisconnect: () => void;
  onDonate: (campaign: Campaign) => void;
}) {
  const fixedCategories = [
    'All causes',
    'Medical',
    'Education',
    'Emergency',
    'Community',
    'Faith',
    'Creative',
    'Animals',
    'Environment',
    'Health',
    'Other',
  ];
  const dynamicCategories = [...new Set(campaigns.map((campaign) => campaign.category))]
    .filter((item) => !fixedCategories.some((known) => known.toLowerCase() === item.toLowerCase()));
  const categories = [...fixedCategories, ...dynamicCategories];
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All causes');
  const [sort, setSort] = useState<'trending' | 'ending' | 'newest'>('trending');
  const [visibleCount, setVisibleCount] = useState(6);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const filteredCampaigns = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matches = campaigns.filter((campaign) => {
      const matchesSearch = !search
        || `${campaign.title} ${campaign.category} ${campaign.organizer}`.toLowerCase().includes(search);
      return matchesSearch && (category === 'All causes' || campaign.category.toLowerCase() === category.toLowerCase());
    });

    return matches.sort((left, right) => {
      if (sort === 'ending') return left.deadline - right.deadline;
      if (sort === 'newest') return Number(right.id) - Number(left.id);
      const leftProgress = left.raised / left.goal;
      const rightProgress = right.raised / right.goal;
      return rightProgress - leftProgress || right.raised - left.raised;
    });
  }, [campaigns, category, query, sort]);

  useEffect(() => {
    setVisibleCount(6);
  }, [category, query, sort]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || visibleCount >= filteredCampaigns.length) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisibleCount((count) => Math.min(count + 6, filteredCampaigns.length));
    }, { rootMargin: '240px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredCampaigns.length, visibleCount]);

  const resultLabel = loading
    ? 'SYNCING WITH NEAR TESTNET'
    : `${filteredCampaigns.length} ${filteredCampaigns.length === 1 ? 'CAMPAIGN' : 'CAMPAIGNS'} FOUND`;

  return <>
    <header className="topbar explore-topbar">
      <a className="brand" href="/">
        <img className="brand-logo" src="/assets/images/mint_presentation.png" alt="Nearfund" />
        <span>Nearfund</span>
      </a>
      <nav><a className="nav-active" href="/explore">Explore</a><a href="/dashboard">Dashboard</a><a href="/profile">Profile</a><a href="/#how">How it works</a><a href="/#ledger">Public ledger</a></nav>
      <div className="top-actions">
        {accountId
          ? <div className="wallet-options"><span className="wallet-account">{accountId}</span><button className="wallet-alt-button" onClick={onDisconnect} disabled={connectingWallet}>Disconnect</button></div>
          : <div className="wallet-options">
            <WalletConnectionButtons connectingWallet={connectingWallet} onConnect={onConnect} onCliConnect={onCliConnect} onOtherWallets={onOtherWallets} />
          </div>}
        <a className="primary-button explore-create" href="/campaign/new">Start a campaign <ArrowUpRight size={16} /></a>
      </div>
    </header>
    <main className="explore-page">
      <div className="explore-hero">
        <div className="explore-hero-inner">
          <div className="eyebrow"><span className="pulse" /> 01 / OPEN FUNDING DIRECTORY</div>
          <div className="explore-title-row">
            <div>
              <p className="explore-terminal">&gt;_ campaigns.discover</p>
              <h1>Find a cause.<br /><em>Move it forward.</em></h1>
              <p className="explore-intro">Explore community campaigns and follow their progress on NEAR. Every campaign shown here is read from the testnet contract.</p>
            </div>
            <div className="explore-index" aria-hidden="true"><span>NEAR</span><strong>01</strong><span>TESTNET / LIVE</span></div>
          </div>
          <div className="explore-controls">
            <label className="explore-search">
              <span className="eyebrow">SEARCH CAMPAIGNS</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cause, category or organizer…" />
            </label>
            <label className="explore-sort">
              <span className="eyebrow">SORT BY</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="trending">Trending</option>
                <option value="ending">Ending soon</option>
                <option value="newest">Newest</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <section className="explore-results" aria-labelledby="explore-results-title">
        <div className="explore-results-head">
          <div><p className="eyebrow">02 / CAMPAIGNS</p><h2 id="explore-results-title">&gt;_ causes.list</h2></div>
          <span className="explore-result-count">{resultLabel}</span>
        </div>
        <div className="explore-category-list" aria-label="Filter campaigns by category">
          {categories.map((item) => (
            <button key={item} className={`explore-category ${category === item ? 'active' : ''}`} onClick={() => setCategory(item)} aria-pressed={category === item}>
              {item}<span>{item === 'All causes' ? campaigns.length : campaigns.filter((campaign) => campaign.category.toLowerCase() === item.toLowerCase()).length}</span>
            </button>
          ))}
        </div>
        {error && <p className="explore-error" role="status">{error}</p>}
        {loading && campaigns.length === 0
          ? <div className="explore-empty"><span className="pulse" /><strong>Reading campaigns from NEAR testnet…</strong></div>
          : filteredCampaigns.length > 0
            ? <>
              <div className="explore-grid">
                {filteredCampaigns.slice(0, visibleCount).map((campaign, index) => {
                  const progress = Math.min(100, Math.round((campaign.raised / campaign.goal) * 100));
                  return <article className="explore-card" key={campaign.id}>
                    <div className={`explore-card-art explore-art-${index % 4}`}>
                      <span className="explore-art-label">NEARFUND / TESTNET</span>
                      <span className="explore-art-mark" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                      <span className="explore-art-category">{campaign.category}</span>
                    </div>
                    <div className="explore-card-body">
                      <div className="explore-card-meta"><span className="status-pill"><span />{campaign.status}</span><span className="detail-category">#{campaign.id}</span></div>
                      <h3><a className="explore-card-title" href={`/campaign/${encodeURIComponent(campaign.id)}`}>{campaign.title}</a></h3>
                      <div className="explore-card-actions">
                        <a className="explore-view-link" href={`/campaign/${encodeURIComponent(campaign.id)}`}>View campaign <ArrowUpRight size={14} /></a>
                        <button className={`explore-save ${savedCampaignIds.includes(campaign.id) ? 'saved' : ''}`} onClick={() => onToggleSave(campaign.id)} aria-label={savedCampaignIds.includes(campaign.id) ? 'Remove from saved causes' : 'Save cause'} aria-pressed={savedCampaignIds.includes(campaign.id)}><Bookmark size={14} fill={savedCampaignIds.includes(campaign.id) ? 'currentColor' : 'none'} />{savedCampaignIds.includes(campaign.id) ? 'Saved' : 'Save'}</button>
                      </div>
                      <p className="explore-organizer">Organized by <strong>{campaign.organizer}</strong></p>
                      <div className="explore-card-progress">
                        <div className="progress-label"><strong>{campaign.raised.toLocaleString()} NEAR</strong><span>{progress}%</span></div>
                        <div className="progress"><span style={{ width: `${progress}%` }} /></div>
                        <div className="progress-foot"><span>of {campaign.goal.toLocaleString()} NEAR goal</span><span>{new Date(campaign.deadline).toLocaleDateString()}</span></div>
                      </div>
                      <button className="primary-button full" onClick={() => onDonate(campaign)} disabled={campaign.status !== 'active'}>
                        {campaign.status === 'active' ? 'Support this cause' : 'Campaign closed'} <ArrowUpRight size={16} />
                      </button>
                    </div>
                  </article>;
                })}
              </div>
              {visibleCount < filteredCampaigns.length && <div className="explore-load-more" ref={loadMoreRef} aria-hidden="true" />}
            </>
            : <div className="explore-empty">
              <span className="eyebrow">NO MATCHING CAMPAIGNS</span>
              <strong>{campaigns.length ? 'Try another search or category.' : loading ? 'Loading the campaigns…' : 'No campaigns are published yet.'}</strong>
              {!campaigns.length && <a className="primary-button" href="/#top">Start the first campaign <ArrowUpRight size={16} /></a>}
            </div>}
      </section>
    </main>
    <footer className="explore-footer">
      <a className="brand" href="/"><img className="brand-logo" src="/assets/images/mint_presentation.png" alt="" /><span>Nearfund</span></a>
      <span>Community funding with a visible trail.</span>
      <a href="/#top">Back to home <ArrowUpRight size={14} /></a>
    </footer>
  </>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={close}>
    <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><h3>{title}</h3><button className="icon-button" onClick={close}><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}

export default App;
