# Core vs Périphérie — Séparation des responsabilités

## La règle fondamentale

> Ce qui doit être immuable et auditable va dans le Core.
> Ce qui peut évoluer sans remettre en cause l'existence de l'association va en périphérie.

---

## Tableau de décision

| Question | Core | Périphérie |
|---------|------|-----------|
| "Ce Normie est-il membre de l'association ?" | ✅ AssociationCore | |
| "Quel Normie détient le rôle PRESIDENT ?" | ✅ AssociationCore | |
| "Comment a-t-on voté lors de l'assemblée ?" | | ✅ ConstituentAssembly |
| "Quelle était la famille esthétique de l'œuvre #1 ?" | | ✅ WorkRegistry (IPFS) |
| "Quelles factories sont autorisées ?" | | ✅ FactoryRegistry |
| "L'œuvre a-t-elle été publiée ?" | | ✅ WorkRegistry |
| "Le Normie #42 appartient-il à 0xABC ?" | (lu via Normies ERC-721) | |

---

## Ce que le Core NE fait PAS

- Il ne calcule pas les votes
- Il ne génère pas d'œuvres
- Il ne gère pas les sessions
- Il ne connaît pas les factories
- Il ne fait pas d'appels externes (sauf ownerOf au moment de l'inscription)
- Il n'a pas de logique métier évolutive

## Ce que le Core FAIT

- Il est la preuve d'existence de l'association
- Il dit qui est membre
- Il dit qui détient quels rôles
- Il dit qui a le droit d'écrire des rôles (modules autorisés)
- Il émet les événements fondateurs

---

## Flux d'écriture

```
Seuls les modules autorisés peuvent écrire dans le Core.

Frontend / User
    ↓ appelle
ConstituentAssembly.castVote()
    ↓ à la clôture, appelle
AssociationCore.grantRole()  ← seul point d'entrée autorisé
    ↓ émet
RoleGranted(role, tokenId, holder)
```

```
Rapporteur (owner du Normie avec rôle RAPPORTEUR)
    ↓ appelle
WorkRegistry.publish(ipfsHash, ...)
    ↓ émet
WorkPublished(workId, ipfsHash, authorTokenId)
```

```
Owner de contrat (admin)
    ↓ appelle
AssociationCore.authorizeModule(moduleAddress)
```

---

## Règle de migration

Si un module périphérique doit être redéployé (bug, upgrade logique) :
1. Déployer le nouveau module
2. `core.revokeModule(oldAddress)`
3. `core.authorizeModule(newAddress)`

L'association continue d'exister. Le Core n'a pas changé. L'historique des événements est préservé.

---

## Limite du Core immuable

Si le Core lui-même a un bug critique :
- Les membres et rôles sont perdus (il n'y a pas de proxy)
- Solution : déployer `AssociationCoreV2`, migrer l'état via un script de lecture des events + ré-inscription
- C'est acceptable car le Core est minimal et auditable — la probabilité d'un bug critique est faible si bien conçu

**Mitigation** : tests unitaires complets sur le Core avant déploiement, audit manuel du code minimaliste.

---

## Analogie Rescoe

Dans Rescoe :
- Le contrat principal (registre des œuvres / droits) = Core immuable
- Les modules de vente / royalties = périphérie remplaçable
- La logique de collection / édition = factories spécialisées

ANA suit le même pattern, appliqué à une logique associative et de gouvernance.
