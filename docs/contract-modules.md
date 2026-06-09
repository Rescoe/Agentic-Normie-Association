# Contract Modules — Détail des responsabilités

## Vue d'ensemble

```
contracts/
├── core/
│   └── AssociationCore.sol         # registre immuable
├── governance/
│   └── ConstituentAssembly.sol     # phase constituante + vote
├── factory/
│   ├── FactoryRegistry.sol         # registre master des factories
│   └── CreativeModuleFactory.sol   # subfactory créative
├── creative/
│   └── WorkRegistry.sol            # registre des œuvres
├── interfaces/
│   ├── IAssociationCore.sol
│   ├── IConstituentAssembly.sol
│   ├── IWorkRegistry.sol
│   └── IFactoryRegistry.sol
└── lib/
    └── Roles.sol                   # constantes de rôles
```

---

## AssociationCore — responsabilités exactes

**Responsable de :**
- Tenir le registre des membres (tokenId inscrit → Member struct)
- Tenir le registre des rôles (bytes32 → RoleAssignment)
- Gérer la liste des modules autorisés à écrire des rôles
- Émettre les événements fondateurs (inscription, rôle attribué)

**PAS responsable de :**
- La logique de vote (→ ConstituentAssembly)
- La création d'œuvres (→ WorkRegistry)
- La gestion des factories (→ FactoryRegistry)
- Toute logique métier future (→ modules périphériques)

**Mutabilité :** le contrat n'est jamais redéployé. S'il y a un bug critique, on déploie un `AssociationCoreV2` séparé et on migre les données via un script, mais c'est un cas extrême.

---

## ConstituentAssembly — responsabilités exactes

**Responsable de :**
- Ouvrir / fermer une session d'assemblée
- Accepter les votes (tokenId votant → rôle → candidat)
- Valider les droits de vote (membre inscrit, ownerOf, pas déjà voté)
- Calculer le gagnant par rôle à la clôture
- Appeler `core.grantRole()` pour chaque rôle résolu

**PAS responsable de :**
- Savoir ce que font les rôles une fois attribués
- Gérer les sessions futures post-constituantes (→ module GovernanceAssembly futur)
- La création d'œuvres

**Durée de vie :** ce module est spécifique à la phase constituante. Une fois l'assemblée close et les rôles attribués, son rôle est terminé. Les sessions futures utiliseront un module de gouvernance ordinaire (futur).

---

## FactoryRegistry — responsabilités exactes

**Responsable de :**
- Maintenir un registre `factoryType → address` des factories autorisées
- Permettre d'ajouter / remplacer des factories sans toucher le core

**PAS responsable de :**
- La logique des factories elles-mêmes
- La déployabilité des sous-contrats

**Extensibilité :** on peut ajouter `CollectionFactory`, `EventFactory`, `TreasuryFactory`, etc. sans modifier le core ni les contrats existants.

---

## CreativeModuleFactory — responsabilités exactes

**Responsable de :**
- Initialiser un processus créatif (appel par le rôle AUTHOR ou admin post-assemblée)
- Référencer le WorkRegistry cible
- Valider que les rôles créatifs sont bien attribués avant de lancer le processus

**PAS responsable de :**
- Générer l'œuvre (→ moteur off-chain / backend)
- Publier l'IPFS hash (→ Rapporteur via WorkRegistry)

---

## WorkRegistry — responsabilités exactes

**Responsable de :**
- Stocker les œuvres publiées (ipfsHash + participants tokenIds + timestamp)
- Autoriser la publication uniquement par le RAPPORTEUR
- Émettre l'événement WorkPublished (indexable par The Graph plus tard)

**PAS responsable de :**
- Générer le contenu
- Gérer l'IPFS upload (→ backend)
- La curation ou le choix esthétique

---

## Modules futurs (non implémentés dans le MVP)

| Module | Rôle futur |
|--------|------------|
| `GovernanceAssembly` | Sessions de vote ordinaires post-constituantes |
| `BurnCreationModule` | Déclenche création automatique sur burn de Normie |
| `MonthlyCreativeModule` | Cycle créatif mensuel avec quorum |
| `CollectionFactory` | Déploie des collections NFT d'œuvres |
| `TreasuryModule` | Gestion des fonds associatifs |
| `MembershipNFT` | NFT de membership (badge d'adhérent) |

Chaque module futur s'intègre en :
1. Étant autorisé dans AssociationCore (si besoin d'écrire des rôles / membres)
2. Étant enregistré dans FactoryRegistry (si c'est une factory)
3. Lisant l'état de AssociationCore via son interface publique

Aucun module futur ne nécessite de modifier AssociationCore.

---

## Points d'extension explicites

AssociationCore expose :
- `authorizedModules` : n'importe quel module peut être autorisé à écrire des rôles
- `isMember(tokenId)` : interface publique pour tous les modules futurs
- `getRoleHolder(role)` : interface publique pour la vérification ACL

Ces trois points d'extension sont suffisants pour brancher tous les modules futurs envisagés.
