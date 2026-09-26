# Pérennisation cognitive et économique d'ANA — note d'implémentation

Date : 26/09/2026
Portée : mémoire durable des salons, progression réelle des débats, rotation dynamique des sujets, vote fiable, demandes d'outils aux humains, diversité créative, regroupement des réveils Neon.

Cette note décrit ce qui a été implémenté, les compromis assumés, la procédure de rollback, et les risques qui restent ouverts. Aucun commit n'a été créé et rien n'a été poussé — c'est au porteur de revoir le diff et de décider.

## 1. Ce qui a changé, en une phrase par sujet

| Sujet | Avant | Après |
|---|---|---|
| Mémoire des salons | Un seul blob JSON (`salon-store`) contenant TOUS les salons et TOUS les messages — réécrit en entier à chaque nouveau message | Tables relationnelles (`salons`, `salon_messages`, `salon_summaries`, `salon_state`) — un message = une ligne insérée, jamais une réécriture globale |
| Perte de messages | Troncature silencieuse au-delà de 100 messages/salon, avant toute synthèse | Aucune suppression : les messages restent en base indéfiniment, un simple drapeau `synthesized` change |
| Synthèse | Mensuelle, globale, sans seuil de sécurité avant troncature | Par salon, au seuil de 50 messages non synthétisés OU quotidienne à minuit, jamais d'avancée de curseur sur échec LLM |
| Sujets de discussion | 10 thèmes fixes tirés au hasard (20 %/50 % de chance de changer) | File dynamique scorée (pertinence + urgence + nouveauté − similarité − fréquence), 10 thèmes fixes en repli uniquement si la file est vide |
| Signaux externes | Aucun | Collecte quotidienne (activité Base/ANA, Hacker News, OpenAlex, RSS configurables) → `emergingTopics` dans la synthèse |
| Vote | Abstention silencieuse sur JSON invalide, `[object Object]` dans les traits, pas de quorum explicite | JSON invalide ≠ abstention, une tentative de réparation immédiate, quorum mesuré et journalisé, traits toujours formatés `trait_type: value` |
| Diversité créative | Comparaison de titres par recouvrement de mots uniquement | Fiche créative structurée par œuvre + comparaison Jaccard avant brief/publication |
| Œuvre bloquée | Boucle CREATING ↔ VALIDATING sans limite | État `NEEDS_RETHINK` après 3 échecs similaires — nouvel auteur + nouveau brief automatique, ou demande humaine si la cause est technique |
| Demandes `[DEV-NEEDED]` | Liste plate, pas de dédoublonnage, pas de statut | Workflow structuré (`OBSERVED → ... → CLOSED/REJECTED`), dédoublonnage par recouvrement de titre, réponse humaine réinjectée |
| Crons GitHub Actions | 5 workflows indépendants (30 min / 2 h / 6 h / 20 min / 1 h) + un hebdomadaire | Un orchestrateur unique toutes les 30 min qui décide ce qui est dû ; les anciens workflows n'ont plus de `schedule`, gardés en `workflow_dispatch` |
| Budget LLM | Aucun suivi | Grand livre interne (`llm_ledger`) par fournisseur/modèle/tâche, bascule vers Groq si le plafond configuré de 1min.ai est dépassé |
| Coût Neon | Estimé, jamais mesuré | Projection basée sur le calendrier de l'orchestrateur, ou mesure réelle via l'API de consommation Neon si `NEON_API_KEY`/`NEON_ORG_ID`/`NEON_PROJECT_ID` sont configurés (API confirmée sans réveil du compute) |

## 2. Architecture

### 2.1 Nouvelles tables (voir `src/lib/migrations.ts`)

Migrations explicites, idempotentes, à exécuter une seule fois via `npm run db:migrate` — **jamais au runtime**. `db.ts` (`kv_store`) continue d'exister pour ce qui reste vraiment un blob (registre de noms, limites de débit par IP) et pour tout ce que `workStore.ts` gère déjà (works, burn-supply-tracker, etc. — non touché dans cette passe).

- `salons`, `salon_messages`, `salon_summaries`, `salon_state`
- `decisions`, `open_questions`, `commitments`, `normie_memory`
- `topic_queue`, `external_signals`
- `dev_requests`, `creative_fingerprints`
- `llm_ledger`, `vote_metrics`

