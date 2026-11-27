# Trestle Set & Forget Contracts

## Overview

This repository contains smart contracts for the Trestle Set & Forget system, enabling configurable per‑user sub‑account management with guard subscriptions and cross‑chain capabilities.

## Live Deployment (Testnets)

| Contract | Chain | Address |
| --- | --- | --- |
| `TrestleSubAccount` | Unichain Sepolia (1301) | `0x5c6F85EdcCC12E4B0c096bd002fD27699B7Ae740` |
| `TrestleCCIPReceiver` | Unichain Sepolia (1301) | `0xB0aAcF8b6345f3342781d1A3D995D84375DB7d8E` |
| `TrestleMainVault` | Base Sepolia (84532) | `0xbF649Fdf17203ad9432d25EEDF277B85b854F36f` |
| `TrestleCCIPBridge` | Base Sepolia (84532) | `0x92011256eB929Ee92c501c67d461B505aB8edaFC` |
| `TrestleReactiveGuard` | Lasna Testnet (5318007) | `0x93b1152F710d325154bF7A095c7509DA173DA25F` |

The frontend (`frontend/src/config/contracts.ts`), the worker
(`worker/wrangler.jsonc`, `worker/src/plugins/setForget/reactiveWorker.js`) and the
plugin manifest (`frontend/src/plugins/setForget/plugin.config.json`) all point at
these addresses.

### Explorer verification

All five deployed contracts are source‑verified. The attached sources are byte‑identical
to the files in `contracts/src/` and compile with `solc 0.8.37+commit.f401782d`
(`evmVersion cancun`, optimizer on with `runs: 200`, `viaIR: true`).

