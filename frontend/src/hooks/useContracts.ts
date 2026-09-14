import { useAccount, useBalance, useReadContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import { CHAIN_CONFIG, SUPPORTED_CHAIN_IDS } from "../config/contracts";

const ERC20_ABI = [
  { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

export function useContracts() {
  const { address, isConnected, chain } = useAccount();
  const chainId = chain?.id ?? CHAIN_CONFIG.amoy.id;
  const { data: native } = useBalance({ address });

  const isCorrectChain = (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);

  const chainKey = Object.keys(CHAIN_CONFIG).find(k => CHAIN_CONFIG[k as keyof typeof CHAIN_CONFIG].id === chainId);
  const chainName = chainKey
    ? CHAIN_CONFIG[chainKey as keyof typeof CHAIN_CONFIG].name
    : "Unsupported";
  const explorer = chainKey
    ? CHAIN_CONFIG[chainKey as keyof typeof CHAIN_CONFIG].explorer
    : "";

  return {
    address,
    isConnected,
    isCorrectChain,
    chainId,
    chainName,
    explorer,
    balance: native ? formatUnits(native.value, native.decimals) : "0",
  };
}
