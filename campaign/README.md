# Nearfund campaign contract

This Rust contract implements NEAR campaigns with a fixed goal, deadline, beneficiary, category, and settlement asset. It accepts native NEAR or a specified NEP-141 fungible token, records donor contributions, and enforces payout or refund eligibility after the deadline.

The contract is the source of truth for campaign terms, accepted contribution totals, and claims. It does not implement cross-chain routing, campaign-level milestones, co-signer approval, partial payouts, or platform fees.

## Reproducible local checks

Requirements: Rust `1.95.0` with the `wasm32-unknown-unknown` target (the repository's `rust-toolchain.toml` selects the toolchain), and `cargo-near`.

From this directory:

```sh
cargo test
cargo near build non-reproducible-wasm
```

**Expected result:** `cargo test` passes 13 unit tests. The build produces `target/near/nearfund_campaign.wasm` and its ABI at `target/near/nearfund_campaign_abi.json`. The `non-reproducible-wasm` build is for local development; it does not claim a reproducible release build. The current build emits deprecation warnings for `env::promise_result` in transfer callbacks.

The unit tests exercise contract logic in mocked NEAR contexts. They do not deploy to a network, run a sandbox, or validate behavior of a real FT contract.

## Deploy and initialize

Build the WASM above, then deploy `target/near/nearfund_campaign.wasm` to a NEAR **testnet** contract account with NEAR tooling. Initialize it as part of the deployment batch by calling `new {}` signed by the contract account. Initialization is private and can only be called by the contract itself. Do not initialize a second time.

Use testnet accounts and funds for evaluation. This contract repository does not include deployment credentials or a preconfigured contract account. For mainnet deployment, release-build reproducibility, deployment-key governance, and independent security review are still required.

## Judge walkthrough

These method calls can be made with NEAR-compatible contract tooling against an initialized deployment. JSON uses decimal strings for `U64` and `U128` values; account IDs are strings. Amounts are in the settlement asset's smallest units. For native NEAR, `1 NEAR = 10^24` yoctoNEAR.

1. **Prepay campaign storage.** From the creator account, call payable `storage_deposit {}` with a positive NEAR deposit. **See:** the returned remaining storage credit. The required amount depends on actual storage growth and network storage pricing; check `get_storage_credit {"account":"creator.testnet"}` rather than relying on a fixed estimate. Unused credit cannot be withdrawn in this MVP.
2. **Create a native NEAR campaign.** From that creator, call `create_campaign` with no attached deposit and arguments such as:

   ```json
   {
     "goal": "1000000000000000000000000",
     "deadline": "1799999999000000000",
     "category": "Education",
     "beneficiary": "beneficiary.testnet",
     "token": null
   }
   ```

   Choose a future Unix timestamp in nanoseconds for `deadline`, and ensure the creator has enough storage credit. **See:** a campaign ID. Call `get_campaign {"campaign_id":"0"}` (replace `0` with the returned ID) to inspect its terms, current total, status, and payout state.
3. **Donate.** From a donor who has prepaid storage, call payable `donate {"campaign_id":"0"}` and attach a positive NEAR amount. **See:** the updated campaign `total` and the donor's contribution from `get_contribution {"campaign_id":"0","donor":"donor.testnet"}`. A donation at or after the deadline is rejected.
4. **Check the goal outcome.** `get_campaign` reports `active` before the deadline, then `successful` when total contributions meet or exceed the goal, or `failed` otherwise. **See:** reaching the goal does not close an active campaign early.
5. **Claim after the deadline.** For a successful campaign, call `claim_payout {"campaign_id":"0"}`; for a failed campaign, call `claim_refund {"campaign_id":"0","donor":"donor.testnet"}`. Either call may be submitted by any account, but the contract fixes the recipient. **See:** the claim state changes to `pending`, then to `paid` on successful transfer. A failed transfer resets the claim to `unclaimed` when its callback observes failure, allowing a retry. Claims require at least 70 Tgas. Native NEAR claims attach zero; FT claims attach exactly 1 yoctoNEAR.

Contract views are `get_campaign`, `get_campaign_count`, `get_contribution`, and `get_storage_credit`. Enumerate campaign IDs from zero up to `get_campaign_count - 1`; the contract does not expose an unbounded campaign-list method.

## Asset and accounting rules

- Each campaign accepts one asset: `token: null` for native NEAR, or the account ID of one NEP-141 token contract.
- Campaign goals and donation amounts use that asset's smallest units. For a token, use that specific contract's decimals and verify the token contract independently; the contract does not certify a token as USDC.
- Native donations use `donate` with attached NEAR. FT donations use the token's `ft_transfer_call` with this contract as receiver and `msg` set to the JSON string `{"campaign_id":"0"}`. The token must have registered this contract, and each donor must have prepaid storage here.
- For FT claims, the beneficiary or donor must be registered with the token so it can receive the transfer. Failed or malformed FT transfer calls may return the full amount as unused through the NEP-141 resolver.
- Donations stop at the deadline. After it, a campaign with `total >= goal` permits one full beneficiary payout, including overfunding; otherwise, donors can each claim their full recorded contribution.
- `total` is historical gross accepted donations. Read payout/refund states to determine remaining obligations; do not treat `total` as a live escrow balance.
- There are no fees, early payouts, cancellations, partial refunds, or campaign-level milestone/co-signer rules.

## Events and asynchronous transfers

The contract emits NEP-297-formatted `EVENT_JSON:` logs under standard `nearfund`, version `1.0.0`. Events include campaign creation, donations, and pending/succeeded/failed payout and refund transfers. Index successful transaction receipts to build an activity ledger; a pending event or attempted transfer alone does not prove that the recipient was paid.

Claims are marked pending before an asynchronous transfer so they cannot be claimed concurrently. A callback that observes a failed transfer resets the claim for retry; one that observes success marks it paid. If the callback itself fails, the claim can remain pending. There is intentionally no timeout reset because the transfer may already have succeeded. Investigate receipts and reconcile carefully; never blindly retry an ambiguous transfer.

## Limitations and integration boundaries

- Only use trusted, compliant NEP-141 contracts. A malicious token may falsify transfers or return pathological results. This contract has no vetted token registry.
- Token registration, account freezes, token behavior, beneficiary account control, and contract upgrade-key security are operational risks.
- Direct transfers to the contract that bypass `donate` or `ft_transfer_call` are not attributed to a campaign and cannot be recovered through this API.
- For FT campaigns, the contract must be registered with the token before it can transfer tokens. Claims also depend on recipient registration.
- NEAR Intents routing, social sign-in, gas sponsorship, frontend integration, and event indexing are outside this contract. A router that donates becomes the recorded donor; refunds go to the recorded donor account.
- If an account is a DAO-controlled beneficiary, its own governance may control spending after payout. That does not add campaign-level approval rules to this contract.

Before handling real funds, add sandbox tests against the exact token contract, test failed transfers and callback failures on the target network, verify storage and gas requirements, secure deployment and upgrade keys, and obtain an independent security audit.
