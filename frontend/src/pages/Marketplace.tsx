import { useState, useMemo } from "react";
import { useContracts } from "../hooks/useContracts";
import { useOnChainListings, type OnChainListing } from "../hooks/useOnChainListings";
import { LINKS, CONTRACT_ADDRESSES } from "../config/contracts";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  sold: "Sold",
  cancelled: "Cancelled",
  disputed: "Disputed",
  refunded: "Refunded",
};

const CONTRACT_LABELS: Record<string, string> = {
  DigitalGoods: "Marketplace",
  FreelancerEscrow: "Freelance",
  DigitalRWA: "RWA",
};

const PRICING_LABELS: Record<string, string> = {
  fixed: "Fixed",
  dutch_auction: "Dutch Auction",
};

export default function Marketplace() {
  const { isConnected, isCorrectChain, chainId, explorer } = useContracts();
  const { listings, loading } = useOnChainListings();
  const [filter, setFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return listings;
    if (filter === "active") return listings.filter(l => l.status === "active");
    if (filter === "fixed") return listings.filter(l => l.pricing === "fixed");
    if (filter === "dutch") return listings.filter(l => l.pricing === "dutch_auction");
    if (filter === "marketplace") return listings.filter(l => l.contract === "DigitalGoods");
    if (filter === "freelance") return listings.filter(l => l.contract === "FreelancerEscrow");
    if (filter === "rwa") return listings.filter(l => l.contract === "DigitalRWA");
    return listings;
  }, [listings, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Marketplace</h2>
        <a
          href={LINKS.testnet}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-emerald-600 hover:underline"
        >
          Open Testnet Hub
        </a>
      </div>

      {!isConnected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 text-center">
          Connect wallet to interact. Browse freely below.
        </div>
      )}

      {isConnected && !isCorrectChain && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-xs text-red-700">Switch to a supported testnet to interact.</p>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { id: "all", label: "All" },
          { id: "active", label: "Active" },
          { id: "marketplace", label: "Goods" },
          { id: "freelance", label: "Freelance" },
          { id: "rwa", label: "RWA" },
          { id: "fixed", label: "Fixed" },
          { id: "dutch", label: "Dutch" },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
              filter === f.id ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading on-chain data...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
          <p className="text-sm">No listings on this chain yet</p>
          <a
            href={LINKS.testnet}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-3 text-xs text-emerald-600 hover:underline"
          >
            Create listing on Testnet Hub
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <ListingCard key={item.id} item={item} explorer={explorer} isConnected={isConnected} isCorrectChain={isCorrectChain} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListingCard({ item, explorer, isConnected, isCorrectChain }: {
  item: OnChainListing;
  explorer: string;
  isConnected: boolean;
  isCorrectChain: boolean;
}) {
  const contractAddr = CONTRACT_ADDRESSES[item.chainId]?.[item.contract];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-sm">{item.title}</h4>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              item.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
            }`}>
              {STATUS_LABELS[item.status] || item.status}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
              {CONTRACT_LABELS[item.contract] || item.contract}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
              {PRICING_LABELS[item.pricing] || item.pricing}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1 truncate">{item.description}</p>
          {item.category && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 mt-1 inline-block">
              {item.category}
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-emerald-600">
            {item.priceFormatted} {item.chainId === 137 || item.chainId === 80002 ? "POL" : "ETH"}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">
            {item.seller.slice(0, 6)}...{item.seller.slice(-4)}
          </p>
        </div>
      </div>
      {item.status === "active" && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-gray-400">
            Chain {item.chainId} {contractAddr ? `· ${contractAddr.slice(0, 6)}...${contractAddr.slice(-4)}` : ""}
          </span>
          {isConnected && isCorrectChain ? (
            <a
              href={`${explorer}/address/${item.seller}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition"
            >
              View Seller
            </a>
          ) : (
            <span className="text-xs text-gray-400">Connect to interact</span>
          )}
        </div>
      )}
    </div>
  );
}
