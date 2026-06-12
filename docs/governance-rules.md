# ANA — Règles de gouvernance

> Référence : phase constituante MVP.
> Toute décision d'implémentation doit être cohérente avec ce document.

---

## Modèle de membership — deux régimes distincts

C'est le point le plus important à comprendre. Il y a deux choses différentes :

### 1. L'identité du membre : le tokenId

**Le Normie (tokenId) est le membre, pas son propriétaire humain.**

`isMember(tokenId)` — c'est le tokenId qui est enregistré dans AssociationCore, pas une adresse.
Un Normie est membre de l'ANA. Ses propriétaires humains successifs ne sont que ses opérateurs.

### 2. L'autorisation d'agir : contrainte cross-chain

Pour exécuter une action on-chain (voter, publier...), le contrat doit savoir
**qui a le droit d'utiliser ce tokenId à cet instant**. C'est là qu'intervient la contrainte :

> **ANA est sur Base. Les Normies sont sur Ethereum. Le contrat ne peut pas appeler
> `ownerOf(tokenId)` sur Ethereum depuis Base sans une attestation relayer.**

Donc, en pratique :

| Action | Comment l'autorisation est vérifiée | Qui peut agir |
|--------|-------------------------------------|---------------|
| `register()` | Attestation relayer (ownerOf actuel) | Le propriétaire actuel du Normie |
| `castVote()` **[MVP]** | Snapshot : `members[tokenId].ownerAddress` | L'adresse qui a inscrit le Normie |
| `publish()` **[MVP]** | Snapshot : `roles[role].holderAddress` | L'adresse qui détenait le Normie à l'élection |
| `publish()` **[v2]** | Nouvelle attestation relayer | Le propriétaire actuel du Normie élu |

### Ce que ça signifie concrètement

**Si tu vends ton Normie après l'avoir inscrit mais avant la clôture de l'assemblée :**
- Le tokenId reste membre (inscription permanente)
- Le nouveau propriétaire NE PEUT PAS voter avec ce tokenId dans cette assemblée
  (son adresse ≠ adresse snapshotée à l'inscription)
- L'ancien propriétaire peut techniquement encore voter (son adresse est toujours snapshotée)
  mais il n'a plus le Normie — c'est une anomalie tolérable pour un événement fondateur unique
- Pour les assemblées futures (GovernanceAssembly v2), une fresh attestation sera requise
  à chaque session → le problème disparaît

**Pour l'assemblée constituante, ce comportement est intentionnel :**
C'est un acte fondateur unique. Les membres fondateurs sont ceux qui ont prouvé
leur propriété au moment de l'inscription. Comme des signataires d'un acte constitutif.

---

## Qui peut participer

Tout détenteur d'un Normie (ERC-721 sur Ethereum mainnet) peut inscrire ses NFTs.
Un Normie = un membre. Un wallet peut inscrire plusieurs Normies.
L'inscription est permanente et non-annulable. Un tokenId ne peut s'inscrire qu'une fois.

---

## Inscription

Le relayer backend vérifie `ownerOf(tokenId)` sur Ethereum mainnet, signe une
attestation EIP-712, et le wallet soumet la transaction sur Base.
Le contrat vérifie la signature et enregistre le membre :

```
members[tokenId] = Member {
  ownerAddress: msg.sender,   // snapshoté ici
  registeredAt: block.timestamp,
  active:       true
}
```

---

## Mandat : règle fondamentale

**Le mandat est attaché au tokenId, pas à l'adresse du détenteur.**

Si un Normie élu change de mains pendant son mandat, le nouveau propriétaire
devrait hériter du mandat en cours. C'est la règle voulue.

**Durée :** un an à compter de `assignedAt` (timestamp on-chain).

**État actuel des contrats (MVP) :** `AssociationCore.grantRole()` stocke
`holderAddress` = l'adresse au moment de l'élection. `WorkRegistry.publish()`
vérifie `msg.sender == holderAddress`. Si le NFT change de mains, le nouveau
propriétaire ne peut pas publier sans re-attestation.

**Résolution (WorkRegistry v2) :** les actions privilegiées demanderont une fresh
attestation relayer prouvant `ownerOf(tokenId) == msg.sender` au moment de l'appel.

---

## Session d'assemblée

**Déclenchement :** ouverture par le deployer (`onlyOwner`) depuis /admin.
Futur : condition on-chain (quorum d'inscrits atteint) ou par le Président élu.

**Durée :** non contrainte en MVP. Clôture manuelle (`closeSession`, `onlyOwner`).
Futur : deadline configurable, fermeture automatique.

---

## Vote

- 1 Normie inscrit = 1 vote par rôle, non modifiable
- Vote pour un candidat (tokenId d'un Normie inscrit)
- Un Normie peut être candidat à plusieurs rôles simultanément
- Seule l'adresse snapshotée à l'inscription peut voter pour ce tokenId
- Les votes sont publics et permanents on-chain
- Pas de délégation en MVP

---

## Résolution des rôles

- Candidat avec le plus de votes remporte le rôle
- Égalité : tokenId le plus bas l'emporte (déterministe, prévisible)
- Tous les rôles résolus atomiquement dans `closeSession()`
- Écrits via `grantRole()` appelé par ConstituentAssembly (module autorisé)
- Un rôle sans aucun vote est laissé vacant (pas d'attribution forcée)

---

## Rôles et leurs pouvoirs

### Institutionnels

**PRESIDENT** : représentant officiel de l'ANA. En MVP : rôle symbolique, aucun
pouvoir contractuel supplémentaire. Le deployer reste owner du contrat.
Avant tout transfert de pouvoir contractuel au Président : analyse sécurité
requise (abus, prise de contrôle, mécanisme de destitution).

**VICE_PRESIDENT** : adjoint du Président. Futur : gestion treasury, délégation.

**SECRETARY** : mémoire institutionnelle. Futur : ratifier décisions, gérer constitution.

### Créatifs

**AUTHOR** : ses traits NFT alimentent le seed génératif de l'œuvre.

**CURATOR** : choix de la famille esthétique, sélection du programme.

**RAPPORTEUR** : seul autorisé à appeler `WorkRegistry.publish()`. Publie le programme
source (data URI base64) qui sera exécuté on-chain dans la galerie.

---

## Économie des mandats

Les Normies élus exercent une fonction réelle. Ils doivent être récompensés.

Mécanismes prévus (non implémentés en MVP) :
- **Reward on publish** : fraction des frais vers Auteur/Curateur/Rapporteur à chaque publication.
- **Treasury distribution** : allocation mensuelle vers les rôles actifs.
- **Staking de mandat** : émissions proportionnelles à l'activité de l'association.

Ces mécanismes feront l'objet de modules séparés (GovernanceRewards, TreasuryModule).

---

## Invariants

1. 1 Normie = 1 vote par rôle, jamais plus
2. Seule l'adresse snapshotée à l'inscription peut voter (contrainte cross-chain MVP)
3. Votes publics et permanents on-chain
4. Rôles créatifs (AUTHOR, CURATOR, RAPPORTEUR) = prérequis pour publier
5. Seul le Rapporteur publie (`onlyRapporteur`)
6. L'assemblée constituante est unique — les sessions ordinaires seront un autre module
7. Le mandat suit le NFT conceptuellement — l'implémentation v2 rendra ça dynamique
