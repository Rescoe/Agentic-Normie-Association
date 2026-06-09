# Architecture Contractuelle Solidity — ANA

## Principe directeur

```
Ethereum mainnet                Base (L2)
────────────────                ─────────────────────────────────────────────
NormiesERC721                   AssociationCore (immuable, minimal)
ownerOf(tokenId)                    ↑ lit / autorise
      │                         ConstituentAssembly  ←→  FactoryRegistry
      ▼                             ↓ écrit rôles            ↓ référence
Backend Relayer                 AssociationCore          CreativeModuleFactory
signe attestation EIP-712                                    ↓ déploie
      │                                                  WorkRegistry
      ▼
register(tokenId, attestation, sig)
      │
      ▼
AssociationCore.register() vérifie sig + enregistre
```

**L'association survit au redéploiement de tout module périphérique.**
Le seul contrat qu'on ne rédeploiera jamais : `AssociationCore`.

**Cross-chain :** pas de ownerOf direct mainnet→Base. Un relayer signataire atteste l'ownership off-chain. Le contrat ne fait que vérifier la signature ECDSA. Voir `docs/attestation-model.md`.

---

## Contrats MVP

### 1. `AssociationCore`
**Chemin** : `contracts/core/AssociationCore.sol`
**Rôle** : registre canonique immuable de l'association

**Storage**
```solidity
// --- Attestation cross-chain ---
struct OwnershipAttestation {
    uint256 tokenId;      // ID du Normie (mainnet)
    address owner;        // détenteur sur mainnet = msg.sender attendu sur Base
    uint256 validUntil;   // expiration (ex : now + 10 min)
    uint256 nonce;        // anti-replay
}

bytes32 constant ATTESTATION_TYPEHASH = keccak256(
    "OwnershipAttestation(uint256 tokenId,address owner,uint256 validUntil,uint256 nonce)"
);

address public relayerAddress;               // seul signataire d'attestations autorisé
mapping(uint256 nonce => bool) public usedNonces;

// --- Membres ---
struct Member {
    address owner;          // adresse au moment de l'inscription (sur Base)
    uint256 registeredAt;   // block.timestamp
    bool active;
}

// --- Rôles ---
struct RoleAssignment {
    uint256 tokenId;        // Normie élu
    address holder;         // owner au moment de l'élection
    uint256 assignedAt;
}

// --- Association ---
string public name;                // "Agentic Normie Association"
string public symbol;              // "ANA"
bytes32 public constitutionHash;   // CIDv1 de la constitution (IPFS)
uint256 public foundedAt;
// NOTE : plus de normiesContract — on ne fait pas de ownerOf cross-chain

mapping(uint256 tokenId => Member) public members;
uint256[] public memberTokenIds;

mapping(bytes32 role => RoleAssignment) public roles;
mapping(address module => bool) public authorizedModules;
```

**Interface publique**
```solidity
// Inscription via attestation signée par le relayer
function register(
    uint256 tokenId,
    OwnershipAttestation calldata attestation,
    bytes calldata signature
) external;
// Vérifie : sig relayer valide, attestation.owner == msg.sender, nonce frais, pas expiré

function grantRole(bytes32 role, uint256 tokenId) external onlyAuthorizedModule;
// Appelé par ConstituentAssembly après clôture

function authorizeModule(address module) external onlyOwner;
function revokeModule(address module) external onlyOwner;
function setRelayer(address newRelayer) external onlyOwner;  // rotation de clé possible

function isMember(uint256 tokenId) external view returns (bool);
function getMemberCount() external view returns (uint256);
function getMemberTokenIds() external view returns (uint256[] memory);
function getRoleHolder(bytes32 role) external view returns (RoleAssignment memory);
```

**Events**
```solidity
event MemberRegistered(uint256 indexed tokenId, address indexed owner, uint256 timestamp);
event RoleGranted(bytes32 indexed role, uint256 indexed tokenId, address indexed holder);
event ModuleAuthorized(address indexed module);
event ModuleRevoked(address indexed module);
event ConstitutionSet(bytes32 hash);
event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
```

