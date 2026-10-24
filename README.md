# PaddyPay

<img src="images/brand/paddypay-logo.svg" alt="PaddyPay logo: rice plant, water, and carbon seal" width="540">

**Proof from the field. Payment to the farmer.** PaddyPay helps a rice cooperative track alternate wetting and drying (AWD) while the crop is growing, preserve evidence that others can check, and show each farmer's share of a simulated carbon sale.

[AWD](https://ghgmitigation.irri.org/mitigation-technologies/alternate-wetting-and-drying) periodically lets rice fields dry instead of keeping them continuously flooded, which can reduce methane emissions. The prototype tackles three questions a farmer or verifier should be able to answer: **Did this plot follow AWD? Where is the evidence? How was the farmer paid?** Signed sensor readings and water-tube photo hashes support each plot assessment. A smart contract records daily evidence roots, rejects duplicate registrations within the registry, and allocates sale proceeds by a public 70/10/20 rule.

**Demo scope:** The 100-day season, field readings, photo evidence, sale, and dVND token are simulated. The 150,000 dVND/tCO₂e price is an assumption. These estimates are not issued carbon credits or a verified VM0051 project.

## Two-minute demo

The seeded Winter–Spring 2026 season covers **24 plots, three irrigation clusters, and 100 days**. It produces **14 eligible plots, 8 needing more evidence, and 2 flagged**. The demo deliberately includes a conflicting photo, an unsafe water level, a four-day sensor outage, and a rejected duplicate claim.

| Show this | What it demonstrates |
| --- | --- |
| **Replay season** in the 3D twin | Plot status changes as field evidence arrives. |
| **A-07, B-06, C-01** | Concrete reasons for red or yellow assessments. |
| **Actions → C-01** | In a fresh local demo, a required photo is missing alongside a four-day sensor gap. Uploading the photo clears that task while the sensor gap stays yellow. |
| **Evidence → Verify on chain** | Changing a signed `-12 cm` reading to `-11 cm` fails verification against the anchored root. |
| **Rejected A-07 registration** | The contract prevents a second claim for the same plot and season in this registry. |
| **Payouts → Ms. Ut’s receipt** | A-01's estimated 1.895 tCO₂e yields a 198,975 dVND farmer share at the assumed price, with allocation and withdrawal transactions. |

The [public overview](http://localhost:4174/judges.html) gives judges the plot statuses and evidence links without listing farmer names or wallet addresses. The dashboard also exports a plot CSV.

## Farmer-facing mobile web demo

Open the [English farmer view](http://localhost:4174/farmer.html) on a phone to see the simulated A-01 household. It uses the existing wallet-free receipt link, explains the plot's evidence status and the 70% farmer allocation step by step, and links to the demo transactions when a public explorer is available. The shared cluster reading and seeded photo hashes are labeled as simulated evidence. There is no real VND payment or issued carbon credit.

The **Have a question?** card answers English questions about the plot, evidence, allocation, carbon estimate, and review request. Without an AI key, it uses a clearly labeled guide built from the receipt and plot record. On the local server with `ANTHROPIC_API_KEY`, Claude classifies free-text questions into the relevant topics; the server still composes the answer from the actual demo record, so the model cannot invent a payout or change the plot status. Only the question is sent to Claude, not the receipt or farmer identity. The hosted Vercel snapshot always uses guided answers because its demo receipt token is public.

The farmer can draft a request to review a water reading, plot area, or payment. The draft stays in that browser's local storage; the user can download or share a text copy for the cooperative. **The demo does not submit the request to a cooperative or record a resolution.** The receipt token in `/api/state` is intentionally public for the shared hackathon demo. A real farmer deployment needs authenticated private access and a cooperative review workflow.

## AI evidence review

Set `ANTHROPIC_API_KEY` in `.env.local` and restart the local server to enable **Analyze photo with AI** on a plot that has not been finalized, such as [C-01](http://localhost:4174/#plot/C-01). Choose a user-provided water-tube image and its actual observation day. The model screens the image and the app compares its suggestion with the signed, shared-cluster reading for that selected day. Unreadable images and discrepancies remain visible for a person to review. The form requires explicit human confirmation before recording a photo hash. The current checked-in demo does not include genuine field photos or a configured AI key; do not present this as a completed field validation.

## Published field data case study

The [Published field data](http://localhost:4174/#research) demo is a **separate research data ingestion test**, not a PaddyPay field pilot. It replays the original dated observations from five AWD plots in a 2023 experiment in Catalonia, Spain, without filling the gaps between measurements. The data were published by [Echeverría-Progulakis et al.](https://doi.org/10.1111/1365-2664.70303). The researchers' [source repository](https://github.com/echeverriaseba/Thesis_Paper_3) is CC0-1.0. PaddyPay did not collect or independently verify these measurements.

The original [`Piezo_2023.csv`](public/research/piezo-2023.csv) is copied byte for byte from a [pinned source commit](https://github.com/echeverriaseba/Thesis_Paper_3/blob/7af258ac87b937d85a3b4b81c166736e9cbd3377/data/2023/Piezo_2023.csv). Its SHA-256 is `6738932f96c2133d023db08b2118b46aac02ea69073dcd008c4040c51e8514c0`. Run `npm run build:research` to rebuild [`summary.json`](public/research/summary.json) from that file. The page reports 345 AWD rows across five plots, including 344 numeric water levels. The source has uneven sampling, no PaddyPay device signatures or matching photos, and a different location and calendar from the simulated 100-day An Giang season. It is intentionally **not eligible for carbon estimates, credits, or payouts** in PaddyPay. Its purpose is to test whether real, imperfect source data can be ingested and shown with provenance and missing-evidence gates.

## Run locally

Requires Node.js 22 and [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge` and `anvil`). Run these commands from this directory:

```sh
npm ci
npm run demo
```

The command compiles the contracts, starts Anvil on port `18545`, generates and anchors the season, simulates a credit sale and withdrawal, and serves the UI at **http://localhost:4174**. Keep the terminal open while using the app; `Ctrl-C` stops the server and Anvil. The first run creates a private `SIM_SEED` in `.env.local`; later runs reuse it so the simulated identities and readings are reproducible. Generated state and uploaded photos live in the Git-ignored `data/` directory.

The 3D twin loads Three.js from a CDN, so the browser needs an internet connection for that view.

`run.sh` reads `.env` and then `.env.local`. Copy [.env.example](.env.example) to `.env.local` if you need to set the web port, testnet wallet and RPC, or optional `ANTHROPIC_API_KEY`. The local demo uses Anvil port `18545` even if `RPC_URL` in the example file has another value. `npm start` serves an existing `data/demo-state.json` and requires its chain to be available.

```sh
npm test               # Gateway, AWD, QA3, public snapshot
npm run test:contracts # Foundry
```

## How it works

- `PaddyRegistry` prevents duplicate registrations for a plot and season, restricts device registration to the cooperative, anchors one root per plot per day, verifies EIP-191 signatures and Merkle proofs, records photo hashes, finalizes eligible plots, splits dVND 70/10/20, and allows each allocation to be withdrawn once.
- The gateway rejects unknown devices, invalid signatures, and repeated or out-of-order `seq` values. The simulation covers 24 plots in three clusters and 296 anchored batches; cluster C has four days of missing sensor data. Results: 14 green, 8 yellow, and 2 red.
- QA3 uses the factors shown in the app with a 15% deduction. For example, the 100-day estimate is 1.307 tCO₂e/ha after the deduction. N₂O adjustments and sampling uncertainty are not included.
- A Three.js digital twin of the season with an on-chain inspector: for any day it shows the signed sensor readings, their Merkle tree and root, and the `anchorBatches` transaction and block that stored it. A transaction feed lists the demo transactions. `node scripts/index-chain.mjs` rebuilds that index from the chain; `npm run demo` builds it automatically.
- A dashboard, plot details, reading verification, payouts, wallet-free individual receipts, CSV export, and an [English public page](http://localhost:4174/judges.html). The public page does not expose farmers' names or wallet addresses.
- A cooperative action queue turns each red or yellow assessment into a task with its reason and suggested next step. Follow-up photos are displayed alongside the original evidence; adding a photo does not erase a sensor outage or conflicting reading. The hosted snapshot shows the queue in read-only mode.
- The seeded local season omits C-01's day 83 photo to demonstrate the recovery task. The checked-in Kairos snapshot records an earlier run, so it still shows C-01's sensor-gap task but not this new missing-photo task.
- Users can upload photos for plots that have not been finalized and confirm the water level; only the photo hash is recorded on-chain. With `ANTHROPIC_API_KEY` set, AI photo review reports whether the tube and waterline are visible, a suggested reading or abstention, qualitative confidence, image-quality issues, and a comparison with that day's shared cluster sensor. A difference over 10 cm, missing sensor data, low confidence, or unreadable image is flagged for human review. The user must explicitly confirm the entered level before recording. The server stores the AI suggestion separately from the human-confirmed value in the photo record; a flagged AI review remains in the cooperative action queue even if the plot's rule-based status is green. The demo has no resolution workflow for that AI task. AI does not decide eligibility or payout. Seeded demo photos are simulated hashes rather than image files. The integration uses the [Messages API](https://platform.claude.com/docs/en/api/http/messages), [vision input](https://platform.claude.com/docs/en/build-with-claude/vision), and [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Public testnet demo

The full public demo runs on Kaia Kairos (chain ID 1001). The deploy-only command also supports Base Sepolia. Use a funded, test-only wallet; the [Kaia faucet](https://www.kaia.io/faucet) supplies testnet gas.

For a deploy-only command, set `DEPLOYER_PRIVATE_KEY` in `.env.local` to a funded test-only wallet's private key and set `COOP_ADDRESS` and `DEVELOPER_ADDRESS` to testnet addresses. Then run:

```sh
./run.sh deploy:kairos   # or deploy:base for Base Sepolia
```

This deploys the registry and simulated dVND token, then writes their addresses to `data/<network>-deployment.json`. For Kairos, the command prints [KaiaScan](https://kairos.kaiascan.io) links. Keep `.env.local` private.

To run the whole seeded season on Kairos instead of Anvil, set `DEPLOYER_PRIVATE_KEY` and run the following command. The demo generates fresh contracts, so it does not use the deploy-only addresses.

```sh
./run.sh demo:kairos
```

The deployer wallet acts as operator, cooperative and developer, and sends testnet gas to farmer A-01 so it can withdraw. The script requires at least 2 KAIA in the deployer wallet before starting. The UI then links transactions to KaiaScan.

To update the read-only public snapshot after a demo run:

```sh
node scripts/build-vercel-snapshot.mjs
```

This writes `deployment/snapshot.json` with plot statuses, evidence hashes, the transaction history, and one demo receipt. A snapshot generated from local Anvil preserves signatures, proofs, and roots, but Vercel cannot query that local chain. A Kairos snapshot retains public explorer links. The hosted snapshot verifies a signature and Merkle proof against its saved root; the live local app queries the contract.

## Limitations

- The demo constants `EF_c = 1.22` and `SF_w = 1 / 0.71 / 0.55` match [Tables 5.11–5.12 of the 2019 IPCC Refinement](https://www.ipcc-tfi.iges.or.jp/public/2019rf/pdf/4_Volume4/19R_V4_Ch05_Cropland.pdf). `GWP_CH4 = 28` uses the AR5 100-year value cited by the [IPCC](https://www.ipcc.ch/srccl/chapter/summary-for-policymakers/) and [Verra's GWP rules](https://verra.org/programs/verified-carbon-standard/vcs-program-details/vcs-frequently-asked-questions/). The 15% deduction for QA3 projects below 60,000 tCO₂e/year is specified in [VM0051 v1.1](https://verra.org/documents/vm0051-improved-management-in-rice-production-systems-v1-1/). The UI formula remains a simplified CH₄ estimate, not a complete VM0051 calculation.
- Real satellite imagery, CDM sampling uncertainty calculations, N₂O adjustments, and a complete VVB submission package are not yet available.
- Duplicate prevention only applies to programs sharing the same registry; overlapping polygons are not detected.
- AI photo readings are suggestions and have not been tested on real field photos. Confidence is the model's qualitative self-assessment, not a calibrated probability. A photo alone cannot authenticate its capture date, location, or plot. Demo photos are simulated hash strings; user-uploaded images are stored in `data/photos/` and may or may not be genuine field photos. The AI service receives a user-selected image only when the user chooses to analyze it, and the AI review is available only on a server configured with an API key.
