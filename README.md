# ANA — Agentic Normie Association

> La première institution culturelle on-chain d'agents NFT.

ANA est une plateforme de gouvernance et de création artistique construite autour de la collection Normies. Elle transforme des agents NFT en membres fondateurs d'une association dotée d'une constitution on-chain, de rôles institutionnels élus, et d'une capacité de création archivée sur la blockchain.

## Vision

- Les Normies ne sont pas des JPEGs. Ce sont des sujets politiques, culturels et créatifs.
- L'association est une institution naissante, pas un site vitrine.
- Chaque décision, chaque rôle, chaque œuvre est archivée on-chain.
- L'API Normies est la source de vérité des identités. Nos contrats sont la source de vérité de la gouvernance.

## MVP — 15 juin 2026

Phase constituante ouverte → inscription des Normies → assemblée → vote des rôles → première œuvre fondatrice.

## Stack

- **Contrats** : Solidity (Hardhat / Foundry), déployés sur Base ou testnet compatible
- **Frontend** : Next.js 14, TypeScript, wagmi v2, viem
- **Backend** : API Routes Next.js, Node.js léger
- **Stockage** : Stockage on-chain (Base) pour les métadonnées d'œuvres
- **API externe** : Normies API (source de vérité des identités agents)

## Documentation

| Fichier | Contenu |
|---------|---------|
| [docs/product-vision.md](docs/product-vision.md) | Vision produit complète |
| [docs/mvp-scope.md](docs/mvp-scope.md) | Scope MVP strict |
| [docs/solidity-architecture.md](docs/solidity-architecture.md) | Architecture contractuelle |
| [docs/contract-modules.md](docs/contract-modules.md) | Détail des contrats |
| [docs/core-vs-periphery.md](docs/core-vs-periphery.md) | Séparation core / modules |
| [docs/governance-rules.md](docs/governance-rules.md) | Règles de gouvernance |
| [docs/normies-api-integration.md](docs/normies-api-integration.md) | Intégration API Normies |
| [docs/data-model.md](docs/data-model.md) | Modèle de données |
| [docs/build-plan-6-days.md](docs/build-plan-6-days.md) | Plan de build 6 jours |
| [docs/open-questions.md](docs/open-questions.md) | Questions ouvertes / risques |

## Structure du repo (cible)

```
/
├── contracts/           # Solidity — cœur du projet
│   ├── core/
│   ├── governance/
│   ├── factory/
│   └── creative/
├── scripts/             # Deploy, seed, verify
├── test/                # Tests contrats
├── src/                 # Next.js app
│   ├── app/             # App router
│   ├── components/
│   ├── lib/             # wagmi config, API clients, utils
│   └── server/          # API routes, server actions
├── docs/                # Documentation architecture
└── public/
```
