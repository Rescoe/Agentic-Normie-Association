# Modèle de données — ANA

## Principe de séparation

```
On-chain (source de vérité métier)
    AssociationCore → membres, rôles, modules autorisés
    ConstituentAssembly → sessions, votes
    WorkRegistry → œuvres publiées (hash IPFS + participants)

Off-chain API (source de vérité identités)
    API Normies → metadata, traits, persona, level, canvas

Off-chain IPFS (données larges immuables)
    Métadonnées JSON des œuvres
    Assets génératifs (SVG, image, texte)
    Constitution de l'association (document texte)

Local / Cache Next.js (performance UX)
    Cache TTL des réponses API Normies
    État local de session UI (wallet connecté, etc.)
```

---

## Structures on-chain

### AssociationCore

```solidity
// Membre de l'association
struct Member {
    address owner;        // adresse au moment de l'inscription
    uint256 registeredAt; // block.timestamp
    bool active;          // toujours true dans le MVP
}

// Attribution d'un rôle
struct RoleAssignment {
    uint256 tokenId;      // Normie élu
    address holder;       // owner au moment de l'élection
    uint256 assignedAt;   // block.timestamp
}

// Storage
mapping(uint256 => Member) members;
uint256[] memberTokenIds;
mapping(bytes32 => RoleAssignment) roles;
mapping(address => bool) authorizedModules;
```

### ConstituentAssembly

```solidity
struct Session {
    uint256 id;
    uint256 openedAt;
    uint256 closedAt;
    bool active;
    bool resolved;
}

// voterTokenId => role => has voted
mapping(uint256 => mapping(bytes32 => bool)) hasVoted;

// role => candidateTokenId => vote count
mapping(bytes32 => mapping(uint256 => uint256)) voteCounts;

// role => tokenId[] (candidats ayant reçu au moins 1 vote)
mapping(bytes32 => uint256[]) candidates;
```

### WorkRegistry

```solidity
struct Work {
    uint256 id;
    string ipfsHash;           // CIDv1 des métadonnées JSON
    uint256 authorTokenId;
    uint256 curatorTokenId;
    uint256 rapporteurTokenId;
    uint256 publishedAt;
    bool archived;
}

Work[] works;
```

---

## Schéma IPFS — Métadonnées d'œuvre

```json
{
  "name": "Œuvre Fondatrice #1 — Titre généré",
  "description": "Notice rédigée par le Rapporteur...",
  "image": "ipfs://CID_DE_L_IMAGE",
  "external_url": "https://ana.app/works/1",
  "attributes": [
    { "trait_type": "Type", "value": "Œuvre fondatrice" },
    { "trait_type": "Session", "value": "Assemblée constituante 2026" },
    { "trait_type": "Famille esthétique", "value": "Poème concret" },
    { "trait_type": "Auteur (tokenId)", "value": 42 },
    { "trait_type": "Curateur (tokenId)", "value": 17 },
    { "trait_type": "Rapporteur (tokenId)", "value": 88 }
  ],
  "ana": {
    "version": "1.0",
    "associationCore": "0xADRESS_CORE",
    "workRegistryId": 0,
    "generativeSeed": {
      "authorTokenId": 42,
      "aestheticFamily": "concrete_poetry",
      "traits": [...],
      "level": 7,
      "nonce": "0xHASH_BLOC"
    }
  }
}
```

---

## Schéma IPFS — Constitution

```json
{
  "title": "Constitution de l'Agentic Normie Association",
  "version": "1.0",
  "adoptedAt": "2026-06-15",
  "preamble": "...",
  "articles": [
    { "number": 1, "title": "Objet", "content": "..." },
    { "number": 2, "title": "Membres", "content": "..." },
    { "number": 3, "title": "Rôles", "content": "..." },
    { "number": 4, "title": "Création", "content": "..." }
  ],
  "foundingMembers": [42, 17, 88, ...],
  "electableRoles": ["PRESIDENT", "VICE_PRESIDENT", "SECRETARY", "AUTHOR", "CURATOR", "RAPPORTEUR"]
}
```

---

## Types TypeScript frontend

```typescript
// Composé : chain + API Normies
interface NormieMember {
  tokenId: number
  owner: string
  registeredAt: number           // timestamp unix
  role: AssociationRole | null
  // API Normies
  name: string
  image: string
  traits: NormieTrait[]
  level: number
  actionPoints: number
  persona: AgentPersona | null
}

interface NormieTrait {
  trait_type: string
  value: string
  rarity_score?: number
}

interface AgentPersona {
  name: string
  archetype: string
  personality: string[]
  voice: string
}

type AssociationRole =
  | 'PRESIDENT'
  | 'VICE_PRESIDENT'
  | 'SECRETARY'
  | 'AUTHOR'
  | 'CURATOR'
  | 'RAPPORTEUR'

interface AssemblySession {
  id: number
  active: boolean
  resolved: boolean
  openedAt: number
  closedAt: number | null
}

interface VoteState {
  voterTokenId: number
  role: AssociationRole
  candidateTokenId: number
  // Computed
  hasVoted: boolean
  currentLeader: { tokenId: number; count: number } | null
}

interface Work {
  id: number
  ipfsHash: string
  ipfsData: WorkMetadata | null    // chargé depuis IPFS
  authorTokenId: number
  curatorTokenId: number
  rapporteurTokenId: number
  publishedAt: number
  archived: boolean
}
```

---

## État local (aucune DB externe dans le MVP)

On utilise :
- **wagmi store** : état wallet + lectures on-chain
- **Next.js cache** : TTL sur les réponses API Normies
- **React Query / SWR** : revalidation côté client
- **Pas de base de données** : l'état métier est on-chain, les identités sont dans l'API Normies

Si besoin d'un état temporaire de génération (pendant la session créative) :
- Fichier JSON temporaire côté serveur Next.js (en mémoire ou `tmp/`) — acceptable pour le MVP
- L'état définitif est toujours IPFS + on-chain
