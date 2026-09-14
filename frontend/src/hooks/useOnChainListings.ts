import { useState, useEffect, useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { DIGITAL_GOODS_ABI, FREELANCER_ESCROW_ABI, DIGITAL_RWA_ABI } from "../config/abis";
import { CONTRACT_ADDRESSES, type ContractName } from "../config/contracts";

export type OnChainListing = {
  id: string;
  contract: ContractName;
  chainId: number;
  title: string;
  description: string;
  price: string;
  priceFormatted: string;
  seller: string;
  status: "active" | "sold" | "cancelled" | "disputed" | "refunded";
  pricing: "fixed" | "dutch_auction";
  category: string;
  createdAt: number;
};

const LISTING_STATUS: Record<number, OnChainListing["status"]> = {
  0: "active",
  1: "sold",
  2: "cancelled",
  3: "disputed",
  4: "refunded",
};

const PROJECT_STATUS: Record<number, OnChainListing["status"]> = {
  0: "active",
  1: "sold",
  2: "cancelled",
  3: "disputed",
  4: "refunded",
};

async function readDigitalGoods(
  publicClient: any,
  chainId: number,
): Promise<OnChainListing[]> {
  const address = CONTRACT_ADDRESSES[chainId]?.DigitalGoods;
  if (!address) return [];

  try {
    const count = await publicClient.readContract({
      address,
      abi: DIGITAL_GOODS_ABI,
      functionName: "listingCount",
    });

    const total = Number(count);
    if (total === 0) return [];

    const BATCH = 20;
    const listings: OnChainListing[] = [];

    for (let start = 1; start <= total; start += BATCH) {
      const end = Math.min(start + BATCH - 1, total);
      const calls = [];
      for (let i = start; i <= end; i++) {
        calls.push(
          publicClient.readContract({
            address,
            abi: DIGITAL_GOODS_ABI,
            functionName: "listings",
            args: [BigInt(i)],
          })
        );
      }
      const results = await Promise.allSettled(calls);
      for (const r of results) {
        if (r.status === "fulfilled") {
          const l = r.value;
          listings.push({
            id: `dg-${chainId}-${l.id}`,
            contract: "DigitalGoods",
            chainId,
            title: l.metadataURI.split("/").pop() || `Listing #${l.id}`,
            description: l.metadataURI,
            price: l.price.toString(),
            priceFormatted: formatUnits(l.price, 18),
            seller: l.seller,
            status: LISTING_STATUS[l.status] || "active",
            pricing: l.pricing === 0 ? "fixed" : "dutch_auction",
            category: l.category || "",
            createdAt: Number(l.createdAt),
          });
        }
      }
    }
    return listings;
  } catch {
    return [];
  }
}

async function readFreelancerEscrow(
  publicClient: any,
  chainId: number,
): Promise<OnChainListing[]> {
  const address = CONTRACT_ADDRESSES[chainId]?.FreelancerEscrow;
  if (!address) return [];

  try {
    const projectCount = await publicClient.readContract({
      address,
      abi: FREELANCER_ESCROW_ABI,
      functionName: "projectCount",
    });

    const gigCount = await publicClient.readContract({
      address,
      abi: FREELANCER_ESCROW_ABI,
      functionName: "gigCount",
    });

    const totalProjects = Number(projectCount);
    const totalGigs = Number(gigCount);
    const listings: OnChainListing[] = [];

    // Read projects
    const BATCH = 10;
    for (let start = 1; start <= totalProjects; start += BATCH) {
      const end = Math.min(start + BATCH - 1, totalProjects);
      const calls = [];
      for (let i = start; i <= end; i++) {
        calls.push(
          publicClient.readContract({
            address,
            abi: FREELANCER_ESCROW_ABI,
            functionName: "projects",
            args: [BigInt(i)],
          })
        );
      }
      const results = await Promise.allSettled(calls);
      for (const r of results) {
        if (r.status === "fulfilled") {
          const p = r.value;
          listings.push({
            id: `fe-${chainId}-${p.id}`,
            contract: "FreelancerEscrow",
            chainId,
            title: p.title || `Project #${p.id}`,
            description: p.descriptionURI,
            price: p.totalBudget.toString(),
            priceFormatted: formatUnits(p.totalBudget, 18),
            seller: p.client,
            status: PROJECT_STATUS[p.status] || "active",
            pricing: p.pricing === 0 ? "fixed" : "dutch_auction",
            category: "freelance",
            createdAt: Number(p.createdAt),
          });
        }
      }
    }

    // Read gigs
    for (let start = 1; start <= totalGigs; start += BATCH) {
      const end = Math.min(start + BATCH - 1, totalGigs);
      const calls = [];
      for (let i = start; i <= end; i++) {
        calls.push(
          publicClient.readContract({
            address,
            abi: FREELANCER_ESCROW_ABI,
            functionName: "gigs",
            args: [BigInt(i)],
          })
        );
      }
      const results = await Promise.allSettled(calls);
      for (const r of results) {
        if (r.status === "fulfilled") {
          const g = r.value;
          if (!g.active) continue;
          listings.push({
            id: `gig-${chainId}-${g.id}`,
            contract: "FreelancerEscrow",
            chainId,
            title: g.title || `Gig #${g.id}`,
            description: g.descriptionURI,
            price: g.price.toString(),
            priceFormatted: formatUnits(g.price, 18),
            seller: g.freelancer,
            status: "active",
            pricing: "fixed",
            category: "gig",
            createdAt: 0,
          });
        }
      }
    }

    return listings;
  } catch {
    return [];
  }
}

async function readDigitalRWA(
  publicClient: any,
  chainId: number,
): Promise<OnChainListing[]> {
  const address = CONTRACT_ADDRESSES[chainId]?.DigitalRWA;
  if (!address) return [];

  try {
    const [infoSet, info, price, supply, cap] = await Promise.all([
      publicClient.readContract({ address, abi: DIGITAL_RWA_ABI, functionName: "assetInfoSet" }),
      publicClient.readContract({ address, abi: DIGITAL_RWA_ABI, functionName: "assetInfo" }),
      publicClient.readContract({ address, abi: DIGITAL_RWA_ABI, functionName: "currentPrice" }),
      publicClient.readContract({ address, abi: DIGITAL_RWA_ABI, functionName: "totalSupply" }),
      publicClient.readContract({ address, abi: DIGITAL_RWA_ABI, functionName: "cap" }),
    ]);

    if (!infoSet) return [];

    return [{
      id: `rwa-${chainId}`,
      contract: "DigitalRWA",
      chainId,
      title: info.name || "RWA Token",
      description: info.description || "",
      price: price.toString(),
      priceFormatted: formatUnits(price, 18),
      seller: address,
      status: "active",
      pricing: "fixed",
      category: "rwa",
      createdAt: 0,
    }];
  } catch {
    return [];
  }
}

export function useOnChainListings() {
  const { chain } = useAccount();
  const publicClient = usePublicClient();
  const [listings, setListings] = useState<OnChainListing[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchListings = useCallback(async () => {
    if (!publicClient || !chain) return;
    setLoading(true);
    try {
      const [dg, fe, rwa] = await Promise.all([
        readDigitalGoods(publicClient, chain.id),
        readFreelancerEscrow(publicClient, chain.id),
        readDigitalRWA(publicClient, chain.id),
      ]);
      setListings([...dg, ...fe, ...rwa]);
    } catch {
      setListings([]);
    }
    setLoading(false);
  }, [publicClient, chain]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  return { listings, loading, refetch: fetchListings };
}

export function useOnChainListingsForChain(chainId: number) {
  const publicClient = usePublicClient({ chainId });
  const [listings, setListings] = useState<OnChainListing[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchListings = useCallback(async () => {
    if (!publicClient) return;
    setLoading(true);
    try {
      const [dg, fe, rwa] = await Promise.all([
        readDigitalGoods(publicClient, chainId),
        readFreelancerEscrow(publicClient, chainId),
        readDigitalRWA(publicClient, chainId),
      ]);
      setListings([...dg, ...fe, ...rwa]);
    } catch {
      setListings([]);
    }
    setLoading(false);
  }, [publicClient, chainId]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  return { listings, loading, refetch: fetchListings };
}
