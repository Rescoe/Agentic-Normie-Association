# Audit de coût Neon — Agentic Normie Association (ANA)

Document préparé le 26/09/2026 pour revue externe (ChatGPT). Objectif : vérifier que les correctifs déjà appliqués sont corrects et suffisants, et trouver tout ce qu'il resterait à corriger.

## Objectif business (contrainte dure)

- Rester le plus proche possible de **0 $/mois**. Le projet est une expérimentation sans budget.
- **Repasser sur le plan Neon "Free" en octobre 2026** (actuellement sur "Launch" temporairement, activé en urgence après un dépassement de quota fin septembre).
- Condition explicite du porteur du projet : **le nombre de visiteurs ne doit pas faire varier le coût de façon linéaire**. Que ce soit 1 visiteur ou 1000+, simultanément, avec un onglet potentiellement laissé ouvert 24h/24 sur des dizaines de postes différents, le coût Neon doit rester quasi nul et ne jamais mettre le projet en dépassement de quota.
- Tous les chiffres doivent être vérifiables/chiffrés — pas d'approximation non signalée comme telle.

## Stack technique concernée

- **Neon Postgres serverless**, plan actuel : **Launch** ($0.106/CU-heure de compute, $0.35/Go-mois de stockage, 500 Go de transfert réseau inclus puis $0.10/Go, plage de compute 0.25↔8 CU configurée, "Scale to zero" activé à 5 minutes d'inactivité par défaut — confirmé actif dans les paramètres du projet).
- Limites du plan **Free** de Neon (à re-vérifier sur neon.tech/pricing au moment de la bascule en octobre, ces chiffres peuvent changer) : de l'ordre de ~190 heures de compute/mois, 0.5 Go de stockage, 5 projets, scale-to-zero uniquement (pas d'autoscaling multi-CU). **Ce point n'a pas été re-vérifié en direct dans cette session — à confirmer avant la bascule.**
- Driver utilisé côté serveur : `@neondatabase/serverless`, fonction `neon()` en mode HTTP (`fetchOptions: { cache: "no-store" }`) dans `src/lib/db.ts:56`. **Confirmé : pas de pool de connexions persistant, pas de WebSocket.** Chaque requête SQL est un appel HTTP à la demande — donc la question n'est jamais "une connexion reste ouverte" mais uniquement "à quelle fréquence le code touche-t-il la base, ce qui réinitialise le minuteur d'inactivité de 5 minutes de Neon à chaque fois".
- Déploiement : Vercel (Next.js App Router). Repo GitHub `Rescoe/Agentic-Normie-Association`, branche `main`, déploiement automatique sur push.
- Le repo comporte aussi des GitHub Actions cron qui appellent des routes serveur (`/api/keeper/*`) indépendamment du trafic visiteur.

## Chiffres observés (avant correctifs), fournis par le porteur du projet via la console Neon

| Période | Compute (CU-hrs) | Storage | Network transfer | Coût |
|---|---|---|---|---|
| 16→24 sept (~8j) | 36.79 | 0.06 GB | 5.35 GB | quota Free dépassé, bascule forcée sur Launch |
| ~12h (24-25 sept) | 5.63 | 32.81 MB | 1.3 GB | 0.58 $ |
| ~36h (24-26 sept) | 11.07 | 33 MB | 2.21 GB | ~1.20 $ (~0.40 $/12h) |

Point clé : `0.25 CU × 36h = 9.0 CU-hrs` si le compute tournait en continu au strict minimum (0.25 CU) sans jamais suspendre. L'observé (11.07) est proche de ce plancher + quelques pics ponctuels à ~1 CU — ce qui indique que le compute **ne suspendait quasiment jamais**, cohérent avec le diagnostic ci-dessous.

## Ce qui a été audité et corrigé, dans l'ordre chronologique