**Invariants**
- Un tokenId ne peut être inscrit qu'une seule fois
- `attestation.owner == msg.sender` — seul le vrai détenteur peut inscrire son Normie
- La signature doit provenir de `relayerAddress` (clé backend ANA)
- Les nonces sont à usage unique (anti-replay)
- Les attestations ont une durée de vie courte (≤ 10 min)
- Seul un module autorisé peut appeler `grantRole`
- L'owner du contrat peut changer le relayer mais PAS attribuer des rôles directement

---

### 2. `ConstituentAssembly`
**Chemin** : `contracts/governance/ConstituentAssembly.sol`
**Rôle** : module de gouvernance pour la phase constituante

**Storage**
```solidity
struct Session {
    uint256 id;
    uint256 openedAt;
    uint256 closedAt;
    bool active;
    bool resolved;
}

struct Vote {
    uint256 voterTokenId;       // Normie qui vote
    bytes32 role;               // rôle pour lequel on vote
    uint256 candidateTokenId;   // Normie candidat
}

IAssociationCore public core;
Session public currentSession;
bytes32[] public electableRoles;

// voterTokenId => role => has voted
mapping(uint256 => mapping(bytes32 => bool)) public hasVoted;

// role => candidateTokenId => vote count
mapping(bytes32 => mapping(uint256 => uint256)) public voteCounts;

// role => candidate list (pour itération)
mapping(bytes32 => uint256[]) public candidates;
```

**Interface publique**
```solidity
function openSession() external onlyOwner;
function castVote(uint256 voterTokenId, bytes32 role, uint256 candidateTokenId) external;
// Vérifie : session active, voterTokenId membre, ownerOf == msg.sender, pas déjà voté pour ce rôle, candidateTokenId membre

function closeSession() external onlyOwner;
// Calcule le gagnant par rôle, appelle core.grantRole pour chaque rôle

function getVoteCount(bytes32 role, uint256 candidateTokenId) external view returns (uint256);
function getLeader(bytes32 role) external view returns (uint256 tokenId, uint256 count);
function hasVotedForRole(uint256 tokenId, bytes32 role) external view returns (bool);
```

**Events**
```solidity
event SessionOpened(uint256 indexed sessionId, uint256 timestamp);
event VoteCast(uint256 indexed sessionId, uint256 indexed voterTokenId, bytes32 indexed role, uint256 candidateTokenId);
event SessionClosed(uint256 indexed sessionId, uint256 timestamp);
event RolesResolved(uint256 indexed sessionId);
```

