# Intégration API Normies

## Principe

L'API Normies est la **source de vérité des identités agents**.
Nous ne dupliquons pas ses données dans notre base.
Nous ne créons pas un "profil Normie" parallèle.
Nous lisons, nous composons, nous affichons.

Notre base locale contient **uniquement l'état métier ANA** :
- Qui est inscrit (tokenId) → on-chain dans AssociationCore
- Qui a quel rôle → on-chain dans AssociationCore
- Les votes → on-chain dans ConstituentAssembly
- Les œuvres → on-chain dans WorkRegistry + IPFS

---

## Endpoints utilisés

### Identité & Métadonnées

```
GET /normies/metadata/:tokenId
```
Utilisé pour : carte membre, fiche agent dans le dashboard
Données clés : name, image, attributes (traits), description

```
GET /normies/traits/:tokenId
```
Utilisé pour : seed générative (moteur créatif)
Données clés : trait_type, value, rarity_score

```
GET /normies/owner/:tokenId
```
Utilisé pour : affichage du détenteur actuel côté frontend (complément de ownerOf on-chain)

```
GET /normies/holders
```
Utilisé pour : page "devenir membre" (afficher tous les holders potentiels)

### Canvas & État Agent

```
GET /canvas/state/:tokenId
GET /canvas/customization/:tokenId
GET /canvas/level/:tokenId
GET /canvas/action-points/:tokenId
```
Utilisé pour : enrichissement visuel des fiches agents, seed générative
Données clés : level (enrichit la narrative), action_points (futur : déclencheurs), canvas state

### Agents ERC-8004

```
GET /agents/metadata/:tokenId
GET /agents/info/:tokenId
GET /agents/agent-card/:tokenId
GET /agents/persona-preview/:tokenId
GET /agents/identity/:tokenId
GET /agents/list
GET /agents/count
GET /agents/binding/:tokenId
```
Utilisé pour : affichage du persona complet, narration de l'assemblée
Données clés : persona, identity, binding (relation agent ↔ wallet)

---

## Stratégie de cache

L'API Normies est gratuite mais nous devons éviter les appels excessifs.

**Couche de cache côté Next.js** :
- `unstable_cache` / `revalidate` sur les métadonnées (TTL : 5 minutes)
- Les traits et personas changent peu → TTL long (30 min)
- L'owner peut changer (transfer NFT) → TTL court ou vérification on-chain prioritaire pour les actions critiques

**Ce qui ne se cache PAS** :
- `ownerOf(tokenId)` pour les actions on-chain (inscription, vote) → toujours lu depuis la chain au moment de la tx
- Les états de session (session ouverte/fermée) → lus depuis la chain

---

## Composition des données

Pour afficher une fiche membre complète :

```typescript
type NormieMember = {
  // Source : AssociationCore (on-chain)
  tokenId: number
  registeredAt: number
  role: string | null

  // Source : API Normies
  name: string
  image: string
  traits: Trait[]
  persona: AgentPersona | null
  level: number
  actionPoints: number
}
```

```typescript
async function getMember(tokenId: number): Promise<NormieMember> {
  const [onChainData, apiData, agentData] = await Promise.all([
    readAssociationCore(tokenId),           // wagmi readContract
    fetchNormieMetadata(tokenId),           // API Normies /metadata
    fetchAgentIdentity(tokenId),            // API Normies /agents/identity
  ])
  return { ...onChainData, ...apiData, ...agentData }
}
```

---

## Vérification de propriété

**Pour l'inscription (action critique)** :
1. Frontend : `ownerOf(tokenId)` via wagmi → affiche les Normies de l'utilisateur
2. Contrat : `IERC721(normiesContract).ownerOf(tokenId) == msg.sender` → vérification definitive on-chain

**Pour l'affichage** :
- API Normies `/normies/owner/:tokenId` est suffisante (moins critique, lecture seule)

---

## Utilisation pour la génération créative

Le moteur génératif utilise les données Normie comme seed :

```typescript
type GenerativeSeed = {
  tokenId: number
  traits: Trait[]               // → palette de couleurs, thèmes
  level: number                 // → "intensité" de l'œuvre
  actionPoints: number          // → "énergie" générative
  canvasState: CanvasState      // → éléments visuels de base
  persona: AgentPersona         // → registre textuel (si texte généré)
}
```

La famille esthétique choisie par le Curateur + cette seed → l'œuvre est entièrement déterministe.
`keccak256(abi.encodePacked(tokenId, blockTimestamp))` peut servir de nonce si on veut une part d'aléa vérifiable.

---

## Routes API Next.js (wrappers)

```
/api/normies/[tokenId]/full    → métadonnées + traits + agent identity composés
/api/normies/[tokenId]/seed    → données formatées pour le moteur génératif
/api/normies/members           → liste des membres inscrits (tokenIds from chain) + data API
/api/normies/roles             → rôles élus avec fiche Normie complète
```

Ces routes serveur sont des compositions : elles agrègent chain + API Normies et exposent un objet propre au frontend.

---

## Ce que nous NE faisons PAS

- Pas de base de données locale pour stocker les métadonnées Normies
- Pas de webhook pour tracker les transfers (sauf si on ajoute une invalidation de cache avancée)
- Pas de duplication du système de persona / identity Normies
- Pas d'appel LLM pour enrichir les personas (on utilise ce que l'API fournit)
