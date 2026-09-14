# Trestle TMA — Telegram Mini App

**Legal Disclaimer:** Trestle DeFi (trestle.website) is an independent Web3 ecosystem. We are not affiliated with the Celestia-based "Trestle Protocol" bridge project or any of its subsidiaries.

## Overview

Telegram Mini App for Trestle DeFi — unified interface for testnet + reward hub.

- **Dashboard**: Reward stats, chain status, quick actions
- **Marketplace**: Browse/buy digital goods across testnets + mainnet
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
│   │   ├── lib/       # api, astra, vault, reward, testnet
│   │   └── components/
│   └── public/avatars/
└── worker/            # Cloudflare Worker (vault.trestle.website)
    └── src/           # index.js, vault.js, provider.js, log.js
```

## Setup

```bash
# Frontend
cd frontend
cp .env .env.local    # fill in WalletConnect project ID
npm install
npm run dev

# Worker
cd worker
npm install
npx wrangler dev
```

## Deploy

- **Frontend**: Push to `main` → GitHub Actions → Cloudflare Pages
- **Worker**: `npx wrangler deploy`

## API Endpoints

| Service | URL |
|---------|-----|
| Reward API | `https://reward-api.trestle.website` |
| Testnet API | `https://testnet-api.trestle.website` |
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
