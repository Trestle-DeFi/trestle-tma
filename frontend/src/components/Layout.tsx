import { Outlet, NavLink } from "react-router-dom";
import { useContracts } from "../hooks/useContracts";
import { LINKS } from "../config/contracts";
import WalletStatus from "./WalletStatus";
import { Icon } from "./Icon";
import AstraChat from "./AstraChat";

const EXTERNAL_LINKS = [
  { href: LINKS.mainSite, label: "Landing Page" },
  { href: LINKS.testnet, label: "Testnet Hub" },
];

const DASHBOARD_TABS = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/marketplace", label: "Marketplace", icon: "marketplace" },
  { to: "/stake", label: "Stake", icon: "stake" },
  { to: "/tasks", label: "Tasks", icon: "tasks" },
  { to: "/bounty", label: "Bounty", icon: "bounty" },
  { to: "/verify", label: "Verify", icon: "verify" },
  { to: "/withdraw", label: "Wallet", icon: "wallet" },
];

export default function Layout() {
  const { isCorrectChain, chainName } = useContracts();

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <h1 className="text-xl font-bold text-emerald-600 flex items-center gap-2">
              <Icon name="logo" size={24} />
              Trestle
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1">
              {EXTERNAL_LINKS.map(link => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-emerald-600 transition px-2 py-1 rounded border border-gray-200 hover:border-emerald-300"
                >
                  {link.label}
                </a>
              ))}
            </div>
            <WalletStatus />
            <a
              href={LINKS.telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-emerald-600 transition"
              title="Telegram"
            >
              <Icon name="telegram" size={18} />
            </a>
          </div>
        </div>
        {!isCorrectChain && (
          <div className="mt-2 p-2 bg-red-100 text-red-700 text-sm rounded text-center">
            Switch to a supported testnet
          </div>
        )}
        {isCorrectChain && (
          <div className="mt-1 text-xs text-gray-400 text-center">{chainName}</div>
        )}
      </header>

      <div className="sticky top-0 z-40 bg-white/70 backdrop-blur-md border-b border-gray-100 overflow-x-auto">
        <div className="max-w-lg mx-auto flex gap-1 px-2 py-1.5">
          {DASHBOARD_TABS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className="whitespace-nowrap px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors [&.active]:text-emerald-700 [&.active]:bg-emerald-100 [&.active]:font-semibold flex items-center gap-1"
            >
              <Icon name={icon} size={14} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <main className="flex-1 max-w-lg mx-auto w-full px-4 pt-4 pb-8">
        <Outlet />
      </main>
      <AstraChat />
    </div>
  );
}
