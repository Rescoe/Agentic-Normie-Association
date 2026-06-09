# Modèle d'attestation cross-chain — ANA

## Contexte

- **Normies** : ERC-721 déployé sur **Ethereum mainnet**
- **ANA** : déployé sur **Base (L2)**

On ne peut pas appeler `ownerOf(tokenId)` directement depuis un contrat Base sur le contrat Normies mainnet.
Nous utilisons un **relayer signataire** qui atteste l'ownership off-chain et produit une signature vérifiable on-chain.

---

## Principe

```
Ethereum mainnet                Backend ANA (relayer)              Base
─────────────────               ──────────────────────             ──────────────────
NormiesERC721                   AttestationRelayer                 AssociationCore
ownerOf(tokenId) ────────────► vérifie ownership ───────────────► vérifie signature
                  (RPC mainnet  signe attestation EIP-712          enregistre membre
                   ou API       retourne sig + struct
                   Normies)
```

**L'adresse du relayer est stockée dans AssociationCore.**
C'est la seule source de confiance dans ce modèle.

---

## Structure de l'attestation (EIP-712)

```solidity
struct OwnershipAttestation {
    uint256 tokenId;      // ID du Normie
    address owner;        // adresse détenteur sur mainnet (= futur msg.sender sur Base)
    uint256 validUntil;   // expiration courte (ex : now + 10 minutes)
    uint256 nonce;        // nonce unique contre le replay
}
```

**TypeHash EIP-712 :**
```solidity
bytes32 constant ATTESTATION_TYPEHASH = keccak256(
    "OwnershipAttestation(uint256 tokenId,address owner,uint256 validUntil,uint256 nonce)"
);
```

---

## Flow complet d'inscription

```
1. User connecte son wallet sur Base (MetaMask, etc.)
   wallet.address = 0xUSER

2. Frontend → POST /api/attest
   body: { tokenId: 42, userAddress: "0xUSER" }

3. Backend (relayer) :
   a. Appelle ownerOf(42) sur mainnet via RPC Ethereum
      OU appelle API Normies : GET /normies/owner/42
   b. Vérifie : owner == userAddress
   c. Si OK : génère attestation {tokenId:42, owner:0xUSER, validUntil: now+10min, nonce: random}
   d. Signe le hash EIP-712 de l'attestation avec la clé privée du relayer
   e. Retourne : { attestation, signature }

4. Frontend → transaction sur Base :
   AssociationCore.register(tokenId, attestation, signature)
   tx.from = 0xUSER (même adresse que dans l'attestation)

5. AssociationCore.register() vérifie :
   a. attestation.owner == msg.sender                           ← même wallet
   b. block.timestamp < attestation.validUntil                 ← pas expirée
   c. !usedNonces[attestation.nonce]                           ← pas de replay
   d. ECDSA.recover(EIP712digest, signature) == relayerAddress ← sig valide
   → Si tout OK : usedNonces[nonce] = true + members[tokenId] = Member(msg.sender, ...)
```

---

## AssociationCore — nouveau register()

```solidity
function register(
    uint256 tokenId,
    OwnershipAttestation calldata attestation,
    bytes calldata signature
) external {
    require(!members[tokenId].active, "Already registered");
    require(attestation.owner == msg.sender, "Sender != attested owner");
    require(attestation.tokenId == tokenId, "TokenId mismatch");
    require(block.timestamp < attestation.validUntil, "Attestation expired");
    require(!usedNonces[attestation.nonce], "Nonce already used");

    bytes32 structHash = keccak256(abi.encode(
        ATTESTATION_TYPEHASH,
        attestation.tokenId,
        attestation.owner,
        attestation.validUntil,
        attestation.nonce
    ));
    bytes32 digest = _hashTypedDataV4(structHash);
    address signer = ECDSA.recover(digest, signature);
    require(signer == relayerAddress, "Invalid relayer signature");

    usedNonces[attestation.nonce] = true;
    members[tokenId] = Member({
        owner: msg.sender,
        registeredAt: block.timestamp,
        active: true
    });
    memberTokenIds.push(tokenId);

    emit MemberRegistered(tokenId, msg.sender, block.timestamp);
}
```

