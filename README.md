# Nearfund

Nearfund is a NEAR testnet fundraising dApp. It lets campaign creators publish a goal, deadline, category, and beneficiary to a NEAR contract; supporters can donate native NEAR to that campaign. The contract records donations and controls payout or refund eligibility.

## Problem

Community fundraisers and their supporters may be separated by geography, payment systems, and currencies. Organizers need a way to publish a funding goal and supporters need a way to verify that a donation reached the campaign. Nearfund addresses this with campaign rules and donation transactions recorded on NEAR. This prototype does not yet provide cross-chain payments.

## Implementation status

| Capability | Status | Source of truth |
|---|---|---|
| Create a campaign with goal, deadline, category, and beneficiary | Implemented on NEAR testnet | Campaign contract |
| Donate native NEAR and read campaign totals | Implemented on NEAR testnet | Campaign contract |
| Enforce goal/deadline outcomes; claim a payout or refund | Implemented in the contract | Campaign contract |
| Browse and filter campaigns; view campaign pages | Implemented | Contract data, with optional Supabase display metadata |
| Campaign stories, updates, donation messages, and readable receipts | Implemented when Supabase is configured | Supabase; these records do not control funds |
| Optional transaction-gas relay | Code included; requires separate deployment and configuration | Supabase Edge Function |
| NEAR Intents, other chains/tokens, USDC, social sign-in, mainnet payments, milestone approvals | Not implemented | — |

This is a testnet prototype, not a production fundraising service. Donors need a compatible NEAR testnet wallet and enough testnet NEAR for the gift, transaction gas, and any required contract storage deposit. A donation's optional anonymous setting only hides the account in Nearfund displays; NEAR transactions remain public.

## Run locally

### Requirements

- Node.js and npm
- A deployed and initialized NEAR testnet campaign contract
- A NEAR testnet wallet funded with testnet NEAR to create and donate
- A Supabase project for saved campaign details and readable app receipts (optional for contract reads and donations)

### Configure

Copy the example environment file:

```sh
cp .env.example .env.local
```

Set `VITE_NEAR_CONTRACT_ID` to the account ID of the deployed, initialized testnet campaign contract. To enable campaign story metadata and saved app receipts, also set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Supabase project URL and public anon/publishable key. Apply the SQL files in `supabase/migrations/` in filename order before using those Supabase features.

Only public values belong in this Vite environment file. Do not put a Supabase secret/service-role key, NEAR private key, or relayer key in `.env.local` or any `VITE_` variable. Without Supabase, contract campaigns can still be read and used, but custom campaign details and readable app receipts will not persist.

Install dependencies and start the app:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Build the production bundle with `npm run build`.

If no testnet contract is deployed yet, see the contract build and deployment notes in [campaign/README.md](./campaign/README.md).

## Judge walkthrough

Use testnet accounts and testnet funds only. Each wallet action requires user approval.

1. **Open `/explore`** — Nearfund queries the configured contract. **See:** campaigns returned by that contract, with search, category filters, and sorting. If it has no campaigns, continue to step 2.
2. **Open `/campaign/new`** — Complete the five-step wizard with a title, category, positive NEAR goal, future deadline, and valid beneficiary account. Connect a testnet wallet and publish. **See:** a wallet transaction request, then an on-page confirmation with a campaign ID and a link to its campaign page. The contract stores the goal, deadline, category, beneficiary, and NEAR asset. Story and cover details are display metadata and require Supabase to persist.
3. **Open the campaign page** — Use the campaign link from step 2, or select a campaign in Explore. **See:** its contract-backed raised amount, goal, deadline, and status. Select **Donate to this campaign**, enter a positive NEAR amount, and confirm in a testnet wallet. **See:** a confirmed-donation message with a NEAR testnet explorer transaction link; after the page refreshes its contract-backed raised amount includes the donation.
4. **Check the record** — Open the transaction link from the confirmation. **See:** the public NEAR transaction. If Supabase is configured and the database insert succeeds, the message and display preference may also appear in Nearfund's readable ledger; this app ledger is not a complete chain index.
5. **Check the management views** — Open `/dashboard` with the creator or beneficiary wallet connected. **See:** campaigns associated with that account and their contract status. A payout or refund becomes eligible only after the deadline and according to the contract's goal rules; it is not an immediate demo action.

The build and contract tests below can be run without a wallet transaction; they verify compilation and contract logic, not browser behavior. The on-chain walkthrough requires the testnet deployment, wallet, and funds described above.

## Verification

From the repository root, build the frontend:

```sh
npm ci
npm run build
```

Run the campaign contract unit tests:

```sh
cd campaign
cargo test
```

The contract tests cover contract behavior including campaign creation, donations, deadline/goal outcomes, payout/refund claims, and storage. These tests do not deploy the contract or exercise the browser, wallet, Supabase, or gas relay.

## Contract rules and data boundaries

- Any account can create multiple campaigns. Each campaign fixes a goal, deadline, category, beneficiary, and one asset.
- The current frontend creates and accepts donations only for native NEAR campaigns.
- Donations stop at the deadline. Reaching the goal does not end a campaign early.
- After the deadline, a campaign that reached its goal permits a full beneficiary payout, including overfunding. Otherwise, each donor can claim a refund of their contribution.
- NEAR contract state is authoritative for funds, deadlines, contributions, and claims. Supabase stores campaign presentation details and app-generated donation receipts; the frontend does not run an on-chain event indexer.
- Anyone may trigger an eligible claim, but the contract fixes the recipient. The contract has no platform fee, early or partial payouts, cancellation, milestone rules, or co-signer approval.
- A failed transfer can be retried only after the contract callback observes failure. If a callback fails, a claim can remain pending; do not blindly retry an ambiguous transfer.

The browser writes readable donation records after a confirmed wallet transaction. Those records can fail independently of the on-chain donation and are not proof of settlement. Verify the NEAR transaction itself.

## Optional gas relay

The `near-relay` Supabase Edge Function can relay an eligible, wallet-signed donation when deployed and configured. It sponsors transaction gas only; it does not pay the donation or a required storage deposit. See [HACKATHON.md](./HACKATHON.md) for the prototype context and the function source at `supabase/functions/near-relay/`.

## Project layout

- `src/` — Vite + React frontend and NEAR/Supabase clients
- `campaign/` — Rust NEAR campaign contract and unit tests
- `supabase/migrations/` — schema migrations for optional app display records
- `supabase/functions/` — optional relay and NEAR Intents quote functions; the quote function is not wired into the current donation flow