| Contract | Chain | Explorer | Verified source |
| --- | --- | --- | --- |
| `TrestleMainVault` | Base Sepolia | [sepolia.basescan.org](https://sepolia.basescan.org/address/0xbF649Fdf17203ad9432d25EEDF277B85b854F36f#code) | Standard‑JSON input |
| `TrestleCCIPBridge` | Base Sepolia | [sepolia.basescan.org](https://sepolia.basescan.org/address/0x92011256eB929Ee92c501c67d461B505aB8edaFC#code) | Standard‑JSON input |
| `TrestleSubAccount` | Unichain Sepolia | [unichain-sepolia.blockscout.com](https://unichain-sepolia.blockscout.com/address/0x5c6F85EdcCC12E4B0c096bd002fD27699B7Ae740#code) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/1301/0x5c6F85EdcCC12E4B0c096bd002fD27699B7Ae740/) | Flattened source + exact match |
| `TrestleCCIPReceiver` | Unichain Sepolia | [unichain-sepolia.blockscout.com](https://unichain-sepolia.blockscout.com/address/0xB0aAcF8b6345f3342781d1A3D995D84375DB7d8E#code) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/1301/0xB0aAcF8b6345f3342781d1A3D995D84375DB7d8E/) | Flattened source + exact match |
| `TrestleReactiveGuard` | Lasna Testnet | [lasna.reactscan.net](https://lasna.reactscan.net/address/0x93b1152F710d325154bF7A095c7509DA173DA25F) · [Sourcify](https://repo.sourcify.dev/contracts/full_match/5318007/0x93b1152F710d325154bF7A095c7509DA173DA25F/) | Exact match (Reactscan serves Sourcify) |

Notes:
- Base Sepolia uses the **Etherscan V2 unified API** (`https://api.etherscan.io/v2/api?chainid=84532`).
  The legacy per‑chain endpoint `api-sepolia.basescan.org/api` now returns `NOTOK`.
- Unichain Sepolia's Blockscout verifies **asynchronously**; a submission returns a GUID and the
  source is attached only after the queue drains, so `getsourcecode` can still return an empty
  source immediately after submitting.
- Lasna's Reactscan explorer has no Etherscan‑style API — it renders contract sources straight
  from Sourcify (chain id `5318007`), so the guard is published there. `hardhat-verify`'s bundled
  `verify:sourcify` task still targets the removed Sourcify API v1, therefore `scripts/verify-all.js`
  calls the Sourcify v2 endpoint (`POST /v2/verify/{chainId}/{address}`) directly.

## Zero‑Protocol‑Capital Self‑Service

The protocol never holds capital and never configures a user's settings. Every
action below is signed by the user's own wallet:

| Action | Contract | Function |
| --- | --- | --- |
| Open the sub‑account | `TrestleSubAccount` | `createSubAccount(mainVault, threshold, target, cooldown, maxDaily)` — permissionless, keyed to `msg.sender` |
| **Change threshold / target / cooldown / daily cap** | `TrestleSubAccount` | `updateConfig(newThreshold, newTarget, newCooldown, newMaxDaily)` — the caller's own sub‑account only |
| Turn the sub‑account on / off | `TrestleSubAccount` | `activate()` / `deactivate()` — the caller's own sub‑account only |
| Fund the operational wallet | `TrestleSubAccount` | `depositTopUp()` — payable, credits `virtualBalances[msg.sender]` |
| Fund the cross‑chain reserve | `TrestleMainVault` | `depositFor(user)` — payable, credits `balances[user]` |
| Withdraw unused funds | `TrestleMainVault` / `TrestleSubAccount` | `withdraw(amount)` — only the owner of the funds |
| Set the daily top‑up cap | `TrestleMainVault` | `setMyDailyRequestLimit(limit)` |
| Register + subscribe | `TrestleReactiveGuard` | `registerSubAccount(user)`, `setupSubscription(user, maxDailyRefills, cooldown)` |
| Pause / resume | `TrestleReactiveGuard` | `pauseSubscription(user)`, `updateSubscription(user, active, maxDailyRefills, cooldown)` |
| Delegate an operator | `TrestleSubAccount` | `setOperator(operator, allowed)` — the user's own choice; the protocol owner is never one |

Everything that remains owner‑only is protocol‑level wiring that is done once per
deployment and is not part of any user's workflow: `setTopupBridge` (which bridge
the vault uses), `setBridgeCreditor` (which receiver may credit the registry),
`setCallbackRecipient` (which Base vault receives the reactive callback) and the
protocol ceilings (`setLimits`, `setMaxDailyRefillsLimit`, `setMinCooldownPeriod`,
`setMaxDailyRequestsLimit`). The owner can also force‑deactivate a sub‑account
(`deactivateFor`) as a safety switch, but can never move a user's funds or raise
a user's own limits.

### In the UI

The plugin's **Configuration Management** tab writes the settings **on-chain**
first — `updateConfig` on the Unichain registry, `setMyDailyRequestLimit` on the
Base vault and `updateSubscription` on the Lasna guard — and only then mirrors
them into the worker's off‑chain index. The worker's database is an index for
the UI, never the source of truth for what triggers a refill. A sub‑account card
carries a **Settings** button that opens this editor, and a paused guard
subscription stays paused when the settings are saved.

#### Verified live

A brand‑new address that had never touched the protocol
(`0x55ee9745F3d8cC4022818d5F75e8250A88222D27`, *not* the deployer) completed the
whole flow by itself: `createSubAccount` → `depositFor` → `setMyDailyRequestLimit`
→ `updateConfig` → `depositTopUp` → `registerSubAccount` → `setupSubscription` →
`spend` (which emitted `LowBalanceDetected`). Every receipt was signed by that
address, and the resulting on‑chain state was its own (threshold 0.001 ETH,
target 0.003 ETH, cooldown 600 s, daily cap 5).

A refill is paid from the requesting user's own reserve: `releaseTopup` debits
`balances[subAccount]` and forwards the amount plus the CCIP fee to the bridge, so
one user's reserve can never fund another user's refill.

### Testnet notes (Base Sepolia ↔ Unichain Sepolia)

The two testnet AMM markets are not arbitraged against each other: the Base
Sepolia WETH/USDC pool quotes ~5,900 USDC per ETH while the Unichain Sepolia
pool quotes ~30,000 USDC per ETH. A cross-chain top-up therefore converts the
user's ETH into USDC at the source price and back into ETH at the destination
price, so the amount credited on Unichain is the destination-market value of
what was bridged, capped by the requested amount:

- `TrestleCCIPBridge` swaps the incoming ETH with an exact-input swap bounded by
  `MAX_SQRT_RATIO - 1` (a zero price limit is rejected by Uniswap V3 with
  `SPL`) and enforces a slippage floor, `minUsdcPerEth`, that the owner can
  lower when the source market trades below it.
- `TrestleCCIPReceiver` sells the USDC it received with an exact-input swap and
  credits the ETH it actually bought. It never demands a fixed output, because
  reverting would strand the whole CCIP message. The surplus stays in the
  receiver (`requestSurplusWeth`).
- On a chain pair whose two markets agree (mainnet), the credited amount is the
  requested amount minus the CCIP fee and the AMM fee tier.

The deployed Unichain Sepolia pool also rejects the canonical
`MIN_SQRT_RATIO + 1` limit with `SPL`, so the receiver derives its price limit
from the pool's current price instead.

## Features

### Per‑User Configuration
- **Threshold & Target**: Each user can set their own balance threshold and target top‑up amount
- **Cooldown Period**: Configurable cooldown between spend attempts
- **Max Daily Spends**: User‑specific daily spend limits
- **Guard Subscriptions**: Per‑user refill request limits and cooldowns

### Core Contracts

#### TrestleSubAccount.sol
- Manages user sub‑accounts and their configurations
- Handles spend requests, top‑ups, and balance monitoring
- Supports cross‑chain bridge creditor integration

#### TrestleReactiveGuard.sol
- Watches sub‑account low‑balance events
- Requests authenticated callbacks to destination vaults
- Enforces daily refill limits and cooldown periods

#### TrestleCCIPBridge.sol
- Facilitates native ETH top‑ups across chains
- Manages bridge funding and fee reserves

#### TrestleMainVault.sol
- Main vault contract for receiving top‑up callbacks
- Configures reactive callback proxy and guard sender

#### TrestableCCIPReceiver.sol
- Receives CCIP messages for cross‑chain top‑ups
- Converts USDC to native ETH and credits sub‑accounts

### Scripts

The following scripts are provided for deployment and configuration:

#### Deployment Scripts (`scripts/`)
- `deploy-all.js` – Deploys all contracts in the correct order
- `deploy-subaccount.js` – Deploys TrestleSubAccount
- `deploy-mainvault.js` – Deploys TrestleMainVault
- `deploy-ccipbridge.js` – Deploys TrestleCCIPBridge
- `deploy-ccipreceiver.js` – Deploys TrestleCCIPReceiver
- `deploy-reactiveguard.js` – Deploys TrestleReactiveGuard

#### Configuration Scripts (`scripts/`)
- `setup-unichain.js` – Configures sub‑account on Unichain Sepolia
- `setup-baseSepolia.js` – Configures Base Sepolia contracts
- `setup-lasna.js` – Configures Lasna testnet contracts

### Environment Variables

#### Global Defaults (`.env`)
```bash
# Base Sepolia Configuration
BASE_SEPOLIA_RPC=https://sepolia.base.org
PRIVATE_KEY=your_private_key_here
VAULT_FUNDING_WEI=14000000000000000          # 0.014 ETH
BRIDGE_FEE_FUNDING_WEI=1000000000000000      # 0.001 ETH
CCIP_FEE_RESERVE_WEI=100000000000000         # 0.0001 ETH
CCIP_DESTINATION_GAS_LIMIT=500000
MAX_DAILY_REFILLS=10

# Unichain Sepolia Configuration
UNICHAIN_SEPOLIA_RPC=https://sepolia.unichain.org

# Lasna Testnet Configuration
LASNA_TESTNET_RPC=https://rpc.testnet.reactivenetwork.org
ORIGIN_CHAIN_ID=1301

# Reactive Guard & Callback
REACTIVE_CALLBACK_PROXY_BASE_SEPOLIA=0x476F44b11F5C942c58f4c8E3d0300E5710743585
REACTIVE_GUARD_ADDRESS=0x93b1152F710d325154bF7A095c7509DA173DA25F

# Sub‑Account Configuration
SUBACCOUNT_THRESHOLD_WEI=1000000000000000        # 0.000001 ETH
SUBACCOUNT_TARGET_WEI=10000000000000000         # 0.00001 ETH
SUBACCOUNT_COOLDOWN_SECONDS=300
SUBACCOUNT_MAX_DAILY_SPENDS=10
SUBACCOUNT_OPERATOR_ADDRESS=0x9280b24542a52cEE54a78dB65A497D8BeC4BAB94
```

#### Per‑User Overrides
```bash
# Example: Override settings for specific users
SUBACCOUNT_THRESHOLD_WEI_0x9280b24542a52cEE54a78dB65A497D8BeC4BAB94=2000000000000000
SUBACCOUNT_TARGET_WEI_0x9280b24542a52cEE54a78dB65A497D8BeC4BAB94=20000000000000000
MAX_DAILY_REFILLS_0x9280b24542a52cEE54a78dB65A497D8BeC4BAB94=5
```

### Development & Testing

#### Testing
```bash
# Run Foundry tests
forge test

# Check formatting
forge fmt --check

# Run Hardhat tests
npm test
```

#### Deployment
```bash
# Deploy to Base Sepolia
npm run deploy:baseSepolia

# Deploy to Unichain Sepolia
npm run deploy:unichainSepolia

# Deploy to Lasna Testnet
npm run deploy:lasna

# Deploy all contracts
npm run deploy:all
```

#### Configuration
```bash
# Configure Unichain sub‑account
subACCOUNT_OPERATOR_ADDRESS=0x9280b24542a52cEE54a78dB65A497D8BeC4BAB94
npm run setup:unichainSepolia

# Configure Base Sepolia contracts
npm run setup:baseSepolia

# Configure Lasna contracts
npm run setup:lasna
```

#### Explorer verification
```bash
# Verify the deployed contracts on each chain's explorer.
# Constructor arguments are read from contracts/deployments/*.json, so they always
# match the addresses that are actually live on-chain.
cd contracts
npx hardhat run scripts/verify-all.js --network baseSepolia      # Etherscan V2
npx hardhat run scripts/verify-all.js --network unichainSepolia  # Blockscout (async queue)
npx hardhat run scripts/verify-all.js --network lasnaTestnet     # Sourcify v2 (Reactscan)
```

## How It Works

### 1. Account Creation
1. **Sub‑Account Deployment**: `TrestleSubAccount` contract is deployed on Unichain Sepolia
2. **User Initialization**: Deployer creates a sub‑account configured with threshold, target, cooldown, and max daily spends
3. **Bridge Creditor Setup**: `TrestleCCIPReceiver` is authorized to credit the sub‑account

### 2. Guard Subscription
1. **Guard Deployment**: `TrestleReactiveGuard` watches the sub‑account contract for low‑balance events
2. **Origin Configuration**: Guard is configured to monitor the sub‑account contract on Unichain Sepolia
3. **Subscription Setup**: User subscribes to refill requests with daily limits

### 3. Cross‑Chain Flow
1. **Low Balance Detection**: User spends from sub‑account, balance falls below threshold
2. **Event Emission**: `LowBalanceDetected` event is emitted by `TrestleSubAccount`
3. **Guard React**: `TrestleReactiveGuard` detects the event and requests a callback
4. **CCIP Callback**: Callback is sent to Base Sepolia via CCIP
5. **Vault Funding**: `TrestleMainVault` receives native ETH and credits the sub‑account

## Architecture

### Contract Relationships
```
User (EOA) → TrestleSubAccount (Unichain Sepolia)
                     ↓
                 LowBalanceDetected Event
                     ↓ (Reactive System)
           TrestleReactiveGuard (Lasna)
                     ↓
                 Request Callback
                     ↓ (CCIP)
           TrestleCCIPBridge (Base Sepolia)
                     ↓
                 TrestleMainVault (Base Sepolia)
                     ↓
                Native ETH Top‑up
                     ↓
               TrestleSubAccount (Unichain Sepolia)
```

### Data Flow
1. **On‑Chain**: Smart contracts handle all logic and state
2. **Off‑Chain**: Frontend provides user interface and wallet integration
3. **Bridge**: CCIP enables cross‑chain communication
4. **Subscription**: Reactive System manages event subscriptions

## Security Considerations

### 1. Access Control
- All configuration changes require user wallet signature
- `updateConfig()` and `updateSubscription()` are only callable by the sub‑account owner
- Guard subscriptions are tied to specific addresses

### 2. Parameter Validation
- Contract code validates all thresholds, targets, cooldowns, and limits
- Minimum threshold prevents abuse
- Maximum daily limits prevent excessive requests

### 3. Network Isolation
- Guard only subscribes to events on the configured origin chain
- No cross‑RPC reads (each script uses its network\'s RPC)
- Clear separation between different testnet environments

## Future Enhancements

### 1. Multi‑User Support
- Extend to support multiple users per sub‑account
- Role‑based access control
- Multi‑signature configurations

### 2. Advanced Configuration
- Time‑based threshold adjustments
- Dynamic target calculation
- Integration with external price feeds

### 3. Extended Guard Features
- Conditional subscription rules
- Event filtering
- Custom callback recipients

## Support

For support, questions, or feature requests:
- **GitHub Issues**: [Trestle-DeFi/trestle-setforget-contracts](https://github.com/Trestle-DeFi/trestle-setforget-contracts)
- **Telegram**: [trestleDeFi](https://t.me/trestleDeFi)
- **Website**: [https://trestle.website](https://trestle.website)

## License

This project is part of the Reactive Omni Buildathon. See individual contract files for specific licenses.
