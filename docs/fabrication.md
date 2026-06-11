# ANA — Principes de fabrication

> Ce document est la référence de contraintes architecturales non négociables.
> Tout développement doit s'y conformer. En cas de doute sur une décision technique,
> ce fichier a priorité sur les autres documents.

---

## 1. Tout est on-chain. Sans exception.

**Il n'y a pas d'IPFS dans ANA.** Il n'y a pas de Pinata, pas de JWT Pinata,
pas d'upload IPFS, pas de CID, pas de gateway IPFS. Ces termes ne doivent
apparaître ni dans le code, ni dans la documentation, ni dans les variables
d'environnement, ni dans les commentaires.

Toute donnée critique (membres, rôles, votes, œuvres, décisions, récompenses)
est stockée dans des contrats sur Base. La source de vérité est la chaîne, toujours.

**Pourquoi :** les œuvres, les votes et les mandats de l'ANA ont une valeur
institutionnelle et politique. Leur pérennité ne peut pas dépendre d'un service
externe susceptible de disparaître, d'être censuré, ou de changer ses conditions.
L'association survit à n'importe quel prestataire.

### Application concrète

- Le programme source d'une œuvre (HTML/JS/CSS) est encodé en base64 et stocké
  directement dans `WorkRegistry.works[n].content` (appel calldata sur Base).
- Un data URI `data:text/html;base64,<b64>` est passé comme argument à `publish()`.
- Le contrat stocke ce string dans son état — immuable, auto-exécutable depuis la chaîne.
- Le frontend le lit, le décode, et l'exécute dans un iframe sandbox.

---

## 2. Le projet est conçu pour des Normies-agents

ANA n'est pas une interface pour humains qui gèrent manuellement une association.
C'est l'infrastructure de gouvernance et de création pour des agents NFT autonomes.

Les interfaces humaines existent pour :
- Observer ce que font les agents
- Bootstrapper la phase constituante initiale
- Financer les wallets agents
- Gérer les urgences (bugs, attaques, modules compromis)

Elles ne doivent pas introduire des couches inutiles qui seraient contournées
ou absentes lors de l'exécution agentique. Si une étape d'un flux n'a pas
de sens pour un agent (ex : "uploadez votre fichier manuellement"), elle n'existe pas.

---

## 3. Les mandats suivent le NFT

Quand un Normie est élu à un rôle, le mandat est attaché au **tokenId**, pas à l'adresse.

- Si le NFT change de mains, le nouveau détenteur hérite du mandat en cours.
- La durée d'un mandat est d'**un an** à compter de `assignedAt`.
- Après expiration, le rôle est vacant jusqu'à la prochaine assemblée.
- Cette règle garantit la stabilité institutionnelle : les rôles ont une valeur
  politique propre, indépendante des changements de propriété.

**État actuel du contrat :** `AssociationCore.getRoleHolder(role)` retourne
`holderAddress` (figé au moment de l'élection). Pour que le nouveau détenteur
puisse exercer le rôle (ex : appeler `publish()`), `WorkRegistry` et les autres
modules doivent vérifier `ownerOf(ra.tokenId) == msg.sender` **en plus** de
`ra.holderAddress == msg.sender`. Ce changement est prévu dans WorkRegistry v2.

---

## 4. Les APIs sont entièrement publiques

Tous les endpoints Next.js (`/api/*`) sont publics et non authentifiés.
Aucune clé API client, aucun middleware d'authentification pour la lecture.

Cohérence avec l'architecture agentique : un agent Normie doit pouvoir
interroger l'état de l'ANA depuis n'importe quel contexte, sans clé.
Le standard x402 (paiements machine-to-machine) peut être appliqué
pour les actions payantes, mais jamais pour la lecture d'état.

---

## 5. Le Core est immuable, les modules sont redéployables

`AssociationCore` ne sera jamais mis à niveau par proxy. S'il faut le corriger,
on déploie `AssociationCoreV2` et on migre l'état.

Tout le reste (`ConstituentAssembly`, `WorkRegistry`, `FactoryRegistry`) peut
être redéployé et réautorisé sans toucher le Core. L'historique des événements
du Core est préservé sur la chaîne pour toujours.

---

## 6. Pas de sur-ingénierie

Ne pas prévoir de fonctionnalités pour des cas hypothétiques.
Ne pas introduire d'abstractions inutiles.
Ne pas ajouter de logique de compatibilité descendante qui n'est pas nécessaire aujourd'hui.

Le scope actuel est défini dans `docs/mvp-scope.md`. Tout ce qui n'est pas dans
ce document est "futur" et ne doit pas influencer l'architecture présente.

---

## Références croisées

- Architecture modulaire → `docs/core-vs-periphery.md`
- Règles de gouvernance → `docs/governance-rules.md`
- Modèle de données → `docs/data-model.md`
- Vision produit → `docs/product-vision.md`
