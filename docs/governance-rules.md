# Règles de gouvernance — ANA

## Phase constituante (MVP)

### Qui peut participer ?
Tout détenteur d'un Normie (ERC-721) peut inscrire son agent dans la phase constituante.
Un Normie = un membre de l'assemblée constituante.
Un wallet peut inscrire plusieurs Normies s'il en détient plusieurs.

### Inscription
- Appel à `AssociationCore.register(tokenId)`
- Vérification on-chain : `ownerOf(tokenId) == msg.sender`
- L'inscription est permanente : un membre ne peut pas être retiré (sauf en cas de bug critique)
- Pas de minimum de membres pour ouvrir la session — décision d'admin

### Session d'assemblée
- Ouverte par l'admin (owner du ConstituentAssembly)
- Durée : non contrainte on-chain dans le MVP (clôturée manuellement par l'admin)
- Un seul type de session possible dans le MVP : l'assemblée constituante

### Vote
- Chaque Normie inscrit peut voter **une fois par rôle**
- Le vote est pour un **candidat** (tokenId d'un autre Normie inscrit)
- Un Normie peut être candidat à plusieurs rôles
- Seul `ownerOf(voterTokenId)` peut voter avec ce Normie
- Les votes sont publics (on-chain, lisibles par tous)
- Pas de délégation dans le MVP

### Résolution des rôles
- À la clôture, pour chaque rôle : le candidat avec le plus de votes reçoit le rôle
- En cas d'égalité : premier inscrit (tokenId le plus bas) — tie-breaking simple et prévisible
- Tous les rôles sont résolus atomiquement lors du `closeSession()`
- Les rôles sont écrits dans AssociationCore via `grantRole()`

### Rôles électifs MVP

**Institutionnels**
| Rôle | bytes32 key | Description |
|------|-------------|-------------|
| Président | `PRESIDENT` | Représentant officiel de l'association |
| Vice-Président / Trésorier | `VICE_PRESIDENT` | Adjoint + gestion financière future |
| Secrétaire | `SECRETARY` | Mémoire institutionnelle, archives |

**Créatifs**
| Rôle | bytes32 key | Description |
|------|-------------|-------------|
| Auteur | `AUTHOR` | Source identitaire de l'œuvre (ses traits = seed génératif) |
| Curateur | `CURATOR` | Choix de la famille esthétique |
| Rapporteur | `RAPPORTEUR` | Publie la notice et les métadonnées on-chain |

---

## Processus créatif (MVP — post-assemblée)

### Déclenchement
Condition : rôles `AUTHOR`, `CURATOR`, `RAPPORTEUR` attribués.
Déclenchement : appel admin (ou futur appel automatique post-closeSession).

### Workflow
1. **Auteur** : son Normie fournit les traits génératifs (API Normies : palette, traits, level, action points)
2. **Curateur** : choisit une famille esthétique parmi les options proposées (ex : "Poème concret", "ASCII Art", "Vers génératif", "Portrait algorithmique")
3. **Moteur génératif** : backend scripté génère l'œuvre à partir de la seed (traits Normie) + famille esthétique
4. **Rapporteur** : rédige / valide la notice, déclenche l'upload IPFS
5. **Publication** : `WorkRegistry.publish(ipfsHash, authorId, curatorId, rapporteurId)` — appelé par le wallet du Rapporteur

### Moteur génératif (contrainte de coût : pas de LLM)
- Inputs : traits du Normie Auteur (rareté, couleurs, attributs), seed numérique dérivée du tokenId
- Famille choisie par le Curateur → template sélectionné
- Génération déterministe : même inputs → même œuvre (reproductible, auditable)
- Output : fichier SVG / texte + métadonnées JSON → IPFS

---

## Modes de gouvernance futurs (non implémentés dans le MVP)

### 1. Burn → Création automatique
- Un Normie est brûlé
- Le smart contract détecte l'événement Transfer(to=0x000)
- Déclenchement automatique d'un processus de création
- L'œuvre créée "absorbe" l'identité du Normie brûlé
- Seuil : 1 burn = 1 œuvre (automatique, pas de vote)
- Module : `BurnCreationModule`

### 2. Vote exceptionnel
- Seuil : ≥ 80% des membres + quorum (à définir)
- Usage : décisions majeures hors cycle ordinaire
- Rare par design
- Module : `ExceptionalVoteModule`

### 3. Œuvre collective mensuelle
- Cycle régulier (1/mois)
- Seuil : ≥ 50% des membres + quorum (ex : 20% des membres)
- Déclenchement : timer on-chain ou admin après vérification du quorum
- Module : `MonthlyCreativeModule`

---

## Invariants de gouvernance

1. **Un Normie = un vote par rôle** — jamais plus
2. **Seul l'owner du Normie vote** — pas de délégation dans le MVP
3. **Les rôles sont publics** — assignés on-chain, lisibles par tous
4. **Les rôles créatifs sont prérequis à la création** — pas d'œuvre sans AUTHOR + CURATOR + RAPPORTEUR
5. **Seul le RAPPORTEUR publie** — la publication est un acte institutionnel authentifié
6. **L'assemblée constituante est unique** — une seule session de type "constituant" dans la vie de l'association
