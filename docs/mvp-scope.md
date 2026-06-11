# MVP Scope — 15 juin 2026

## Objectif de la démo

Le 15 juin à l'assemblée constituante :
1. Un détenteur de Normie inscrit son agent en direct
2. L'assemblée est ouverte, les votes sont castés
3. Les rôles fondateurs sont attribués on-chain
4. Le premier processus créatif est lancé
5. L'œuvre fondatrice est publiée et archivée

## Features IN (obligatoires)

### Discovery
- [ ] Landing page : présentation de l'association, narrative, rôles
- [ ] Lien vers l'API Normies pour explorer les agents

### Wallet & Identity
- [ ] Connexion wallet (wagmi / RainbowKit ou ConnectKit)
- [ ] Détection des Normies détenus par l'adresse connectée (ownerOf on-chain)
- [ ] Affichage de la fiche identité du Normie (API Normies : metadata, persona, traits)

### Phase constituante
- [ ] Inscription d'un Normie dans le registre on-chain (AssociationCore.register)
- [ ] Vérification owner : `ownerOf(tokenId) == msg.sender` dans le contrat
- [ ] Dashboard des membres inscrits (liste + fiche Normie via API)
- [ ] Compteur de membres

### Assemblée & Vote
- [ ] Interface admin : ouverture d'une session d'assemblée (ConstituentAssembly.openSession)
- [ ] Interface de vote : chaque Normie inscrit vote pour des candidats par rôle
- [ ] Contrainte : 1 Normie = 1 vote par rôle, 1 candidat par rôle
- [ ] Affichage temps réel des votes en cours (lecture contrat)
- [ ] Clôture session + attribution automatique des rôles (top vote-getter par rôle)
- [ ] Affichage du tableau de bord institutionnel : rôles élus + fiche Normie

### Première œuvre
- [ ] Déclenchement du processus créatif (post-assemblée, rôles créatifs requis : Auteur, Curateur, Rapporteur)
- [ ] Sélection de la famille esthétique par le Curateur
- [ ] Génération algorithmique de l'œuvre (moteur scripté, inputs = traits du Normie Auteur + seed)
- [ ] Publication de la notice par le Rapporteur (métadonnées textuelles)
- [ ] stockage on-chain des métadonnées ( gratuit)
- [ ] Enregistrement on-chain du hash onchain (WorkRegistry.publish)
- [ ] Page d'archivage de l'œuvre

## Features OUT (hors MVP, documentées pour la suite)

| Feature | Raison de l'exclusion |
|---------|----------------------|
| Burn → création automatique | Complexité contractuelle, non nécessaire à la démo |
| Vote exceptionnel (80%+) | Post-assemblée constituante |
| Œuvre mensuelle collective | Post-MVP, cycle long |
| Treasury on-chain | Non nécessaire pour la phase constituante |
| Multi-collections | Hors scope Normies pour le hackathon |
| Proxies upgradeables | Non indispensables si architecture modulaire propre |
| Agent LLM 24/7 | Coût, complexité, hors MVP |
| Marketplace / vente | Post-MVP |
| Gouvernance post-constituante | Modules futurs |
| Notifications / webhooks | Confort UX, pas critique |

## Rôles MVP

### Institutionnels (élus à l'assemblée)
- `PRESIDENT` — rôle suprême de l'association
- `VICE_PRESIDENT` — aussi Trésorier
- `SECRETARY` — gestion administrative

### Créatifs (élus à l'assemblée)
- `AUTHOR` — source identitaire de l'œuvre
- `CURATOR` — choix de la famille esthétique / logique générative
- `RAPPORTEUR` — publie la notice et les métadonnées

### Optionnels (si ça rentre dans le temps)
- `RARITY_GUARDIAN`
- `SALES_COMMISSIONER`

## Contraintes de coût

- Normies API : gratuite
- onchain :  plan gratuit (1 GB, suffisant)
- Chain : Base (frais minimes) ou Base Sepolia (testnet, gratuit)
- LLM : aucun dans le MVP
- DB : aucune base de données externe payante — localStorage ou fichier JSON pour le cache off-chain si besoin

## Critères de succès le 15 juin

- [ ] Un Normie peut être inscrit en live depuis un wallet réel
- [ ] Un vote peut être casté depuis l'interface
- [ ] Les rôles sont visibles on-chain après clôture
- [ ] Une œuvre est générée et publiée
- [ ] Tout est démontrable sans bugs bloquants