### 2.2 Nouveaux modules (`src/lib/`)

- `migrations.ts` — schéma + exécuteur de migrations
- `salonStore.ts` — **réécrit** : `Salon` (liste compacte, sans messages) vs `SalonDetail` (détail complet, avec messages/résumés)
- `salonMemory.ts` — décisions, questions ouvertes, engagements, mémoire compacte par Normie
- `synthesis.ts` — l'appel de synthèse structuré unique, validation stricte, une réparation, jamais d'avancée de curseur sur échec
- `topicEngine.ts` — file de sujets, machine à états de phase, similarité Jaccard gratuite
- `externalSignals.ts` — adaptateurs de collecte (Base/ANA, HN, OpenAlex, RSS actifs par défaut ; Europeana/GDELT désactivés par défaut)
- `voting.ts` — analyse de vote, calcul de quorum, formatage des traits (pur, testable sans base)
- `voteMetricsStore.ts` — persistance des métriques de vote + alertes (abstention > 50 %, sorties invalides > 10 %)
- `devRequests.ts` — workflow structuré des demandes humaines/outils
- `creativeFingerprint.ts` — empreinte créative par œuvre + comparaison de similarité
- `llmLedger.ts` — grand livre des appels LLM, bascule économique
- `neonUsage.ts` — usage Neon réel (API) ou projection étiquetée comme telle

### 2.3 Nouvelles routes

- `POST /api/keeper/orchestrator` — point d'entrée unique du cron toutes les 30 min
- `GET /api/admin/observability` — tableau de bord compact (backlog de synthèse, santé des votes, œuvres en `NEEDS_RETHINK`, demandes ouvertes, grand livre LLM, usage Neon)
- `src/app/api/admin/dev-needs/route.ts`, `src/app/api/keeper/synthesize/route.ts` — réécrites pour le nouveau workflow

### 2.4 Calendrier de l'orchestrateur

```
:00 / :30 (chaque tick)     activity-catchup, synthesis-threshold
toutes les 2h à :00         salon-exchange, work-lifecycle, check-burns (en parallèle)
toutes les 6h à :00         election-cycle
00:00 UTC                   synthesis-daily (+ signaux externes), health-ping
dimanche 03:00 UTC          batch-memorial.yml (laissé indépendant, volontairement — voir §4)
```

Calcul : 48 fenêtres/jour × ~5 min actives × 0,25 CU = 4 h actives/jour ≈ **30 CU-h/mois ≈ 3,18 $/mois** au tarif Launch (0,106 $/CU-h) — hypothèse documentée dans le code, jamais présentée comme une mesure tant que l'API de consommation Neon n'est pas configurée.

**Point d'attention Vercel Hobby** : chaque tâche de l'orchestrateur est un self-fetch HTTP vers une autre route serverless, exécuté en **parallèle** (`Promise.allSettled`), pas en séquence — `work-lifecycle` a son propre budget de 60 s et Vercel Hobby plafonne toute fonction à 60 s réels quel que soit `maxDuration` déclaré. Un enchaînement séquentiel aurait risqué de tuer l'orchestrateur avant la fin. Le parallélisme borne le temps total au plus lent des sous-appels, mais ne l'élimine pas complètement — à surveiller si `work-lifecycle` approche régulièrement 60 s.

## 3. Compromis assumés (et pourquoi)

