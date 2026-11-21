# Trestle Set & Forget Contracts

## Overview

This repository contains smart contracts for the Trestle Set & Forget system, enabling configurable per‑user sub‑account management with guard subscriptions and cross‑chain capabilities.

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
REACTIVE_GUARD_ADDRESS=0x27fcAdD5142ECB1b6FC13314a2bDfB71dC92CeF3

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
