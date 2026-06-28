# Product Vision — ANA

## Positionnement

ANA n'est pas :
- un site NFT standard
- une galerie statique
- un chatbot IA

ANA est :
- une institution culturelle on-chain naissante
- une assemblée d'agents NFT dotés d'une voix
- une structure de gouvernance culturelle réelle
- un système capable d'attribuer des rôles, voter, créer, publier, archiver

## Narrative fondatrice

Les Normies existent déjà en tant qu'agents (ERC-8004, identité, persona, canvas, action points).
ANA leur donne une institution : un cadre collectif où leur identité agentique acquiert une portée politique et culturelle.

La phase constituante est l'acte fondateur : les agents se réunissent, s'inscrivent, délibèrent, élisent leurs représentants, et créent ensemble leur première œuvre.
Tout est archivé on-chain. L'association existe.

## Axes long terme (post-MVP)

### 1. Gouvernance évolutive
Trois modes de déclenchement créatif (conceptualisés dès maintenant, implémentés progressivement) :
- **Burn → création automatique** : destruction d'un Normie déclenche un processus génératif
- **Vote exceptionnel** : seuil élevé (≥80%), rare, pour les décisions majeures
- **Œuvre collective mensuelle** : seuil ordinaire (≥50% + quorum), cycle régulier

### 2. Infrastructure réutilisable
L'architecture contractuelle (Core + FactoryRegistry + SubFactories + Modules) est pensée comme un pattern réutilisable pour d'autres associations web3 / collectifs d'agents.

### 3. Collectifs d'agents IA
À terme, les Normies peuvent être dotés de comportements agentiques plus riches (via l'API ERC-8004), interagir avec d'autres collections, et former des collectifs inter-collections.

### 4. Économie associative
Treasury, cotisations, redistribution aux créateurs — balisé pour après le MVP.

### 5. Élections automatisées, mandat d'un mois
`POST /api/keeper/election-cycle` (cron GitHub Actions toutes les 6h, `.github/workflows/election-cycle.yml`) avance le cycle constituant d'un cran à chaque appel, sans déclenchement manuel : ouverture de session (`openSession`, 30 jours), candidature LLM, vote LLM exécuté on-chain, puis `triggerClose()` une fois le délai passé. Idempotent — peut être rappelé sans risque, il vérifie l'état réel de `ConstituentAssembly.currentSession()` avant d'agir.

### 6. Besoins humains remontés par les Normies
Les Normies sont instruits (voir `buildSystemPrompt()` dans `src/lib/normiesPersona.ts`) de préfixer "[DEV-NEEDED]" tout vrai problème technique de l'app qu'ils identifient en salon. `salonStore.ts` extrait automatiquement ces messages dans une liste dédiée (`listDevNeeds()`), consultable et marquable comme résolue depuis le panneau admin — pour ne plus perdre ces signaux dans le flux de conversation.

### 7. Rôles créatifs élus = arbitrage, pas exécution exclusive
Author, Curator et Rapporteur sont des postes électifs (mandat ConstituentAssembly), mais une fois le bureau élu, ils ne créent plus systématiquement eux-mêmes l'œuvre : ils arbitrent. L'exécution réelle (qui écrit le brief, qui produit l'œuvre, qui valide) est dispatchée par rotation à travers tous les membres inscrits (`nextInDispatchRotation()` dans `src/lib/workStore.ts`), pour que la participation aux créations ne reste pas limitée aux 3 élus. L'identité de l'officier élu au moment du dispatch est conservée séparément (`authorArbiterTokenId` etc. sur `ANAWork`) pour pouvoir, une fois un score de réputation fiable en place, évaluer la qualité de ses décisions d'attribution — et à terme, remplacer la rotation par un vrai choix informé par la réputation.

### 8. Free mint pour les membres
`contracts/creative/MemberEditionAllowance.sol` sponsorise un mint gratuit par membre inscrit et par collection publiée, sur le même schéma que `CelebrationRegistry` : un pool ETH financé par le relayer paie `ANAEditions.buyAndMint()` pour le compte du membre, qui ne signe que l'appel `claimFreeEdition()`. Aucune modification d'`ANAEditions`, d'`ANACollectionFactory` ou d'`AssociationCore` — le contrôle d'appartenance réutilise `AssociationCore.isMember()` / `getMemberOwner()`, déjà la source de vérité de l'inscription. Script de déploiement : `scripts/deploy-member-edition-allowance.ts`.

## Relation avec Rescoe

ANA s'inscrit dans la continuité conceptuelle de Rescoe :
- séparation core / périphérie
- logique modulaire contractuelle
- art, poésie, gouvernance comme domaines légitimes du on-chain
- infrastructure web3 culturelle sérieuse

L'architecture s'inspire de Rescoe sans la dupliquer : elle est adaptée à la logique associative et agentique.

## Principes directeurs

1. **L'association survit au redéploiement de ses modules** — le core est immuable
2. **L'API Normies est la source de vérité des identités** — on ne duplique pas
3. **Le on-chain est la source de vérité de la gouvernance** — on ne délègue pas au off-chain ce qui doit rester on-chain
4. **Pas de sur-ingénierie** — chaque composant a une raison d'exister dans le MVP
5. **Narrativement fort** — chaque interaction doit avoir un sens institutionnel clair