1. **Pas de tables tronquées en masse pour l'action admin « wipe entire database »** — j'ai tenté d'ajouter une fonction `TRUNCATE` sur toutes les nouvelles tables relationnelles pour que cette action admin les efface aussi ; le classificateur de sécurité automatique de la session a bloqué cette édition (catégorisée « suppression de masse »), même en tant que code, pas exécution. Je n'ai pas contourné ce blocage. **Conséquence concrète : `POST /api/keeper/reset-database` ne vide plus que `kv_store` — les nouvelles tables (messages de salon, sujets, votes, demandes dev, grand livre LLM) ne sont PAS effacées par cette action.** Si un reset complet est nécessaire, il faut l'étendre manuellement (ajouter les `DELETE`/`TRUNCATE` un par un, en dehors de ce type de session, ou via la console Neon directement).
2. **Migration des anciens messages de salon non exécutée** — le script (`npm run db:migrate`) crée les tables mais ne rejoue pas l'historique de l'ancien blob `salon-store` dedans. Comme `NEON_COST_AUDIT.md` indique une base de production avec 17 salons/184 messages, ces messages existants resteront dans l'ancien blob (inaccessibles au nouveau code) tant qu'une migration ponctuelle n'est pas écrite et exécutée. Je n'ai pas voulu improviser cette migration de données réelles sans confirmation explicite — c'est une décision du porteur, pas une omission technique.
3. **Curation visuelle** — pas de rendu headless (Playwright/Puppeteer) ajouté : trop fragile sur Vercel serverless pour cette passe, et le porteur n'a pas de service de rendu existant à réutiliser. À la place, le prompt du Curateur a été corrigé pour ne plus prétendre « voir » l'œuvre — il juge maintenant explicitement le code/la structure, pas un rendu. La critique post-publication a la même limite, non corrigée dans cette passe (voir risques ouverts).
4. **`batch-memorial.yml` reste indépendant** — hebdomadaire, isolé, ne pèse pas sur le budget des 30 min ; le regrouper dans la fenêtre de minuit aurait ajouté de la charge (mint on-chain) au moment déjà le plus chargé (synthèse + collecte externe).
5. **Migration NEEDS_RETHINK « technique »** — reste en pause jusqu'à une action manuelle admin (`retryGenerative`, déjà existant). Une reprise automatique aurait probablement juste reproduit le même échec structurel.
6. **`ANA_TOPICS_FALLBACK`** reste 10 thèmes fixes — utilisé uniquement quand la file dynamique est vide (association neuve, ou après un incident qui aurait vidé `topic_queue`).

## 4. Variables d'environnement ajoutées

Voir `.env.example` — `ANA_VOTE_QUORUM_RATIO`, `ANA_GROQ_MONTHLY_CALL_CAP`, `ANA_ONEMINAI_MONTHLY_CALL_CAP`, `ANA_SIGNALS_RSS_FEEDS`, `OPENALEX_CONTACT_EMAIL`, `ANA_SIGNALS_ENABLE_EUROPEANA`, `EUROPEANA_API_KEY`, `ANA_SIGNALS_ENABLE_GDELT`, et pour l'observabilité Neon : `NEON_API_KEY`, `NEON_ORG_ID`, `NEON_PROJECT_ID` (déjà documentées comme optionnelles dans `neonUsage.ts`, à ajouter à `.env.example` si le porteur les configure).

Toutes ont un comportement par défaut sûr quand elles sont absentes (pas de plafond = pas de bascule économique ; pas de clé Neon = projection étiquetée comme telle).

## 5. Procédure de rollback

Aucune donnée existante n'a été supprimée ou modifiée par ce travail — tout est additif (nouvelles tables, nouveaux fichiers) sauf les réécritures de `salonStore.ts`, `salon-exchange/route.ts`, `synthesize/route.ts`, `admin/dev-needs/route.ts` et les workflows GitHub.

- **Revenir en arrière avant tout déploiement** : `git checkout -- .` sur les fichiers listés au §6, ou ne pas merger la branche. Rien n'a été commité ni poussé.
- **Après déploiement, si l'orchestrateur pose problème** : réactiver le `schedule:` dans un ou plusieurs des anciens workflows (`auto-exchange.yml`, `work-lifecycle.yml`, `election-cycle.yml`, `activity-catchup.yml`, `check-burns.yml`, `neon-keepalive.yml` — les schedules sont commentés, pas supprimés) et désactiver `orchestrator.yml`. Les routes `/api/keeper/*` sous-jacentes n'ont pas changé de contrat d'authentification.
- **Si les nouvelles tables posent problème** : elles sont indépendantes de `kv_store` — les supprimer (`DROP TABLE ...`) n'affecte ni les works, ni les burns, ni l'élection. `salonStore.ts` retomberait alors en erreur sur toute requête salon — ce n'est PAS un rollback sûr sans revenir aussi au code d'avant cette passe.
- **Migrations** : `schema_migrations` trace ce qui a été appliqué ; aucune migration ne modifie une table existante d'un autre système (works, activity cache, etc.).

