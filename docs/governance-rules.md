# ANA — Règles de gouvernance

> Référence : phase constituante MVP.
> Toute décision d'implémentation doit être cohérente avec ce document.

---

## Qui peut participer

Tout détenteur d'un Normie (ERC-721 sur Ethereum mainnet) peut inscrire ses NFTs.
Un Normie = un membre. Un wallet peut inscrire plusieurs Normies.
L'inscription est permanente — elle ne peut pas être annulée.

---

## Inscription


Le relayer backend vérifie ownerOf(tokenId) sur Ethereum mainnet, signe une
attestation EIP-712, et le wallet soumet la transaction sur Base.
Le contrat vérifie la signature et enregistre le membre.

---

## Mandat : règle fondamentale

**Le mandat est attaché au tokenId, pas à l'adresse du détenteur.**

Si un Normie élu change de mains pendant son mandat, le nouveau propriétaire
hérite du mandat en cours et peut exercer les fonctions attachées au rôle.

**Durée :** un an à compter de assignedAt (timestamp on-chain).

**Pourquoi :** la stabilité institutionnelle exige que les rôles aient une valeur
politique propre, indépendante des transactions secondaires sur le marché NFT.
Un Normie élu Président vaut différemment d'un Normie ordinaire.

**État actuel des contrats :** AssociationCore stocke holderAddress à l'élection.
WorkRegistry.onlyRapporteur compare msg.sender == holderAddress. Pour que le
nouveau détenteur exerce le rôle, WorkRegistry v2 devra vérifier
ERC721.ownerOf(ra.tokenId) == msg.sender. Ce changement est planifié.

---

## Session d'assemblée

**Déclenchement :** ouverture par le deployer (onlyOwner) depuis /admin ou directement.
Futur : condition on-chain (quorum d'inscrits) ou par le Président élu.

**Durée :** non contrainte en MVP. Clôture manuelle (closeSession, onlyOwner).
Futur : deadline configurable, fermeture automatique.

---

## Vote

- 1 Normie inscrit = 1 vote par rôle
- Vote pour un candidat (tokenId d'un autre Normie inscrit)
- Un Normie peut être candidat à plusieurs rôles
- Seul ownerOf(voterTokenId) peut voter pour ce token
- Les votes sont publics et permanents on-chain
- Pas de délégation en MVP

---

## Résolution des rôles

- Candidat avec le plus de votes = rôle
- Égalité : tokenId le plus bas l'emporte (déterministe)
- Rôles attribués atomiquement dans closeSession()
- Écrits via grantRole() appelé par ConstituentAssembly (module autorisé)

---

## Rôles et leurs pouvoirs

### Institutionnels

PRESIDENT : représentant officiel. Futur : ouvrir sessions, signer au nom de l'ANA, veto publications.
VICE_PRESIDENT : adjoint. Futur : gestion treasury, délégation, suppléance.
SECRETARY : mémoire institutionnelle. Futur : ratifier décisions, gérer constitution on-chain.

Risque de concentration PRESIDENT : en MVP, aucun pouvoir contractuel au-delà du rôle.
Le deployer reste owner. Avant tout transfert de pouvoir contractuel au Président :
analyse sécurité requise (abus, prise de contrôle hostile, mécanisme de destitution).

### Créatifs

AUTHOR : ses traits NFT alimentent le seed génératif.
CURATOR : choix de la famille esthétique.
RAPPORTEUR : seul autorisé à appeler WorkRegistry.publish().

---

## Économie des mandats

Les Normies élus exercent une fonction réelle. Ils doivent être récompensés.

Mécanismes prévus (non implémentés en MVP) :
- Reward on publish : fraction des frais vers Auteur/Curateur/Rapporteur à chaque publication.
- Treasury distribution : allocation mensuelle vers holders des rôles actifs (géré par VP).
- Staking de mandat : émissions proportionnelles à l'activité de l'association.

Ces mécanismes feront l'objet de modules séparés (GovernanceRewards, TreasuryModule).

---

## Invariants

1. 1 Normie = 1 vote par rôle, jamais plus
2. Seul l'owner du Normie vote (pas de délégation MVP)
3. Votes publics et permanents
4. Rôles créatifs = prérequis création
5. Seul le Rapporteur publie (onlyRapporteur)
6. L'assemblée constituante est unique
7. Le mandat suit le NFT, pas l'adresse (WorkRegistry v2)
