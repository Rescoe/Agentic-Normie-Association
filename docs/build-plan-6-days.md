# Plan de build — 6 jours (9-15 juin 2026)

## Vue d'ensemble

| Jour | Focus | Livrable |
|------|-------|---------|
| J1 (9 juin) | Architecture + scaffold | Repo structuré, docs, contrats skeleton |
| J2 (10 juin) | Contrats core | AssociationCore + tests |
| J3 (11 juin) | Contrats gouvernance + deploy | ConstituentAssembly + deploy testnet |
| J4 (12 juin) | Frontend core | Wallet + lecture chain + API Normies |
| J5 (13 juin) | Flux métier | Inscription + vote + résultats |
| J6 (14 juin) | Créatif + polish | Génération œuvre + publication + démo prep |
| J7 (15 juin) | DÉMO | Assemblée constituante live |

---

## J1 — Architecture & Scaffold (9 juin)

**Matin**
- [x] Documentation architecture complète (ce fichier + les autres docs)
- [ ] Validation de l'architecture avec le lead (toi)
- [ ] Décision finale : quelle chain ? (Base Sepolia pour tests, Base mainnet pour la démo)
- [ ] Décision : quelle URL API Normies de base ? Auth si nécessaire ?

**Après-midi**
- [ ] `npx create-next-app@latest` avec TypeScript, Tailwind, App Router
- [ ] Setup Hardhat ou Foundry dans `/contracts`
- [ ] Structure de dossiers complète (selon README)
- [ ] Fichiers skeleton Solidity (interfaces + stubs sans logique)
- [ ] `Roles.sol` avec les constantes
- [ ] Setup wagmi + viem dans le frontend
- [ ] Variables d'environnement : `NORMIES_API_BASE_URL`, `NORMIES_CONTRACT_ADDRESS`, `CHAIN_ID`

**Définition of Done J1**
- Le projet compile (Next.js + Hardhat/Foundry)
- Les interfaces Solidity sont définies
- Les variables d'env sont documentées

---

## J2 — Contrats Core (10 juin)

**Matin**
- [ ] `AssociationCore.sol` complet : register(), grantRole(), authorizeModule(), getters
- [ ] `Roles.sol` finalisé
- [ ] `IAssociationCore.sol` interface

**Après-midi**
- [ ] Tests unitaires AssociationCore :
  - register() : happy path, ownerOf check, double inscription
  - grantRole() : seul module autorisé, event émis
  - authorizeModule() : seul owner
- [ ] `FactoryRegistry.sol` (simple, 30 min max)
- [ ] `IFactoryRegistry.sol`

**Définition of Done J2**
- `forge test` / `npx hardhat test` : tous verts
- AssociationCore couvre les invariants documentés

---

## J3 — Gouvernance + Deploy testnet (11 juin)

**Matin**
- [ ] `ConstituentAssembly.sol` complet : openSession(), castVote(), closeSession(), résolution des rôles
- [ ] `IConstituentAssembly.sol`
- [ ] Tests ConstituentAssembly :
  - castVote() : 1 vote par rôle, ownerOf check, session active check
  - closeSession() : calcul du gagnant, tie-breaking, appel core.grantRole()

**Après-midi**
- [ ] Script de déploiement (`scripts/deploy.ts`)
- [ ] Déploiement sur Base Sepolia (ou Hardhat local en dernier recours)
- [ ] Vérification on-chain : enregistrer les adresses dans `.env.local`
- [ ] `WorkRegistry.sol` + `CreativeModuleFactory.sol` (plus simples, coder maintenant)
- [ ] Tests WorkRegistry

**Définition of Done J3**
- Contrats déployés sur testnet, adresses connues
- Tous les tests passent
- Les ABIs sont générés et copiables dans le frontend

---

## J4 — Frontend Core (12 juin)

**Matin**
- [ ] Layout principal : navigation, header institutionnel, footer
- [ ] Page Landing (/) : présentation, narrative, call-to-action inscription
- [ ] Composant `WalletConnect` (wagmi + ConnectKit ou RainbowKit)
- [ ] Hook `useNormiesOwned(address)` : lit ownerOf on-chain pour les tokenIds possédés
- [ ] Client API Normies (`src/lib/normiesApi.ts`) : fonctions fetch pour tous les endpoints utilisés