### Vague 1 (session précédente)
- `LiveEventsBanner.tsx` (bandeau monté site-wide via `Navbar`) : polling `/api/status` réduit 30s → 3min → **30 min**, avec pause complète via `document.visibilitychange` quand l'onglet est en arrière-plan, et refetch immédiat au retour au premier plan.
- `SalonClient.tsx` (page `/salon`) : même traitement, 30s → 60s → **30 min** + pause.
- GitHub Actions cron : `activity-catchup.yml` 5min → **20min** ; `check-burns.yml` 15min → **1h**.
- Cache mémoire in-process (par instance Lambda chaude, TTL) ajouté à `src/lib/workStore.ts` (15s) et `src/lib/drawStore.ts` (15s) ; `src/lib/salonStore.ts` en avait déjà un (30s), antérieur à cette session.
- **Limite connue de ce cache** : il est local à une instance serverless. Sous forte charge concurrente, Vercel crée plusieurs instances en parallèle, chacune avec son propre cache vide — donc ce cache protège les appels séquentiels répétés sur une même instance chaude, **pas** un pic de trafic concurrent.

### Vague 2 (cette session — audit du code)
Deux pollers agressifs avaient été oubliés lors de la vague 1, tous deux branchés sur `/api/works` (Neon via `workStore.ts`) :
- `src/components/WorkInProgress.tsx` (widget page d'accueil) : **15 secondes**, sans condition.
- `src/app/[locale]/works/WorksClient.tsx` (page `/works`) : **20 secondes**, sans condition — le commentaire d'origine dans le code disait explicitement "sans polling, un onglet laissé ouvert ne voit jamais avancer les works", ce qui est exactement le scénario problématique décrit par le porteur du projet.

Ces deux-là ont reçu le même traitement que la vague 1 : 30 minutes + pause sur `visibilitychange`.

**Vérification faite dans cette session, par grep exhaustif sur tout `src/` :**
- Tous les autres `setInterval`/`refetchInterval` restants dans le code sont des `useReadContract` (librairie wagmi) — donc des lectures **blockchain via RPC**, pas des lectures Neon. Fichiers concernés : `admin/page.tsx`, `assembly/AssemblyClient.tsx`, `register/RegisterClient.tsx`, `GovernanceCalendarWidget.tsx`. Ce sont des coûts RPC potentiels (à auditer séparément si besoin), pas des coûts Neon.
- `src/middleware.ts` : ne touche pas la base (juste le routing i18n `next-intl`).
- `HomeLiveActivity.tsx` (widget page d'accueil) : fait 3 appels Neon (`/api/works`, `/api/salon`, `/api/burns/stats`) mais **une seule fois au montage**, sans boucle — proportionnel au trafic réel, pas un problème en soi (voir vague 3 pour le vrai risque que ça pose à fort trafic).

### Vague 3 (cette session — cache HTTP/CDN, pour la question "1000 visiteurs")
Constat : les routes suivantes étaient toutes déclarées `export const dynamic = "force-dynamic"` **sans aucun header de cache** — donc chaque requête, de chaque visiteur, invoquait la fonction serverless et retouchait Neon (voire une lecture blockchain en plus), sans aucun partage entre visiteurs. C'est ce qui fait qu'un pic de trafic (1000+ visiteurs simultanés) aurait un coût strictement proportionnel au nombre de visiteurs, indépendamment de tout le travail des vagues 1 et 2.

Correctif appliqué : ajout d'un header `Cache-Control: public, s-maxage=N, stale-while-revalidate=M` sur la réponse de chaque `GET` (les `POST`, qui sont des écritures, ne sont volontairement pas touchés et restent 100% dynamiques) :

| Route | Appelée par | s-maxage | stale-while-revalidate |
|---|---|---|---|
| `GET /api/works` | Page d'accueil, `/works`, `/admin` | 30s | 120s |
| `GET /api/salon` | Page d'accueil, `/salon` | 30s | 120s |
| `GET /api/status` | `LiveEventsBanner` (site-wide) | 30s | 120s |
| `GET /api/burns/stats` | Page d'accueil, `/burns` | 30s | 120s |
| `GET /api/memorials/list` | **`Footer.tsx` — présent sur TOUTES les pages du site** | 60s | 300s |
| `GET /api/members` | Page `/members` | 60s | 300s |

Principe : le réseau Edge de Vercel sert la réponse directement depuis son cache pendant la fenêtre `s-maxage`, **sans invoquer la fonction serverless du tout** — donc sans toucher Neon. Résultat attendu : 10 ou 10 000 visiteurs simultanés ne déclenchent qu'un appel Neon toutes les 30 à 60 secondes sur ces routes, pas un appel par visiteur.

**Ce point n'a PAS encore été vérifié empiriquement** (voir section "à vérifier" ci-dessous) : je n'ai pas confirmé après déploiement que Vercel répond bien avec un header `x-vercel-cache: HIT` sur les requêtes répétées. C'est une hypothèse basée sur le comportement documenté de Vercel pour les Vercel Functions (Node.js runtime, App Router `route.ts`), pas une mesure.

## Ce qui touche Neon aujourd'hui — inventaire complet

### Déclenché par le trafic visiteur (navigateur)
Toutes les routes ci-dessus (vague 3), plus tout composant qui fait un `fetch("/api/...")` une seule fois au montage sans intervalle (proportionnel au trafic réel, pas un problème structurel, mais chaque route individuelle n'a pas forcément de cache — voir "non audité" plus bas).

### Déclenché indépendamment du trafic (GitHub Actions cron → routes `/api/keeper/*`)
| Workflow | Fréquence | Appels Neon/jour (approx.) |
|---|---|---|
| `auto-exchange.yml` (salon-exchange) | */30min | 48 |
| `work-lifecycle.yml` | toutes les 2h | 12 |
| `election-cycle.yml` | toutes les 6h | 4 |
| `activity-catchup.yml` | */20min | 72 |
| `check-burns.yml` | toutes les heures | 24 |
| `neon-keepalive.yml` | hebdomadaire | négligeable |
| `batch-memorial.yml` | hebdomadaire | négligeable |

**Point important pour l'objectif "repasser en Free" : ces cron constituent un plancher incompressible.** Même avec un trafic visiteur nul et un cache parfait, ces ~160 réveils/jour du compute existent. Le cron le plus fréquent (20 min) laisse en théorie une fenêtre de ~15 minutes d'inactivité entre deux réveils (20 min − 5 min de timer), donc le compute DEVRAIT pouvoir suspendre entre deux passages — mais ceci n'a pas été mesuré indépendamment du trafic visiteur.

### Cache in-process existant (rappel)
- `workStore.ts` : 15s
- `salonStore.ts` : 30s
- `drawStore.ts` : 15s (store encore vide actuellement)

## Ce qui n'a PAS été audité / vérifié — à creuser en priorité

1. **Vérification empirique du cache Edge Vercel** : confirmer après déploiement, via `curl -I` ou les DevTools réseau, que les 6 routes de la vague 3 renvoient bien `x-vercel-cache: HIT` sur une deuxième requête rapprochée, et que le nombre réel d'invocations de fonction (visible dans le dashboard Vercel, onglet Functions) chute bien en conséquence.
2. **Autres routes GET publiques appelées au chargement de page, jamais auditées pour le cache**, trouvées par recherche mais non traitées dans cette session (à évaluer selon leur fréquence de trafic réelle) :
   - `GET /api/works/html/[id]` — **potentiellement la plus critique** : chargée en `<iframe>` directement sur la page d'accueil (`HomeLiveActivity.tsx`), jusqu'à 3 fois par visite, et sert le contenu HTML complet d'une œuvre (peut être volumineux).
   - `GET /api/works/[id]`, `GET /api/salon/[id]`, `GET /api/salon/[id]/messages`, `GET /api/memorials/[memorialId]`, `GET /api/celebrations/list`, `GET /api/normies/[tokenId]/messages`, `GET /api/works/certificate/[id]`, `GET /api/works/html/by-collection/[address]`.
   - Certaines de ces routes ont un TTL de fraîcheur naturellement plus long (page de détail d'une œuvre déjà publiée, qui ne change plus) — candidates à un `s-maxage` encore plus long (plusieurs minutes, voire heures) que les 30-60s appliqués aux routes "live".
3. **Coût Vercel lui-même** (fonctions serverless, bande passante) : **non audité du tout dans cette session**. Chaque appel de cron GitHub Actions et chaque requête non mise en cache consomme aussi le quota Vercel (invocations de fonctions, durée d'exécution, bande passante sortante) — budget séparé de Neon, avec son propre plan gratuit et ses propres limites. Si l'objectif est "rester à 0 $" au sens large, ce point mérite un audit dédié.
4. **Coût RPC blockchain** (Base mainnet) : les nombreux `useReadContract` avec `refetchInterval` de 5 à 15 secondes trouvés dans `admin/page.tsx` et `assembly/AssemblyClient.tsx` ne coûtent rien à Neon mais peuvent coûter cher en RPC selon le fournisseur utilisé (`BASE_RPC_URL`) — hors périmètre de cet audit Neon mais à surveiller si le fournisseur RPC facture au volume.
5. **Limites précises du plan Free Neon en 2026** : les chiffres cités plus haut (190h compute, 0.5 Go stockage, etc.) viennent de la mémoire générale et n'ont pas été re-vérifiés sur la page de pricing en direct dans cette session — à confirmer avant la bascule d'octobre.
6. **Effet réel des correctifs pas encore mesuré** : les vagues 2 et 3 ont été déployées il y a quelques heures seulement au moment de la rédaction de cet audit. Aucune donnée de consommation Neon post-déploiement n'a encore pu être observée.
7. **Pont ANA ↔ proof-of-draw** (`ana-bridge`, endpoint `/api/ana-art/feed`) : utilisé par des devices ESP externes pour récupérer des dessins/célébrations. Non audité ici — vérifier si ces appels touchent le même projet Neon et à quelle fréquence les devices interrogent cette route.

## Ce qu'on demande à la relecture (ChatGPT)

1. Scanner l'ensemble de ce qui est décrit ci-dessus et confirmer/infirmer que l'architecture proposée (cache Edge Vercel `s-maxage` + polling client réduit à 30 min avec pause sur `visibilitychange` + cache in-process 15-30s) suffit réellement à garantir qu'**1 visiteur ou 1000+ visiteurs simultanés, y compris avec des onglets laissés ouverts en continu sur des dizaines de postes, ne fassent pas varier le coût Neon de façon linéaire avec le trafic**.
2. Vérifier s'il existe un angle mort côté Next.js/Vercel : est-ce que `export const dynamic = "force-dynamic"` combiné à un header `Cache-Control` manuel sur la réponse est bien suffisant pour activer le cache Edge de Vercel sur une route `route.ts` (App Router, runtime Node.js) ? Ou existe-t-il une meilleure pratique (`export const revalidate = N` sans `force-dynamic`, Vercel Data Cache, etc.) plus fiable ou plus économe ?
3. Identifier si les routes listées en "non auditées" (point 2 ci-dessus) doivent être traitées en priorité avant la bascule sur le plan Free, en particulier `/api/works/html/[id]` vu qu'elle est sur la page d'accueil.
4. Proposer, si pertinent, une méthode de vérification empirique simple (curl, en-têtes réponse, dashboard Vercel) pour confirmer que le cache fonctionne réellement en production avant la bascule Free d'octobre.
5. Évaluer si le plancher des cron GitHub Actions (~160 réveils/jour) est compatible avec les limites du plan Free Neon, en particulier le nombre d'heures de compute mensuel.
