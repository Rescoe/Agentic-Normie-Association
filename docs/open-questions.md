# Questions ouvertes & Risques — ANA

## Questions à trancher AUJOURD'HUI (J1)

### 1. Quelle chain pour la démo ? ✅ DÉCIDÉ

**Décision** : ANA sur **Base (mainnet)** pour la démo.
Développement et tests sur **Base Sepolia**.
Les Normies restent sur **Ethereum mainnet** — le relayer fait le pont via attestation.

**Implications** :
- `CHAIN_ID = 8453` (Base mainnet) pour les contrats de prod
- `CHAIN_ID = 84532` (Base Sepolia) pour le dev
- Le relayer backend appelle mainnet Ethereum pour vérifier ownerOf (RPC Infura/Alchemy mainnet, clé gratuite)
- Prévoir un peu d'ETH sur Base pour les frais de gas de la démo

---

### 2. Adresse du contrat Normies ERC-721

AssociationCore doit connaître l'adresse du contrat Normies pour appeler `ownerOf()`.

- Sur quelle chain sont les Normies ?
- Quelle est l'adresse exacte du contrat ?
- Y a-t-il un contrat ERC-8004 séparé du contrat ERC-721 ?

**DÉCISION REQUISE** : adresse + chain du contrat Normies.

---

### 3. URL de base de l'API Normies

- Quelle est l'URL de base de l'API Normies ?
- Y a-t-il une clé API / auth nécessaire ?
- Y a-t-il une documentation officielle des endpoints ?
- Rate limits à respecter ?

**DÉCISION REQUISE** : URL base + auth (si applicable).

---

### 4. Qui est "admin" pour la démo ?

Les fonctions `openSession()` et `closeSession()` sont réservées à l'owner du ConstituentAssembly.

- L'owner = ton wallet de déploiement ?
- Faut-il un multisig dès le MVP (non recommandé pour le hackathon) ?
- Interface admin intégrée dans l'app ou scripts CLI ?

**Recommandation** : wallet de déploiement = admin pour le MVP. Interface admin minimaliste dans l'app (protégée par `isOwner`).

---

### 5. Pinata ou alternative IPFS ?

Pour l'upload des métadonnées d'œuvres.

- Pinata plan gratuit : 1 GB, suffisant pour le MVP
- Alternative : web3.storage (gratuit aussi)
- Alternative : Thirdweb storage

**Recommandation** : Pinata (plus mature, bonne doc, SDK disponible).

---

## Risques techniques

### R1 — ownerOf cross-chain ✅ RÉSOLU
**Décision** : ANA sur Base, Normies sur Ethereum mainnet. Pas de ownerOf cross-chain direct.
**Solution retenue** : relayer signataire backend. Le contrat vérifie une attestation EIP-712 signée par notre backend. Voir `docs/attestation-model.md`.
**Risque résiduel** : clé privée du relayer = point de confiance central. Mitigation : durée d'attestation courte (10 min), rotation de clé possible via `setRelayer()`, clé en variable d'environnement sécurisée.

### R2 — Normies API rate limits ou downtime
**Risque** : l'API Normies est externe. Si elle est lente ou down, le frontend est dégradé.
**Mitigation** : cache aggressif côté Next.js. Ne jamais bloquer une action critique (inscription, vote) sur un appel API Normies — ces actions sont purement on-chain.
**Fallback** : afficher tokenId + adresse si l'API ne répond pas. L'expérience est dégradée mais fonctionnelle.

### R3 — Bugs de gouvernance on-chain
**Risque** : un bug dans ConstituentAssembly (ex : mauvais calcul de gagnant, vote double accepté) est visible publiquement et non corrigeable sans redéploiement.
**Mitigation** : tests unitaires complets J2-J3, revue manuelle du code de vote avant déploiement.
**Fallback** : ConstituentAssembly est un module périphérique — on peut le redéployer et ré-ouvrir une session sans toucher AssociationCore.

### R4 — Génération créative trop complexe
**Risque** : le moteur génératif prend plus de temps que prévu.
**Mitigation** : commencer avec la famille la plus simple (poème concret = template texte + seed). Ajouter des familles seulement si J6 avance bien.
**Fallback** : une seule famille esthétique, hardcodée. L'œuvre est générée manuellement si nécessaire (la publication on-chain reste l'acte important).

### R5 — Coût de gas sur Base mainnet
**Risque** : les transactions (register, castVote, closeSession) coûtent du gas.
**Mitigation** : Base est très peu cher. Prévoir ~0.01 ETH par utilisateur pour la démo. Communiquer clairement aux participants.
**Fallback** : testnet Sepolia pour la démo si problème de fonds.

### R6 — UX wallet trop complexe pour les participants
**Risque** : les participants à l'assemblée n'ont pas tous un wallet configuré.
**Mitigation** : préparer un guide d'onboarding (MetaMask + Base Sepolia ou Base mainnet). Tester avec des participants non-tech avant la démo.
**Fallback** : 2-3 wallets "démo" pré-configurés avec des Normies inscrits pour montrer le flux.

---

## Risques produit

### R7 — Narration insuffisante
**Risque** : l'aspect "institution culturelle" n'est pas assez visible dans l'UI.
**Mitigation** : soigner les textes, la terminologie institutionnelle, la page landing. Le ton doit être sérieux et poétique, pas "DeFi standard".

### R8 — Assemblée constituante avec peu de participants
**Risque** : si peu de Normies sont inscrits, l'assemblée ressemble à un test.
**Mitigation** : inscrire plusieurs Normies avant la démo pour peupler le dashboard. Préparer des "comptes de démo" avec des Normies inscrits.

---

## Décisions d'architecture à ne PAS changer après J1

Une fois ces décisions prises, elles sont figées :
1. ~~Adresse du contrat Normies~~ → ✅ non stockée dans AssociationCore, vérifiée dans le relayer
2. ~~Chain de déploiement~~ → ✅ Base mainnet (prod) / Base Sepolia (dev)
3. Liste exacte des rôles (bytes32 constants dans Roles.sol)
4. Interface IAssociationCore (surface publique du Core)
5. **Adresse publique du relayer** (RELAYER_ADDRESS) → fixée au déploiement du Core

Changer ces éléments après J2 = refactor potentiellement coûteux.

---

## Améliorations post-hackathon (backlog)

- [ ] Module de gouvernance ordinaire post-constituant
- [ ] Burn → création automatique
- [ ] NFT de membership (badge ERC-721 pour les membres)
- [ ] Treasury on-chain (module séparé)
- [ ] Cycle créatif mensuel avec quorum
- [ ] The Graph pour indexer les événements on-chain
- [ ] Multi-collection support (autres NFT dans d'autres associations)
- [ ] Interface mobile native
- [ ] Export de la constitution en PDF signé