**Invariants**
- Une seule session active à la fois
- 1 Normie = 1 vote par rôle
- Seul `members[voterTokenId].owner == msg.sender` peut voter — snapshot au moment de l'inscription, pas de ownerOf cross-chain
- Le candidat doit être membre inscrit
- La résolution est atomique (tous les rôles d'un coup à la clôture)

---

### 3. `FactoryRegistry`
**Chemin** : `contracts/factory/FactoryRegistry.sol`
**Rôle** : registre central des factories autorisées

**Storage**
```solidity
mapping(bytes32 factoryType => address factory) public factories;
bytes32[] public registeredTypes;
```

**Interface**
```solidity
function registerFactory(bytes32 factoryType, address factory) external onlyOwner;
function getFactory(bytes32 factoryType) external view returns (address);
function listFactories() external view returns (bytes32[] memory types, address[] memory addrs);
```

**Events**
```solidity
event FactoryRegistered(bytes32 indexed factoryType, address indexed factory);
event FactoryUpdated(bytes32 indexed factoryType, address indexed oldFactory, address indexed newFactory);
```

---

### 4. `CreativeModuleFactory`
**Chemin** : `contracts/factory/CreativeModuleFactory.sol`
**Rôle** : subfactory qui crée et déploie des WorkRegistry

Pour le MVP : on déploie un seul WorkRegistry partagé plutôt qu'un contrat par œuvre (plus simple, suffisant).

**Storage**
```solidity
IAssociationCore public core;
address public workRegistry;
```

**Interface**
```solidity
function setWorkRegistry(address registry) external onlyOwner;
function initiateWork(bytes32 workType, uint256 authorTokenId) external onlyRoleHolder;
// Vérifie que msg.sender est owner du Normie avec rôle AUTHOR
// Crée une entrée "en cours" dans WorkRegistry
```

---

### 5. `WorkRegistry`
**Chemin** : `contracts/creative/WorkRegistry.sol`
**Rôle** : registre des œuvres publiées et archivées

**Storage**
```solidity
struct Work {
    uint256 id;
    string ipfsHash;           // métadonnées IPFS (titre, description, image, participants)
    uint256 authorTokenId;
    uint256 curatorTokenId;
    uint256 rapporteurTokenId;
    uint256 publishedAt;
    bool archived;
}

IAssociationCore public core;
Work[] public works;
```

**Interface**
```solidity
function publish(
    string calldata ipfsHash,
    uint256 authorTokenId,
    uint256 curatorTokenId,
    uint256 rapporteurTokenId
) external onlyRoleHolder(RAPPORTEUR);
// Seul le Normie avec rôle RAPPORTEUR peut publier

function archive(uint256 workId) external onlyOwner;

function getWork(uint256 id) external view returns (Work memory);
function getWorkCount() external view returns (uint256);
```

**Events**
```solidity
event WorkPublished(uint256 indexed workId, string ipfsHash, uint256 indexed authorTokenId, uint256 timestamp);
event WorkArchived(uint256 indexed workId);
```

---

## Rôles — constantes partagées

**Chemin** : `contracts/lib/Roles.sol`
```solidity
library Roles {
    bytes32 constant PRESIDENT       = keccak256("PRESIDENT");
    bytes32 constant VICE_PRESIDENT  = keccak256("VICE_PRESIDENT");
    bytes32 constant SECRETARY       = keccak256("SECRETARY");
    bytes32 constant AUTHOR          = keccak256("AUTHOR");
    bytes32 constant CURATOR         = keccak256("CURATOR");
    bytes32 constant RAPPORTEUR      = keccak256("RAPPORTEUR");
}
```

---

## Interfaces

**Chemin** : `contracts/interfaces/`

```
IAssociationCore.sol
IConstituentAssembly.sol
IWorkRegistry.sol
IFactoryRegistry.sol
```

Les interfaces sont la surface publique stable. Les contrats concrets peuvent évoluer tant qu'ils respectent les interfaces.

---

## Séquence de déploiement

```
1. deploy AssociationCore(relayerAddress, name, symbol)
   // NOTE : plus de normiesContract en paramètre
2. deploy FactoryRegistry()
3. deploy ConstituentAssembly(core.address, electableRoles[])
4. core.authorizeModule(assembly.address)
5. deploy WorkRegistry(core.address)
6. deploy CreativeModuleFactory(core.address)
7. factory.setWorkRegistry(workRegistry.address)
8. factoryRegistry.registerFactory("CREATIVE", factory.address)
```

---

## Choix techniques délibérés

| Décision | Raison |
|---------|--------|
| Pas de proxy upgradeable | Core immuable = sécurité + lisibilité. Modules redéployables sans toucher le core. |
| Attestation relayer au lieu de ownerOf cross-chain | Normies sur mainnet, ANA sur Base — pas d'oracle cross-chain dans le MVP. Relayer contrôlé = compromis acceptable. Évolutif vers EAS post-MVP. |
| Snapshot semantics pour le vote | L'owner enregistré à l'inscription vote — pas de ownerOf re-vérifié à chaque vote. Cohérent avec la logique constituante (assemblée = moment figé). |
| `setRelayer()` dans le Core | La clé relayer peut être compromise → rotation possible sans redéployer le Core. |
| bytes32 pour les rôles | Gaz efficient, extensible, compatible avec des ACL futurs |
| WorkRegistry unique (pas un contrat par œuvre) | MVP : simplicité. On peut migrer vers une factory par œuvre plus tard. |
| Pas d'ERC-20 / treasury | Hors scope MVP, ajoutable comme module sans toucher le core |
