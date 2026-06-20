/**
 * useAttestation.ts
 *
 * React hook that drives the full registration flow:
 *   1. Call POST /api/attest to get a signed EIP-712 attestation
 *   2. Submit the attestation to AssociationCore.register() via wagmi
 *
 * Usage:
 *   const { register, status, error } = useAttestation();
 *   await register(tokenId);
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "./contracts";
import { logTxClient, confirmTxClient } from "./txLogClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RegistrationStatus =
  | "idle"
  | "requesting_attestation"
  | "awaiting_signature"   // wallet popup
  | "pending_tx"           // tx submitted, waiting for receipt
  | "success"
  | "error";

interface AttestationResponse {
  attestation: {
    tokenId:               string;
    ownerAddress:          string;
    targetChainId:         string;
    targetAssociationCore: string;
    action:                string;
    nonce:                 string;
    deadline:              string;
  };
  signature: `0x${string}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAttestation() {
  const { address } = useAccount();
  const [status, setStatus] = useState<RegistrationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const { writeContractAsync } = useWriteContract();

  const { isSuccess: txConfirmed, data: receipt } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  useEffect(() => {
    if (txConfirmed && txHash) confirmTxClient(txHash, Number(receipt?.blockNumber));
  }, [txConfirmed, txHash, receipt]);

  const register = useCallback(
    async (tokenId: number) => {
      if (!address) {
        setError("Wallet not connected");
        setStatus("error");
        return;
      }

      setError(null);
      setStatus("requesting_attestation");

      // Step 1: Request attestation from relayer
      let data: AttestationResponse;
      try {
        const res = await fetch("/api/attest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenId, ownerAddress: address }),
        });

        if (!res.ok) {
          const { error: msg } = await res.json();
          throw new Error(msg ?? `Relayer error (HTTP ${res.status})`);
        }

        data = await res.json();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to get attestation";
        setError(msg);
        setStatus("error");
        return;
      }

      // Step 2: Submit register() transaction
      setStatus("awaiting_signature");

      // Deserialize bigint fields from decimal strings
      const attestation = {
        tokenId:               BigInt(data.attestation.tokenId),
        ownerAddress:          data.attestation.ownerAddress as `0x${string}`,
        targetChainId:         BigInt(data.attestation.targetChainId),
        targetAssociationCore: data.attestation.targetAssociationCore as `0x${string}`,
        action:                data.attestation.action as `0x${string}`,
        nonce:                 BigInt(data.attestation.nonce),
        deadline:              BigInt(data.attestation.deadline),
      };

      try {
        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
          abi: ASSOCIATION_CORE_ABI,
          functionName: "register",
          args: [attestation, data.signature],
        });

        setTxHash(hash);
        setStatus("pending_tx");
        logTxClient({
          txHash: hash, type: "register", contractName: "AssociationCore",
          functionName: "register", fromAddress: address,
          targetAddress: CONTRACT_ADDRESSES.AssociationCore, relatedTokenId: tokenId,
        });
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Transaction failed";
        // User rejected the wallet popup — distinguish from real errors
        if (msg.includes("rejected") || msg.includes("denied") || msg.includes("cancel")) {
          setError("Transaction cancelled");
        } else {
          setError(msg);
        }
        setStatus("error");
      }
    },
    [address, writeContractAsync]
  );

  // Promote to success once tx is confirmed
  const finalStatus: RegistrationStatus =
    txConfirmed && status === "pending_tx" ? "success" : status;

  return {
    register,
    status: finalStatus,
    error,
    txHash,
  };
}