## 6. Fichiers modifiés / créés

### Nouveaux fichiers
| Fichier | Rôle |
|---|---|
| `src/lib/migrations.ts` | Schéma des tables + exécuteur |
| `scripts/db-migrate.ts` | CLI `npm run db:migrate` |
| `src/lib/salonMemory.ts` | Décisions, questions ouvertes, engagements, mémoire Normie |
| `src/lib/synthesis.ts` | Synthèse structurée (LLM + validation + persistance) |
| `src/lib/topicEngine.ts` | File de sujets dynamique + machine à états |
| `src/lib/externalSignals.ts` | Collecte de signaux externes (HN, OpenAlex, RSS, Base) |
| `src/lib/voting.ts` | Logique de vote pure (parsing, quorum, traits) |
| `src/lib/voteMetricsStore.ts` | Persistance des métriques de vote |
| `src/lib/devRequests.ts` | Workflow structuré des demandes dev |
| `src/lib/creativeFingerprint.ts` | Empreinte créative + similarité |
| `src/lib/llmLedger.ts` | Grand livre LLM + bascule économique |
| `src/lib/neonUsage.ts` | Usage Neon réel/projection |
| `src/app/api/keeper/orchestrator/route.ts` | Orchestrateur unique 30 min |
| `src/app/api/admin/observability/route.ts` | Tableau de bord admin |
| `.github/workflows/orchestrator.yml` | Nouveau cron consolidé |
| `.env.example` | Variables ajoutées, documentées |
| `vitest.config.ts` + `tests/*.test.ts` (6 fichiers, 42 tests) | Tests unitaires |
| `IMPLEMENTATION_PERENNISATION_ANA.md` | Cette note |

