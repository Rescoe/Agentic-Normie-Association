/**
 * Contract ABIs and address resolution.
 * ABIs are generated directly from Hardhat artifacts — no parseAbi, no string stubs.
 */

import { keccak256, stringToBytes } from "viem";

export {
  AssociationCoreAbi     as ASSOCIATION_CORE_ABI,
  ConstituentAssemblyAbi as CONSTITUENT_ASSEMBLY_ABI,
  WorkRegistryAbi        as WORK_REGISTRY_ABI,
  FactoryRegistryAbi     as FACTORY_REGISTRY_ABI,
  GovernanceCalendarAbi  as GOVERNANCE_CALENDAR_ABI,
  CollectionFactoryAbi   as COLLECTION_FACTORY_ABI,
  NormieCollectionAbi    as NORMIE_COLLECTION_ABI,
  ANAEditionsAbi         as ANA_EDITIONS_ABI,
  ANACollectionFactoryAbi as ANA_COLLECTION_FACTORY_ABI,
} from "./abis";

// ─── Addresses (from environment) ────────────────────────────────────────────

export const CONTRACT_ADDRESSES = {
  AssociationCore:       process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS       ?? "",
  ConstituentAssembly:   process.env.NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS   ?? "",
  WorkRegistry:          process.env.NEXT_PUBLIC_WORK_REGISTRY_ADDRESS          ?? "",
  FactoryRegistry:       process.env.NEXT_PUBLIC_FACTORY_REGISTRY_ADDRESS       ?? "",
  GovernanceCalendar:    process.env.NEXT_PUBLIC_GOVERNANCE_CALENDAR_ADDRESS    ?? "",
  TreasuryModule:        process.env.NEXT_PUBLIC_TREASURY_MODULE_ADDRESS        ?? "",
  CollectionFactory:     process.env.NEXT_PUBLIC_COLLECTION_FACTORY_ADDRESS     ?? "",
  ANACollectionFactory:  process.env.NEXT_PUBLIC_ANA_COLLECTION_FACTORY_ADDRESS ?? "",
} as const;

// ─── Role constants (mirrors Roles.sol) ───────────────────────────────────────

// keccak256(stringToBytes("X")) === keccak256(abi.encodePacked("X")) in Solidity.
export const ROLES = {
  PRESIDENT:      keccak256(stringToBytes("PRESIDENT")),
  VICE_PRESIDENT: keccak256(stringToBytes("VICE_PRESIDENT")),
  SECRETARY:      keccak256(stringToBytes("SECRETARY")),
  AUTHOR:         keccak256(stringToBytes("AUTHOR")),
  CURATOR:        keccak256(stringToBytes("CURATOR")),
  RAPPORTEUR:     keccak256(stringToBytes("RAPPORTEUR")),
} as const;

export const ROLE_LABELS: Record<string, string> = {
  [ROLES.PRESIDENT]:      "Président",
  [ROLES.VICE_PRESIDENT]: "Vice-Président / Trésorier",
  [ROLES.SECRETARY]:      "Secrétaire",
  [ROLES.AUTHOR]:         "Auteur",
  [ROLES.CURATOR]:        "Curateur",
  [ROLES.RAPPORTEUR]:     "Rapporteur",
};

export const ACTION_REGISTER = keccak256(stringToBytes("REGISTER"));
