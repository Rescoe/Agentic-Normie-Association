/**
 * baseRpc.ts — shared Base mainnet RPC transport with automatic failover.
 *
 * BASE_RPC_URL has been the app's only configured endpoint, and it was set to
 * the free public https://mainnet.base.org — which rate-limits under the load
 * the constituent assembly's vote flow generates (confirmed live: this is
 * what silently killed every vote attempt before the admin panel's error was
 * fixed to actually surface it). viem's fallback() transport tries each URL
 * in order and moves to the next on failure or rate-limit, so one flaky or
 * throttled provider doesn't take every on-chain read/write down with it.
 *
 * Configure BASE_RPC_URL as the primary — ideally a real provider key
 * (Coinbase Developer Platform, Alchemy, Infura, QuickNode all support Base),
 * not the bare public endpoint. BASE_RPC_URL_2 / BASE_RPC_URL_3 are optional
 * extra backups, tried in order before the free public fallbacks below.
 */
import { fallback, http, type Transport } from "viem";

// Different operators than Base's own public node, so they don't share its
// rate-limit bucket — a reasonable last resort, but still free/public and
// not a substitute for a real provider key in BASE_RPC_URL.
const FREE_PUBLIC_FALLBACKS = [
  "https://base.publicnode.com",
  "https://base.drpc.org",
  "https://mainnet.base.org",
];

function configuredUrls(): string[] {
  return [
    process.env.BASE_RPC_URL,
    process.env.BASE_RPC_URL_2,
    process.env.BASE_RPC_URL_3,
  ].filter((u): u is string => !!u);
}

/** Base mainnet transport, trying configured URLs first, then free public fallbacks. */
export function baseRpcTransport(timeoutMs = 30_000): Transport {
  const urls = [...new Set([...configuredUrls(), ...FREE_PUBLIC_FALLBACKS])];
  return fallback(urls.map((u) => http(u, { timeout: timeoutMs })));
}
