/**
 * functionSelectors.ts — 4-byte function selector → (contract, signature) dictionary.
 *
 * Built once from our own ABIs (src/lib/abis), not from BaseScan — our contracts aren't
 * verified/labeled there, so raw calls show up as a bare selector like "0x9463c17d" with
 * no name attached. This makes every selector we know about self-documenting, which matters
 * once Normie wallets start calling these functions directly instead of only the relayer:
 * anyone reading a tx on BaseScan can look the selector up here to see what it actually does.
 */

import { toFunctionSelector } from "viem";
import * as abis from "./abis";

export interface SelectorInfo {
  contractName: string;
  functionName: string;
  signature:    string; // e.g. "publish(string,uint256,uint256,uint256)"
}

let _map: Map<string, SelectorInfo> | null = null;

function buildMap(): Map<string, SelectorInfo> {
  const map = new Map<string, SelectorInfo>();
  for (const [exportName, abi] of Object.entries(abis)) {
    if (!Array.isArray(abi)) continue;
    const contractName = exportName.replace(/Abi$/, "");
    for (const item of abi as Array<{ type: string; name: string; inputs: Array<{ type: string }> }>) {
      if (item.type !== "function") continue;
      const signature = `${item.name}(${item.inputs.map(i => i.type).join(",")})`;
      try {
        const selector = toFunctionSelector(signature);
        map.set(selector, { contractName, functionName: item.name, signature });
      } catch { /* skip malformed entries */ }
    }
  }
  return map;
}

function getMap(): Map<string, SelectorInfo> {
  if (!_map) _map = buildMap();
  return _map;
}

/** Looks up a 4-byte selector (e.g. "0x9463c17d") against every known ANA contract ABI. */
export function decodeSelector(selector: string): SelectorInfo | null {
  return getMap().get(selector.toLowerCase()) ?? null;
}

/** The first 4 bytes (10 hex chars incl. "0x") of a tx's calldata is its function selector. */
export function selectorFromCalldata(data: string): string {
  return data.slice(0, 10).toLowerCase();
}

export function listAllSelectors(): SelectorInfo[] {
  return [...getMap().values()];
}
