# Nearfund

Nearfund is a fundraising platform on NEAR that lets anyone create a campaign in minutes and receive donations from supporters anywhere in the world, in the token and on the chain they already use, with every naira, dollar or coin traceable onchain.

It is built to make giving more accessible, inclusive and impactful: individuals, communities and organizations raise funds for meaningful causes, and people who want to help can find, trust and fund them without borders.

**Proposal:** Nov 5, 2026 · [@obijohnbosco163](https://github.com/obijohnbosco163)

> **Prototype status:** This repository is an evolving NEAR testnet prototype. The local workspace is configured for the initialized testnet campaign contract, and its campaign read path has been verified. Native NEAR campaign flows are implemented, but write transactions still require the user's testnet wallet and approval. The testnet gas-relay endpoint is implemented but is not active until its Supabase function is deployed and its server-side secrets are configured. NEP-141 campaign tokens, cross-chain NEAR Intents, social sign-in, and mainnet payments are not enabled.

## Team

| Team member | Responsibility |
|---|---|
| Obi Johnbosco Chinonso | Wireframes, UI/UX designs, workflow illustration, logo, animation design, design lead |
|  | Proposal, tech stack, architecture diagram, pitch, frontend lead |
|  | NEAR smart contracts, database architecture, API integrations (NEAR Intents, payments), backend lead |

**Team name:** Nearfund  
**Team lead contact:** obijohnbosco163@gmail.com · 09132246153

## Problem statement

### What is the problem?

Raising money for a cause is still gated by geography. Most fundraising tools assume the organizer and donors share a country, a bank and a currency. A student in Lagos, a clinic in Kano or a community in Nairobi struggles to receive support from willing donors abroad, because cross-border payments are slow, costly and opaque, and donors cannot see where their money went.

### Who experiences this problem?

Individuals, community groups, grassroots organizations and small nonprofits that need funds for meaningful causes (medical bills, education, disaster relief, local projects), and the donors and diaspora communities who want to help them.

### Why is it important to address?

Generosity is not the scarce resource; reach and trust are. Good causes go unfunded because they cannot be found, shared easily or verified, and willing donors hold back because of high fees, delays and doubt that funds arrive.

### What are the existing limitations?

Mainstream platforms charge platform and card fees, restrict payouts by country, hold funds for days and offer no public proof of how money moves. Existing crypto fundraising tools are too technical: they demand wallet expertise, gas tokens and a single chain, which excludes the everyday giver.

## Target audience

The audience has two sides:

- **Campaign creators:** individuals, student groups, community leaders, faith groups, grassroots NGOs and small organizations aged 18 and above who need to raise money for a specific cause and have no dedicated fundraising team.
- **Donors:** friends, family, diaspora, and globally minded givers who want to give in a few taps, from any chain or token, and see proof that their gift reached the cause.

Nearfund removes borders, gas-fee confusion and doubt: creators get a shareable campaign page in minutes, and donors get a fast, transparent way to give.

## Proposed solution

Nearfund is a borderless, transparent campaign platform: creators publish a campaign page, donors give from any supported chain or token, and funds settle into a NEAR account with a public, verifiable record. The proposal separates the product into four layers:

- **Campaign Layer:** every campaign is created through a NEAR smart contract that stores its goal, deadline, category, beneficiary account and status, and that holds donations in escrow-style accounting until payout rules are met.
- **Giving Layer:** donors connect a NEAR wallet or sign in socially, then give in a few taps. NEAR Intents lets them pay from another chain or token while the campaign receives a single settlement asset (USDC or NEAR). Meta-transactions remove the need for donors to hold gas.
- **Trust Layer:** campaign donations and payouts are intended to have a public ledger. The current frontend saves donation display records to Supabase after transactions but does not run an on-chain event indexer; milestone and co-signer approval remain future features and are not enforced by the deployed contract.
- **Interactive Frontend:** a fast fundraising dashboard with an animated, terminal-inspired experience where creators launch, share and manage campaigns, and donors discover and fund them.

### Current implementation

| Area | Current state |
|---|---|
| Campaign contract | Rust / near-sdk campaign contract with campaign creation, native NEAR donations, contribution storage, deadline and goal checks, payouts and refunds. |
| Frontend | Vite + React prototype (not Next.js); the landing page includes a terminal intro and mission ticker, `/explore` provides on-chain campaign search, category filters, sorting and incremental card loading, and `/campaign/[id]` shows campaign progress, donors, a public ledger and a NEAR donation flow with a transaction receipt. |
| Creator dashboard and campaign manager | `/dashboard` lists campaigns where the account is creator or beneficiary, shows totals and saved ledger activity, and lets eligible beneficiaries claim payouts. `/dashboard/campaign/[id]` lets the connected creator wallet edit Supabase display details and post updates, export saved donations as CSV, and review ledger records; beneficiaries can claim contract-eligible payouts. NEAR remains authoritative for funds, deadlines and payout state. The creator-wallet check is a frontend UX gate, not a Supabase authorization boundary. |
| Donor profile | `/profile` shows Nearfund donation receipts for the connected donor account, linked NEAR transactions where a ledger receipt exists, and saved campaigns. Donation history is limited to display records written by Nearfund; it is not an on-chain index. Saved campaigns are stored in browser local storage per NEAR wallet and do not sync across devices. |
| Wallets | Primary quick-connect buttons use Intear Wallet and NEAR CLI through NEAR Connect; NEAR CLI presents a command for the user to run locally and verify. The separate Other wallets option retains Wallet Selector choices, including WELLDONE. Wallet availability and delegated-signing features vary. |
| Gas sponsorship | A Supabase Edge Function is included to relay only signed campaign donations. It sponsors transaction gas only; donors still provide the donation and any required storage deposit. Deploy and configure it before selecting sponsored gas. |
| Supabase data | Campaign display metadata, donation messages, donor-wall anonymity preferences and human-readable ledger records are stored off-chain. NEAR contract state remains authoritative; the current frontend writes display records after transactions rather than running a chain-event indexer. |
| NEAR Intents and social sign-in | Deferred. The current campaign deployment targets testnet, while the verified Intents settlement assets and social-login path require a separate supported network and integration. |
| Milestones, DAO co-signers and admin review | Proposal features; not enforced by the current campaign contract. |

The current testnet donation flow is not fully wallet-free: the donor must have enough testnet NEAR for the donation and, if needed, a storage deposit. Gas sponsorship covers transaction execution fees, not those attached deposits. Never describe this flow as accepting donations from a donor with no NEAR balance.

The donation form includes optional suggested amounts, a supporter message and a donor-wall display preference. The anonymous option hides the donor account on Nearfund donor displays only; the wallet and donation remain public on NEAR. Apply `supabase/migrations/20261108184500_link_campaigns_to_near_contract.sql` and `supabase/migrations/20261108232218_donation_message_anonymity.sql` to an existing Supabase project for contract-linked campaign metadata and donation display preferences. Until these migrations are applied, campaign pages use on-chain fallback titles and the public ledger cannot load those donation preferences. These fields are display metadata and are not written to the NEAR contract.

## Core user flows

1. **Create:** the creator connects a wallet, completes the campaign form and publishes the campaign to the contract.
2. **Share:** Nearfund is intended to generate a link, QR code and social cards so the campaign travels on WhatsApp, X and Telegram.
3. **Give:** a donor opens the campaign, chooses an amount and token, confirms once and sees the total update.
4. **Verify:** the intended ledger displays each donation and payout with its transaction link.
5. **Withdraw:** after the deadline, the beneficiary can receive a successful campaign payout; donors can claim refunds if the goal was not met. The current contract does not implement campaign-level milestone approval.

## Campaign creation wizard (`/campaign/new`)

The wizard uses five focused steps, a progress bar, back and continue controls, browser draft autosave and a live preview. The current contract supports native NEAR campaigns with a required deadline; USDC settlement, no-deadline campaigns, contract-enforced minimum gifts, milestones and co-signer approvals are not enabled. The title, region, beneficiary type, summary, story, cover URL and verification link are saved as versioned JSON in the existing Supabase `campaigns.description` field, while the NEAR contract remains authoritative for campaign funds and status.

| Step | Fields | Notes |
|---|---|---|
| 1. Basics | Campaign title, category, country or region, who the funds are for (myself, someone else, a group or organization) | Categories: Medical, Education, Emergency, Community, Faith, Creative, Animals, Other |
| 2. Goal | NEAR target, required end date, suggested minimum gift | Suggested minimum is display guidance only; NEAR donations are the only supported settlement asset |
| 3. Story | HTTPS cover image URL, 140-character summary, full story | Draft autosaves in the browser |
| 4. Payout and trust | Connect a NEAR wallet, beneficiary NEAR account, optional verification link | Milestones and co-signers are not enforced by the deployed contract |
| 5. Preview and publish | Campaign preview and contract summary | Wallet confirmation publishes the campaign on NEAR; story details require Supabase for persistence |

## Interface inventory

| Interface | Route | Purpose | Key elements |
|---|---|---|---|
| Landing page | `/` | Explain Nearfund and drive to start or give | Animated code-to-hero intro with skip button, scrolling ticker, stats, featured campaigns, how it works, trust section, footer |
| Explore campaigns | `/explore` | Discover causes | Search, category chips, sort (trending, ending soon, newest), campaign card grid, infinite scroll |
| Campaign page | `/campaign/[slug]` | Convert visitors to donors | On-chain campaign cover, title, progress ring and bar, NEAR donate action, donor wall, updates placeholder, public-ledger tab with explorer links, share button and organizer card |
| Donate modal | On campaign page | Give in a few taps | Amount presets, custom amount, token or chain picker, optional message, anonymous toggle, confirm and success animation |
| Create campaign | `/campaign/new` | Launch a campaign | Five-step wizard, draft autosave, live preview |
| Creator dashboard | `/dashboard` | Manage everything | Wallet-scoped campaign list, totals raised, recent saved donations, quick share, beneficiary payout action |
| Manage campaign | `/dashboard/campaign/[id]` | Run one campaign | Edit story metadata, post updates, review saved donation/payout records, export donations; milestone release and co-signer approval are explicitly unavailable in the deployed contract |
| Donor profile | `/profile` | Show giving history | Connected-wallet receipt history and transaction links, total by asset, wallet-scoped saved causes; display records are not a complete on-chain history |
| Sign in and wallet | Modal | Onboard users | NEAR wallet selector, social login option, wallet-free guest checkout where supported |
| How it works and About | `/how-it-works`, `/about` | Explain the prototype and its mission | Three-step create/give/verify flow, goal/deadline outcome rules, prototype fees and testnet requirements, FAQ, audience and roadmap; cross-chain, social sign-in, milestones and co-signers are identified as planned rather than live |
| Admin review | `/admin` | Keep the platform safe | Report queue, flag or suspend campaign, verify organizer badge |

## Design language

The interface borrows the NEAR Hackathon look: a dark base, monospaced bracket labels such as `[ 01 / CAMPAIGNS ]`, terminal-style headings like `>_ campaigns.list`, uppercase section tags, a scrolling marquee of mission lines (for example `BUILD WITHOUT BORDERS ✳ GIVE WITHOUT LIMITS ✳ MAKE YOUR SIGNAL MATTER`) and an accent colour used sparingly for progress and calls to action. Everything else stays clean and friendly so donors feel confident on a phone.

## Alignment with the NEAR Hackathon theme

NEAR Hackathon asks builders to make programmable money real: [payments, agents and money that works for real people](https://nearhackathon.com/). Nearfund fits it directly.

- **Primary track, Real-World Money:** a stablecoin giving rail for campaigns, using NEAR Intents for cross-chain settlement and meta-transactions so donors need no gas.
- **Secondary track, Social Money:** shared budgets and collective ownership on Sputnik DAO and Trezu, through optional co-signers and milestone approvals.
- **Open Innovation:** a new way for money, trust and community to work together.

The core thesis: geography should never be a barrier to generosity. Today anyone can post a cause online, but money cannot move to it freely or visibly. Nearfund uses NEAR to make the money move, and makes the movement public.

## Innovation and originality

1. **Borderless giving through NEAR Intents:** a donor pays from the chain and token they already hold, and the campaign receives one settlement asset. Nobody bridges, swaps or buys gas by hand.
2. **Verifiable generosity:** each campaign has a public ledger of every donation and withdrawal, with optional milestone release approved by co-signers. Trust comes from the record, not from the platform's word.
3. **A terminal-to-hero animated experience:** the site opens like the NEAR Hackathon page, with code lines typing out on screen that resolve into the Nearfund interface.

The intended experience is human: donors should not need to understand wallets, chains or gas to give, and creators should not need a fundraising team to launch.

## Technical architecture

The proposal's architecture has seven components and one campaign contract. The app signs and the relayer pays gas, and an indexer turns contract events into the ledger the pages show. The contract is the single source of truth for campaign rules.

| Layer | Choice | What it does |
|---|---|---|
| Frontend | React, Tailwind CSS, Framer Motion or GSAP | Pages, wizard, dashboard and animated intro; server-side rendering for fast campaign links and social cards is a future direction |
| Wallet and auth | NEAR Wallet Selector, social login option | Lets users sign transactions without deep crypto knowledge |
| Smart contract | Rust contract on NEAR (near-sdk) | Creates campaigns, records donations, enforces goal and deadline, handles withdrawals and milestone release |
| Cross-chain giving | NEAR Intents | Accepts a donation in another token or chain and settles it as USDC or NEAR |
| Gasless donations | Meta-transactions through a relayer | Donors do not need NEAR for transaction gas; attached deposits remain subject to the contract flow |
| Community payouts | Sputnik DAO or Trezu (optional) | Co-signers approve milestone withdrawals |
| Off-chain data | Supabase (PostgreSQL, Storage) | Campaign stories, images, drafts, updates and reports |
| Indexer | Small Node service reading contract events | Builds the public ledger and totals for fast page loads |
| Hosting | Vercel (frontend), Supabase (data) | Low-cost MVP hosting |

The repository currently uses Vite + React rather than the proposed Next.js stack; it does not migrate frameworks as part of this prototype.

### Proposed Supabase data model

| Table | Main fields |
|---|---|
| `campaigns` | `id`, `slug`, `title`, `category`, `summary`, `story`, `cover_url`, `goal_amount`, `asset`, `deadline`, `creator_account`, `contract_id`, `status` |
| `donations` | `id`, `campaign_id`, `donor_account`, `amount`, `asset`, `source_chain`, `tx_hash`, `message`, `is_anonymous`, `created_at` |
| `updates` | `id`, `campaign_id`, `body`, `media_url`, `created_at` |
| `milestones` | `id`, `campaign_id`, `title`, `amount`, `status`, `approval_proposal_id` |
| `reports` | `id`, `campaign_id`, `reason`, `status` |
| `profiles` | `account_id`, `display_name`, `avatar_url`, `verified` |

## Prototype scope

- **Must ship:** wallet login, campaign wizard, campaign page with progress, donation in NEAR or USDC, live ledger, creator dashboard and withdrawal.
- **Should ship:** NEAR Intents cross-chain donation, gasless donation, share link and QR code, animated intro.
- **Stretch:** milestone release with Sputnik DAO or Trezu, admin review queue, organizer verification badge.

The original hackathon proposal targeted development completion by Nov 14, 2026, 23:59 UTC. The current prototype is a testnet campaign and native-NEAR slice of this larger scope. USDC, cross-chain routing, social login, a complete event indexer and production launch remain future work.

## Potential impact, scalability and revenue

- **Direct impact:** Nearfund lets people raise and give across borders in minutes instead of days, with reduced gas hurdles and a public record of where money goes.
- **Revenue model (scale phase):** a small optional tip from donors at checkout, plus a low transparent platform fee (for example, a single-digit percentage, to be set after testing) charged only when a campaign pays out. Organizations could later pay for branded pages, recurring giving and donor reporting.
- **Partnerships:** NGOs, schools, faith groups and diaspora communities can run verified campaigns at scale, with Sputnik DAO or Trezu treasuries for shared control.
- **System scalability:** the contract and data model are category-agnostic. NEAR Intents can add supported chains and tokens without changing the campaign contract, subject to a secure settlement and donor-attribution design.

## Animated experience specification

The animation reproduces the feel of the NEAR Hackathon opening, adapted to the Nearfund story:

1. **Intro (about 3 to 4 seconds, once per session):** a dark screen with a blinking cursor. Monospaced lines type out `> init nearfund`, `> connect near`, `> campaign.create()`, `> donations.settle()`, `> ready`, beside a 0 to 100 counter. A visible **Skip intro** link ends it at once.
2. **Code-to-hero transition:** the typed lines lift and fade as the hero headline resolves into place, for example **GENEROSITY HAS NO BORDERS**, with a short line of copy and buttons for starting a campaign and exploring causes.
3. **Hero loop:** a rotating line such as “Give to a cause in Lagos. Raise from Lisbon.” with a pause control.
4. **Ticker:** a continuous marquee of mission lines separated by `✳`, for example `BUILD WITHOUT BORDERS`, `GIVE WITHOUT LIMITS`, `MAKE YOUR SIGNAL MATTER`.
5. **Section reveals:** terminal-style headings such as `>_ campaigns.list` type in as they scroll into view; cards fade up in sequence; a “Loading the campaigns...” state shows while data loads.
6. **Campaign progress:** the progress bar fills and the raised amount counts up when the card appears.
7. **Donation success:** on confirmation, a ledger line types out, for example `> tx confirmed`, followed by a short burst of code characters and a thank-you message with a share button.

Implementation notes: use a small `useTypewriter` hook, Framer Motion or GSAP for transitions, and CSS keyframes for the marquee. Respect `prefers-reduced-motion` by showing the final state without motion, and keep the intro under the performance budget so it never blocks the page on slow mobile networks.

## Getting started

### Requirements

- Node.js and npm
- A NEAR testnet wallet with testnet NEAR for campaign creation and donations
- A deployed and initialized NEAR testnet campaign contract
- Supabase project credentials for campaign metadata and the optional sponsored-gas relay

### Frontend configuration

Create `.env.local` in the repository root using the public values only:

```dotenv
VITE_NEAR_CONTRACT_ID=your-deployed-contract-account-id
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
```

Do not put a Supabase secret/service-role key, NEAR private key or relayer key in `.env.local` or any `VITE_` variable. If a Supabase secret key was previously placed in a frontend environment file, remove it and rotate it in Supabase.

Install dependencies and run the frontend:

```sh
npm ci
npm run dev
```

Create a production build with:

```sh
npm run build
```

### Sponsored testnet gas

The optional `near-relay` Supabase Edge Function accepts only a wallet-signed delegate for the configured campaign contract. It permits a `donate` call and, when needed, the contract's bounded `storage_deposit` call. It rejects other methods, contracts, excessive gas, invalid storage deposits and stale delegate signatures. The relayer's private key stays server-side.

To enable sponsorship:

1. Deploy `supabase/functions/near-relay/index.ts` to the Supabase project.
2. In the Supabase Edge Function secrets, set:
   - `NEAR_TESTNET_CONTRACT_ID` to the deployed testnet campaign contract account.
   - `NEAR_RELAYER_ACCOUNT_ID` to the funded testnet account that will pay transaction gas.
   - `NEAR_RELAYER_PRIVATE_KEY` to that account's server-side signing key.
   - `ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins, such as `http://localhost:5173` and the production app origin.
3. Ensure the relayer account has testnet NEAR and that its key matches the configured account.
4. Test with small testnet donations and check the returned transaction on a NEAR testnet explorer.

The endpoint has in-memory rate limits per function instance, which are not a durable or production-grade abuse-control system. Use a shared rate limiter and explicit relayer budget controls before production. A delegated donation still spends the donor's attached donation amount and any required storage deposit; sponsorship is for transaction gas only.

## Security and contract limitations

- The campaign contract is the source of truth for goals, deadlines, contributions, payout and refund eligibility.
- Anyone may create campaigns. Each campaign fixes its goal, deadline, category, beneficiary and one asset.
- Donations stop at the deadline. Reaching a goal does not end a campaign early.
- After the deadline, a campaign whose total reached its goal permits a full beneficiary payout, including overfunding. Otherwise, each donor can claim a full refund.
- The contract has no platform fee, early payouts, cancellations, partial refunds, milestones or co-signer approval rules.
- Contributors must prepay contract storage. Unused storage credit is non-withdrawable in this MVP.
- Only trusted, compliant NEP-141 token contracts should be used. Token registration, account freezes and token behavior remain operational risks.
- A failed transfer can be retried only after the contract callback observes failure. A callback failure can leave a claim pending; never blindly retry an ambiguous transfer.
- The contract's public ledger events must be indexed from successful receipts. An attempted transfer alone is not proof of completed payment.
- Before real funds: run contract tests, add sandbox tests against the exact settlement token, test failed transfers and callback failures, verify storage/gas requirements, secure deployment keys, and obtain an independent audit.

## Submission and supporting materials

The submission package is intended to include:

- **System workflow model:** sign-in to campaign creation, sharing, donation, ledger verification and withdrawal.
- **System architecture diagram:** app, relayer, Nearfund contract, NEAR Intents, indexer and Supabase.
- **UI/UX wireframes and sketches:** screens for each interface, led by the campaign wizard, campaign page and donate modal.
- **Working prototype and demo:** public repository plus a demo video on X, as required by the hackathon.