---

## Vote — pas d'attestation nécessaire

Après l'inscription, `members[tokenId].owner` est stocké dans le Core.
Pour voter, le contrat vérifie simplement :
```solidity
require(msg.sender == core.members(voterTokenId).owner, "Not the registered owner");
```

Pas de nouvel appel cross-chain, pas d'attestation supplémentaire.

**Conséquence (snapshot semantics) :** si le Normie est transféré après l'inscription, le nouveau détenteur ne peut pas voter — l'ancien détenteur le peut encore (jusqu'à la clôture de l'assemblée). C'est intentionnel pour le MVP : l'assemblée constituante est un moment figé dans le temps.

---

## Backend — AttestationRelayer

**Chemin** : `src/server/relayer/attestationRelayer.ts`

```typescript
// Clé privée du relayer (en .env, JAMAIS dans le code)
// RELAYER_PRIVATE_KEY=0x...

export async function createOwnershipAttestation(
  tokenId: number,
  userAddress: string
): Promise<{ attestation: OwnershipAttestation; signature: string }> {

  // 1. Vérifier ownership
  const owner = await getOwnerOnMainnet(tokenId)
  // OU : const owner = await fetchNormiesApiOwner(tokenId)

  if (owner.toLowerCase() !== userAddress.toLowerCase()) {
    throw new Error("Address does not own this Normie")
  }

  // 2. Construire l'attestation
  const attestation: OwnershipAttestation = {
    tokenId,
    owner: userAddress,
    validUntil: Math.floor(Date.now() / 1000) + 600, // +10 minutes
    nonce: generateSecureNonce(),
  }

  // 3. Signer EIP-712
  const signature = await signEIP712Attestation(attestation)

  return { attestation, signature }
}
```

**Route API Next.js :**
```
POST /api/attest
Body: { tokenId: number, userAddress: string }
Response: { attestation: OwnershipAttestation, signature: string }
```

---

## Sécurité du modèle

### Protections en place
| Menace | Protection |
|--------|-----------|
| Replay d'une attestation | `nonce` unique + `usedNonces` mapping dans le contrat |
| Attestation périmée | `validUntil` court (10 min) |
| Fausse attestation | Signature ECDSA de la clé relayer |
| Quelqu'un inscrit le Normie d'autrui | `attestation.owner == msg.sender` + tx signée par le vrai owner |
| Clé relayer compromise | L'owner du contrat peut changer `relayerAddress` via `setRelayer()` |

### Limite principale : centralisation du relayer
Le relayer est un point de confiance centralisé (notre backend).
Un relayer compromis peut inscrire de faux membres.

**Mitigation MVP :** clé relayer dans une variable d'environnement sécurisée, non exposée, rotation possible.

**Post-MVP :** migrer vers EAS (Ethereum Attestation Service) sur Base — schéma d'attestation public, vérifiable par n'importe qui, sans dépendre de notre backend.

---

## Configuration requise

```env
# Backend
RELAYER_PRIVATE_KEY=0x...          # clé privée du compte relayer
ETH_MAINNET_RPC_URL=https://...    # RPC Ethereum mainnet (Infura, Alchemy, public)
NORMIES_CONTRACT_ADDRESS=0x...     # adresse ERC-721 Normies sur mainnet

# Contrat AssociationCore sur Base
RELAYER_ADDRESS=0x...              # adresse publique correspondant à RELAYER_PRIVATE_KEY
```

---

## Ce que AssociationCore ne fait PAS

- Il ne connaît pas l'adresse du contrat Normies sur mainnet
- Il ne fait aucun appel externe
- Il ne dépend d'aucun oracle
- Il vérifie uniquement une signature ECDSA et quelques invariants simples

C'est précisément ce qui le rend simple, auditable, et immuable.