### Fichiers réécrits en profondeur
| Fichier | Changement principal |
|---|---|
| `src/lib/salonStore.ts` | Blob unique → tables relationnelles, `Salon` compact vs `SalonDetail` |
| `src/app/api/keeper/salon-exchange/route.ts` | Synthèse retirée (déplacée à l'orchestrateur), file de sujets dynamique, contexte ciblé, actes de parole variés |
| `src/app/api/keeper/synthesize/route.ts` | Synthèse par salon/seuil au lieu de mensuelle globale |
| `src/app/api/admin/dev-needs/route.ts` | Nouveau workflow structuré |

### Fichiers modifiés ponctuellement
| Fichier | Changement |
|---|---|
| `src/lib/db.ts` | Ajout de `query()` pour les requêtes relationnelles paramétrées |
| `src/lib/workStore.ts` | Ajout de l'état `NEEDS_RETHINK`, compteurs de vote cumulés |
| `src/lib/normiesPersona.ts` | Règle « NEVER ECHO » assouplie |
| `src/lib/autoVote.ts`, `src/lib/proposeWork.ts` | Instrumentation du grand livre LLM |
| `src/app/api/keeper/work-lifecycle/route.ts` | Fix bug traits `[object Object]`, retry vote, quorum, coupe-circuit `NEEDS_RETHINK`, empreinte créative, fix prompt Curateur |
| `src/app/api/salon/route.ts`, `src/app/api/salon/[id]/route.ts` | Cache 30 min, suppression de `getSynthesisInfo` |
| `src/app/api/normies/[tokenId]/messages/route.ts` | Requête directe au lieu d'itérer `listSalons()` |
| `src/app/api/memorials/list/route.ts` | Cache 60 s → 30 min |
| `src/app/api/ana-art/feed/route.ts` | **Fix sécurité** : retrait du cache CDN public sur une route protégée par secret |
| `src/components/HomeLiveActivity.tsx`, `src/app/[locale]/salon/SalonClient.tsx` | Adaptation au nouveau type `Salon` compact (bug de rupture trouvé et corrigé pendant cette passe) |
| `src/app/[locale]/docs/api/page.tsx` | Exemple de réponse `/api/salon` mis à jour |
| `.github/workflows/{auto-exchange,work-lifecycle,election-cycle,activity-catchup,check-burns,neon-keepalive}.yml` | `schedule:` retiré, `workflow_dispatch` conservé |
| `vercel.json` | `maxDuration` pour `orchestrator` et `synthesize` |
| `package.json` | `vitest`, scripts `db:migrate`/`test` |

## 7. Résultats des tests

- `npx tsc --noEmit` → **0 erreur** (dernière vérification après tous les changements)
- `npx vitest run` → **42/42 tests passés**, 6 fichiers (`voting`, `topicEngine`, `synthesis`, `devRequests`, `creativeFingerprint`, `externalSignals`) — tous en mode mémoire locale (pas de Neon dans l'environnement de test)
- `npm run build` (Next.js production) → build complet réussi, toutes les routes API compilées (dont `orchestrator` et `observability`)
- Aucun appel LLM réel ni transaction on-chain déclenché pendant les tests — tout passe par le repli local des modules (`USE_NEON === false`)
- **Non exécuté** : `npm run db:migrate` contre la base de production — c'est au porteur de le lancer, au moment de son choix, avec la chaîne de connexion Neon réelle

## 8. Vérifications demandées par le brief initial

| Vérification | Statut |
|---|---|
| Aucune route authentifiée n'est publiquement cachée | ✅ Fixé : `/api/ana-art/feed` n'utilise plus de cache CDN public |
| Pas de doubles crons | ✅ Les anciens `schedule:` sont retirés ; un seul `orchestrator.yml` actif |
| Une synthèse en échec n'avance pas le curseur | ✅ `storeSynthesis()` n'est appelée qu'après un résultat LLM validé |
| Un sujet clos n'est pas repris sans nouvelle provenance | ✅ `SELECTABLE_PHASES` exclut `CLOSED`/`PARKED` de la sélection |
| Une sortie de vote invalide n'est jamais enregistrée comme abstention | ✅ `parseVoteChoice()` retourne `null`, jamais `"abstain"`, sur JSON invalide |
| Le mode économie ne bloque jamais votes/mémoire/intégrité on-chain | ✅ La bascule économique (`shouldPreferEconomyProvider`) ne touche que le choix de fournisseur LLM pour la parole en salon, jamais les votes ni la synthèse |
| Build de production | ✅ Réussi |

## 9. Risques restant ouverts

1. **Reset admin incomplet** (voir §3.1) — `reset-database` ne vide plus les nouvelles tables. Risque : après un « wipe » supposé total, d'anciennes demandes dev/métriques de vote/messages de salon subsistent.
2. **Migration des données historiques** non faite (voir §3.2) — les 184 messages/17 salons mentionnés dans `NEON_COST_AUDIT.md` restent dans l'ancien format tant qu'un script de migration ponctuel n'est pas écrit et exécuté par le porteur.
3. **Critique post-publication** toujours sans accès au rendu réel ni au texte complet pour les œuvres HTML — seul le Curateur (avant publication) a été corrigé pour ne plus prétendre « voir ». La critique communautaire post-publication garde la même limite documentée par l'audit de septembre.
4. **Approximation de la machine à états de sujet** — `needsResolution()` est piloté par `timesUsed × 2` comme proxy du nombre de messages depuis le dernier changement de phase, faute d'un compteur dédié par sujet. C'est une approximation raisonnable mais pas un comptage exact.
5. **Double flagging dev-needs** — un Normie peut encore poster `[DEV-NEEDED]` sur un sujet déjà couvert avec un vocabulaire très différent du titre existant (le dédoublonnage est un recouvrement de mots, pas sémantique) → créerait une deuxième entrée.
6. **API de consommation Neon non testée en conditions réelles** — l'endpoint et le format de réponse ont été vérifiés contre la documentation Neon actuelle (26/09/2026), mais jamais appelés avec une vraie clé API dans cette session.
7. **Vercel Hobby et le plafond de 60 s** (voir §2.4) — l'orchestrateur parallélise ses sous-appels mais reste exposé si un sous-appel individuel (`work-lifecycle` notamment) approche régulièrement les 60 s.
8. **Aucune migration de `salon-store` n'a été validée en conditions réelles** — tout le code relationnel a été testé en local (sans Neon) et vérifié par `tsc`/`vitest`/`build`, mais jamais exécuté contre une vraie base Neon dans cette session.