**Après-midi**
- [ ] Routes API Next.js :
  - `GET /api/normies/[tokenId]/full` : compose chain + API Normies
  - `GET /api/members` : liste des membres inscrits
  - `GET /api/roles` : rôles élus avec fiche Normie
- [ ] Page `/members` : dashboard des membres inscrits (liste + cartes Normie)
- [ ] Composant `NormieCard` : image, nom, traits, rôle si attribué

**Définition of Done J4**
- Le wallet se connecte, les Normies de l'utilisateur s'affichent
- L'API Normies répond correctement via les routes Next.js
- La page `/members` affiche les membres (vide pour l'instant)

---

## J5 — Flux Métier (13 juin)

**Matin**
- [ ] Hook `useRegisterNormie(tokenId)` : appel AssociationCore.register()
- [ ] Page `/register` ou modal : sélection d'un Normie détenu → inscription
- [ ] Feedback tx : pending, success, error
- [ ] Page `/assembly` : vue de la session d'assemblée
  - État de la session (ouverte / fermée / résolue)
  - Liste des membres inscrits
  - Interface de vote (si session active)

**Après-midi**
- [ ] Hook `useCastVote(voterTokenId, role, candidateTokenId)` : appel ConstituentAssembly.castVote()
- [ ] Interface de vote : pour chaque rôle, liste des candidats membres, bouton "voter"
- [ ] Lecture temps réel des vote counts : `getVoteCount(role, candidateTokenId)`
- [ ] Page `/roles` : tableau de bord des rôles attribués (post-assemblée)
- [ ] Interface admin : boutons "Ouvrir session" / "Clôturer session" (protégés par vérification owner)

**Définition of Done J5**
- Flux complet testable en local : inscription → vote → clôture → rôles affichés
- Les transactions on-chain fonctionnent sur le testnet

---

## J6 — Créatif + Polish + Démo (14 juin)

**Matin**
- [ ] Moteur génératif (`src/server/generative/engine.ts`) :
  - Inputs : traits Normie, level, aesthetic family, seed
  - Output : objet `{ title, text/svg, palette, metadata }`
  - 2-3 familles esthétiques implémentées (poème concret, portrait algorithmique, vers génératif)
- [ ] Route API `POST /api/works/generate` : génère l'œuvre, retourne un preview
- [ ] Page `/creative` : interface Curateur (choix famille) + preview de l'œuvre générée

**Après-midi**
- [ ] Route API `POST /api/works/publish` : upload IPFS (Pinata) + retourne le CID
- [ ] Hook `usePublishWork(ipfsHash, participants)` : appel WorkRegistry.publish()
- [ ] Page `/works` : galerie des œuvres publiées
- [ ] Page `/works/[id]` : fiche d'une œuvre (métadonnées IPFS + participants + hash on-chain)
- [ ] Polish UI : responsive, états de chargement, messages d'erreur
- [ ] Test du flux complet en conditions réelles (mainnet ou testnet stable)
- [ ] Préparer le script de démo live pour le 15 juin

**Définition of Done J6**
- Flux bout-en-bout fonctionnel : inscription → vote → rôles → génération → publication
- L'œuvre est archivée on-chain avec son hash IPFS
- La démo est préparée et scriptée

---

## J7 — Démo (15 juin)

- Assemblée constituante live
- Inscription de Normies en direct
- Vote pour les rôles
- Clôture + affichage des rôles élus
- Lancement du processus créatif
- Publication de la première œuvre fondatrice

---

## Parallélisations possibles

Si travail en binôme :
- J2-J3 : contrats en parallèle avec landing page / composants UI statiques
- J4-J5 : frontend peut être développé en local avec mocks pendant que les contrats sont finalisés

---

## Règle d'or

**Si on est en retard** : couper dans cet ordre exact
1. Familles esthétiques (garder 1 seule)
2. Interface admin (faire les calls directement depuis un script)
3. Page `/works/[id]` (montrer la liste suffit)
4. Polish UI (le fond > la forme pour le hackathon)

**Ne jamais couper** :
- L'inscription on-chain
- Le vote on-chain
- La clôture + rôles on-chain
- La publication d'au moins une œuvre
