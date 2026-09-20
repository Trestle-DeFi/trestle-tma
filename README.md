# Trestle TMA — Telegram Mini App

**Legal Disclaimer:** Trestle DeFi (trestle.website) is an independent Web3 ecosystem. We are not affiliated with the Celestia-based "Trestle Protocol" bridge project or any of its subsidiaries.

## Live

- **Web**: https://tma.trestle.website
- **Telegram**: https://t.me/trestlehub_bot (@trestlehub_bot)

Supported chains (4): Polygon Mainnet (wallet/rewards/chain status), Polygon Amoy,
Base Sepolia and Arbitrum Sepolia (full marketplace/escrow/RWA contracts).

## Overview

Telegram Mini App for Trestle DeFi — unified interface for testnet + reward hub.

- **Dashboard**: Reward stats, chain status, quick actions
- **Marketplace**: Browse/buy digital goods across the 3 testnets (Amoy, Base Sepolia, Arbitrum Sepolia)
- **Tasks**: Complete tasks to earn hNOBT points
- **Bug Bounty**: Report vulnerabilities, earn rewards
- **Stake**: Lock hNOBT, earn yield
- **Verify**: Biometric + passport verification

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS |
| Wallet | Reown AppKit + Wagmi |
| Telegram | @telegram-apps/sdk v2 |
| Backend | Cloudflare Worker (Hono) + D1 + KV + AI |
| Chains | Polygon Mainnet, Polygon Amoy, Base Sepolia, Arbitrum Sepolia |

## Structure

```
trestle-tma/
├── frontend/          # Vite React app (deployed via CF Pages)
│   ├── src/
│   │   ├── pages/     # Dashboard, Marketplace, Tasks, Bounty, Staking, Verify, Withdraw
│   │   ├── hooks/     # useContracts, useAuth, useTelegram, useTelegramLink
│   │   ├── lib/       # api, astra, vault, reward
│   │   └── components/
│   └── public/avatars/
└── worker/            # Cloudflare Worker (vault.trestle.website)
    └── src/           # index.js, vault.js, log.js
```

## Setup

```bash
# Frontend
cd frontend
cp .env.example .env.local    # fill in WalletConnect project ID
npm install
npm run dev

# Worker
cd worker
npm install
npx wrangler dev
```

## Deploy

**Frontend** deploys automatically: `tma.trestle.website` is a **Cloudflare Pages** project with
git integration — every push to `main` is built and published by Cloudflare (no GitHub Action).

**GitHub Actions** (`.github/workflows/` at the repo root):

| Workflow | Trigger | Action |
|----------|---------|--------|
| `deploy-worker.yml` | push to `main` (paths `worker/**`) | `wrangler deploy` → `vault.trestle.website` |

The daily yield cron is a **Cloudflare Cron Trigger** (`5 0 * * *` in `worker/wrangler.jsonc`) — no
GitHub scheduled workflow is needed.

Worker deploys require repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
(frontend needs no secrets — Pages builds it from the repo).

## API Endpoints

| Service | URL |
|---------|-----|
| Reward API | `https://reward-api.trestle.website` |
| Vault Worker | `https://vault.trestle.website` |

## 📬 Contact

- **Website**: [https://trestle.website](https://trestle.website)
- **Testnet Hub**: [Testnet Hub](https://testnet.trestle.website)
- **Reward Hub**: [Reward Hub](https://reward.trestle.website)
- **GitHub**: [Trestle DeFi](https://github.com/Trestle-DeFi)
- **Documentation**: [https://docs.trestle.website](https://docs.trestle.website)
- **X (Twitter)**: [Trestle DeFi](https://x.com/Trestle_0xArch)
- **BlueSky**: [Trestle DeFi](https://bsky.app/profile/trestle-0xarch.bsky.social)
- **Medium**: [Trestle DeFi](https://medium.com/@trestle_defi)
- **Discord**: [Trestle DeFi](https://discord.gg/4dCCvnJYGT)
- **Telegram**: [trestleDeFi](https://t.me/trestleDeFi)
- **Telegram App**: [trestlehub_bot](https://t.me/trestlehub_bot)
- **Email**: contact@trestle.website


---

**Disclaimer:** Not affiliated with Trestle Protocol (Celestia Bridge).
