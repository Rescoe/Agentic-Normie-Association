# Étude de faisabilité — ANA → Proof of Draw : boucles génératives et poèmes sur OLED/TFT

**Statut : étude préalable, aucun code ni contrat modifié.** Rapport produit le 26/09/2026 par exploration directe des deux dépôts locaux :
- ANA — dépôt `Agentic-Normie-Association`
- Proof of Draw (PoD) — dépôt `proof-of-draw`

Sources lues intégralement ou par extraits ciblés : `proof-of-draw/AGENTS.md`, `proof-of-draw/CLAUDE.md`, `lib/screenProfiles.ts`, `lib/anaFeed.ts`, `lib/anaChain.ts`, `lib/queue.ts`, `lib/broadcast.ts`, `lib/screenEncode.ts`, `lib/redisBudget.ts`, `lib/deviceStore.ts` (extraits), `app/api/pull/route.ts`, `app/api/pull-frame/route.ts`, `app/api/ack-frame/route.ts`, `esp8266/esp_tft1.8/esp_tft1.8.ino`, `esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino` ; côté ANA : `src/app/api/works/html/[id]/route.ts`, `src/lib/generativeArtwork.ts`, `src/lib/artworkServer.ts` (extraits), `src/lib/workStore.ts` (extraits), `contracts/creative/WorkRegistry.sol`, `contracts/editions/ANAEditions.sol`, plus un audit délégué qui a lu intégralement `src/app/api/ana-art/feed/route.ts`, `src/lib/memorialArt.ts`, `src/lib/drawStore.ts`, `src/app/api/keeper/work-lifecycle/route.ts`, `src/app/api/draw/[id]/peer-review/route.ts`.

**⚠️ Note sur `proof-of-draw/AGENTS.md` et `CLAUDE.md` : datés du 16/05/2026, ils décrivent une architecture mono-écran e-ink antérieure à l'introduction de `oled096`/`tft18`, au pont ANA (`lib/anaFeed.ts`, commits de septembre) et à la carte SD sur le firmware TFT. Les invariants mémoire/sécurité qu'ils posent restent valides et ont été vérifiés dans le code actuel, mais leur description du pipeline et de l'état du projet est obsolète — cette étude s'appuie sur le code réel, pas sur ces deux fichiers.**

---

## 1. Résumé exécutif

Le pont ANA→PoD actuel (`lib/anaFeed.ts`, `lib/screenEncode.ts`) ne transporte que des dessins pixel fixes 1 bit — memorials de deuil (`artForm: "pixel-drawing"`, 360×240, généré par primitives géométriques bornées, jamais par du code exécuté) et dessins spontanés approuvés. **Aucune œuvre générative HTML/JS ni aucun poème ne transite aujourd'hui par `GET /api/ana-art/feed`** : la route ANA filtre explicitement sur `artForm === "pixel-drawing"`. Étendre le pont aux œuvres génératives et aux poèmes est donc un vrai chantier des deux côtés, pas une simple généralisation du format de frame.

Le firmware cible (ESP8266 exclusivement, aucun ESP32 dans le parc) a deux profils pertinents :
- **OLED 0.96" (`oled096`)** : 128×64, 1bpp, 1024 octets/frame, buffer RAM unique + persistance EEPROM 1 frame (1540 octets d'EEPROM total sur la carte combinée OLED+e-ink), pas de SD, pas de LittleFS.
- **TFT 1.8" (`tft18`)** : 128×160, RGB565, 40 960 octets/frame, **jamais bufferisé entièrement en RAM** — le firmware actuel diffuse la frame ligne par ligne directement du réseau vers l'écran (SPI logiciel bit-bang), et dispose d'une carte SD déjà câblée mais dont la persistance de frame est du code mort (désactivé car `malloc(40960)` échoue sur ESP8266).

**La limite de 30 frames proposée n'est pas confirmée pour l'un ou l'autre écran dans l'architecture actuelle.** Pour l'OLED, elle entre en collision avec le budget heap partagé avec BearSSL/TLS qui se rouvre périodiquement même pendant la lecture d'une animation (voir §4-5). Pour le TFT, la RAM n'est pas le facteur limitant (le streaming ligne-par-ligne l'évite déjà) mais le firmware n'a aujourd'hui aucun mécanisme de lecture multi-frame depuis la SD, et la vitesse réelle du SPI logiciel vers l'écran n'est pas mesurée. **Recommandation : démarrer à 10 frames sur les deux profils, mesurer sur matériel réel (heap OLED, débit SPI TFT), puis étendre.**

Verdict séparé (détail §19) : **OLED = GO avec réduction** (10 frames en RAM sûr aujourd'hui ; 30 frames nécessite un stockage flash/LittleFS, hors périmètre de cette session). **TFT = GO avec réduction, sous réserve de mesures** (SD déjà présente, mais lecture multi-frame SD↔écran et vitesse SPI logicielle non validées).

---

## 2. Architecture actuelle réellement observée

### 2.1 Côté ANA — ce qui existe et ce qui n'existe pas encore

| Type de contenu | `artForm` | Stockage on-chain | Passe par `/api/ana-art/feed` ? |
|---|---|---|---|
| Memorial de deuil ("celebration") | `pixel-drawing` | Pas de contrat dédié pour la pièce elle-même — publié comme `ANAWork` standard | ✅ Oui — c'est le cas d'usage actuel du pont |
| Dessin spontané approuvé | — (hors `ANAWork`, `SpontaneousDrawing` dans `lib/drawStore.ts`) | Aucun, jamais on-chain | ✅ Oui |
| Poème | `haiku`\|`sonnet`\|`poeme`\|`prose`\|`manifeste` | `ANAEditions.artworkContent` = texte UTF-8 brut (pas de préfixe `data:`) | ❌ **Non — exclu explicitement** |
| Œuvre générative | `html-canvas`\|`html-p5js`\|`html-threejs`\|`html-webgl` | `ANAEditions.artworkContent` = `data:text/html;base64,<b64>` | ❌ **Non — exclu explicitement** |

Le commentaire de tête de `src/app/api/ana-art/feed/route.ts` est explicite : *"read-only feed of human-drawn pixel pieces ready for physical screens"* — il ne fusionne que `listWorks()` filtré sur `artForm === "pixel-drawing" && state === "PUBLISHED"` et `listDrawings()` filtré sur `decision === "approved"`. Le "cartel" (texte de l'artiste) n'est lui-même jamais envoyé (`memorialArt.ts` : *"never sent to proof-of-draw"*).

Génération des pixels memorial (`src/lib/memorialArt.ts`) : un LLM (Groq `openai/gpt-oss-120b`) compose une liste bornée de primitives géométriques (`rect|circle|line|dots`, max 18 formes) ; `rasterize()` transforme ça en `Uint8Array` déterministe — **"the LLM doesn't paint pixels directly"**, aucune exécution de code. Canvas actuel : **360×240** (`MEMORIAL_CANVAS_W`/`MEMORIAL_CANVAS_H`), après deux changements historiques (264×176 → 528×352 → 360×240, ce dernier motivé par un revert on-chain "out of gas" sur `registerMemorial()` — le plafond de gas Base mainnet documenté dans la mémoire du projet, ~16,77M gas).

**Incohérence de documentation relevée** : le commentaire de `proof-of-draw/lib/screenEncode.ts` cite encore *"currently 528x352"* comme canvas source ANA — c'est la valeur intermédiaire historique, plus la valeur actuelle (360×240). Sans impact fonctionnel (le canvas réel est toujours lu depuis `canvasW`/`canvasH` de l'item, jamais codé en dur côté PoD), mais à corriger dans le commentaire le jour où quelqu'un touche ce fichier.

Aucun concept de "type d'œuvre" n'existe on-chain : `WorkRegistry.Work.content` est toujours une data-URI HTML (le certificat), et `ANAEditions.artworkContent` ne porte aucun discriminant explicite — le contrat lui-même sniffe le préfixe `data:` pour décider s'il expose le contenu comme `animation_url` ou comme `description` texte échappé (`ANAEditions.sol` lignes ~274-305). La distinction pixel-art / poème / génératif est **entièrement une convention côté app** (`ANAWork.artForm` dans `workStore.ts`), jamais reflétée dans un contrat.

Pipeline de publication (`src/app/api/keeper/work-lifecycle/route.ts`) : les œuvres standards (poème, génératif) suivent `PROPOSED → VOTE_OPEN → VOTE_TALLIED → BRIEFING → CREATING → VALIDATING → PUBLISHING → PUBLISHED` ; les memorials sautent `BRIEFING/CREATING/VALIDATING` (déjà créés à la proposition, votés après) ; les dessins spontanés ne touchent jamais la chaîne. Le moment d'éligibilité au feed actuel est donc soit `ANAWork.state === "PUBLISHED" && artForm === "pixel-drawing"`, soit `SpontaneousDrawing.decision === "approved"`.

### 2.2 Côté Proof of Draw — pipeline pixel-art actuel

```
ANA (kind: celebration|spontaneous, pixels base64 grayscale, canvasW×canvasH, title, agentTokenId)
  → GET /api/ana-art/feed?limit=50  (header x-feed-secret, appelé depuis PoD)
  → lib/anaFeed.ts : maybeCheckAnaFeed() — débounce Redis (ANA_FEED_CHECK_DEBOUNCE_SEC, def. 60s),
    déclenché opportunément depuis app/api/pull/route.ts quand un device acceptsAnaArt fait un pull
    (PAS de cron — voir invariant CLAUDE.md "no cron, opportunistic checks on read/write")
  → dédup via Redis Set chain:ana:ingested (clé = item.id)
  → pour chaque écran opt-in (getAnaArtDevices(screen)) :
      lib/screenEncode.ts : resizeLetterboxGrayscale() (aspect-ratio préservé, padding blanc,
        échantillonnage "pixel le plus sombre" — évite la disparition des lignes fines au downscale)
        puis encodeOled096/encodeEink27bw/encodeEink29bwr/encodeTft18()
      → lib/broadcast.ts : broadcastToDevices() — écrit directement en Redis (frame:{deviceId}:{screen}),
        TTL ANA_FRAME_TTL_SEC = 7200s (2h — délibérément long, voir §"bug ACK historique" ci-dessous)
      → lib/anaChain.ts : createAnaBlock() — persistance permanente pour la galerie "Dessins d'agent IA"
        (chain:ana:recent / chain:ana:block:*, jamais mêlée à chain:recent humain)
  → ESP : GET /api/pull (metadata + screen ciblé) → GET /api/pull-frame?screen=...&fmt=bin (binaire brut)
  → affichage local → POST /api/ack-frame (supprime la clé Redis)
```

Le pont ANA est **délibérément non-cron** : `maybeCheckAnaFeed()` utilise un verrou Redis `SET NX EX` pour garantir au plus un vrai fetch sortant par fenêtre de debounce, peu importe combien de devices font un pull en même temps — c'est exactement le patron "vérification opportuniste, zéro appel par frame" que le cahier des charges demande de préserver pour l'extension.

**Bug historique pertinent pour le futur design du multi-frame** : `lib/broadcast.ts` documente qu'un TTL de 15 min (`DRAW_WINDOW_SEC`, pensé pour la fenêtre de vote humain) était insuffisant pour du contenu ANA — un device ne pull qu'au mieux 1×/7,5 min (rate-limit `PULL_LIMIT_PER_WINDOW`), et une œuvre a réellement expiré de Redis avant d'atteindre un écran physique (23/09, "Monument — 200 Normies"). Le TTL a été porté à 7200s. **Cette même classe de bug s'appliquera à un paquet multi-frame** si son TTL de mise en attente est trop court par rapport au temps de téléchargement — le paquet est plus gros, donc le risque est plus élevé, pas moindre.

### 2.3 Risques déjà documentés par une étude PoD antérieure (rappel, non ré-audités ici)

Le brief cite 5 risques PoD connus. Ce que le code confirme directement :
1. **Item marqué ingéré avant livraison effective** — confirmé structurellement : `checkAnaFeedNow()` fait `redis.sadd(KEY_INGESTED, item.id)` (dédup permanente) **avant** que `broadcastToDevices()` confirme quoi que ce soit côté device (`lib/anaFeed.ts` lignes 113-117). Un item marqué ingéré dont le broadcast échoue silencieusement (device offline, erreur Redis transitoire) ne sera **jamais retenté** — dédup et suivi de livraison sont la même primitive.
2. **Plusieurs œuvres qui s'écrasent dans une clé frame unique** — corrigé pour le cas simple (une frame par `(device, screen)`, voir commentaire de tête de `lib/queue.ts`), mais reste vrai pour deux items ANA consécutifs sur le **même** écran arrivant avant qu'un pull n'ait eu lieu : `storeFrame()` écrase silencieusement (`redis.set`, pas de vérification d'existant).
3. **Les ACK ne prouvent pas l'affichage** — confirmé au niveau firmware (§5) : `ackFrame()` est appelé juste après que l'appel local d'affichage (`oled.display()` / `tft.writePixels()`) **retourne**, jamais après une vérification quelconque que le panneau physique montre effectivement l'image.
4. **Pas de transport multi-frame** — confirmé : `FramePayload` (`lib/queue.ts`) est une union discriminée à un seul buffer par écran ; aucun champ `frameIndex`/`frameCount` n'existe nulle part dans le pipeline serveur ni firmware.
5. **Firmware conçu autour d'une seule frame** — confirmé (§5).

---

## 3. Tableau des profils OLED/TFT (source unique : `lib/screenProfiles.ts`)

| Profil | Résolution | Format | Octets/pixel effectif | `bufferSize`/frame | Bus écran | Stockage local disponible |
|---|---|---|---|---|---|---|
| `oled096` | 128×64 | 1bpp (SSD1306, page-major) | 0,125 | **1024 octets** | I2C, `Wire.setClock(100000)` → 100 kHz | EEPROM 1540 B (flash-émulée), 1 frame captée en persistance, pas de SD/LittleFS |
| `tft18` | 128×160 | RGB565 | 2 | **40 960 octets** | SPI **logiciel** (bit-bang, `Adafruit_ST7735` constructeur 5 args) | Carte SD physique câblée (bus SPI partagé avec l'écran, switch `spiForSD()`/`spiForTFT()` requis), EEPROM 512 B (clés + hash de bloc uniquement) |

Hors périmètre (exclus par le brief, confirmé par le code) : `eink29bwr` (296×128, BWR, 4736 B/canal ×2) et `eink27bw` (176×264, BW, 5808 B) — tous deux e-ink, `E27_MIN_REFRESH_MS = 180000` (180s minimum entre rafraîchissements, contrainte physique du panneau Waveshare) : une animation y serait de toute façon plafonnée à ~1 frame toutes les 3 minutes, incompatible avec toute notion de "boucle".

---

## 4. Tableau mémoire/taille pour 10, 15, 20 et 30 frames

### 4.1 Taille brute (`largeur × hauteur × octets/pixel × frameCount`)

| Frames | OLED (1024 B/frame) | TFT (40 960 B/frame) |
|---|---|---|
| 10 | 10 240 B (10,0 KB) | 409 600 B (400,0 KB) |
| 15 | 15 360 B (15,0 KB) | 614 400 B (600,0 KB) |
| 20 | 20 480 B (20,0 KB) | 819 200 B (800,0 KB) |
| 30 | 30 720 B (30,0 KB) | 1 228 800 B (1200,0 KB ≈ 1,17 MB) |

### 4.2 Budget RAM réel — OLED (le facteur limitant est la RAM, pas le stockage)

Chiffres cités **textuellement** dans le code/doc existants (aucun n'est inventé ici) :
- `CLAUDE.md` (16/05, à re-vérifier sur le firmware actuel — voir §18) : *"L'ESP8266 a ~47KB de heap après WiFi. BearSSL consomme ~16KB par connexion TLS de façon fragmentée."*
- `esp_tft1.8.ino` (commentaire ligne 1265) : *"malloc(40960) échouerait sur ESP8266 (heap ~30KB après BearSSL)"*.
- Le firmware ESP8266 a une RAM physique totale de 80 KB (fiche technique du SoC — hors dépôt, connaissance matérielle standard) ; l'écart avec les ~47 KB "libres après WiFi" vient de la pile TCP/IP, des buffers WiFi et de l'overhead du core Arduino.

Point critique : **le firmware ne reste jamais durablement "hors TLS"**. `PULL_INTERVAL = 60000` et `VALIDATE_INTERVAL = 30000` déclenchent une reconnexion `WiFiClientSecure`/BearSSL toutes les 30-60 secondes **même pendant qu'une animation locale tourne en boucle** — rien dans le firmware actuel ne suspend le cycle pull/validate pendant l'affichage. Un buffer d'animation résident doit donc coexister avec une réouverture BearSSL périodique (~16 KB), pas avec un heap totalement libre.

| Frames OLED (RAM) | Taille buffer | + BearSSL récurrent (16 KB) | Marge restante sur ~47 KB | Évaluation |
|---|---|---|---|---|
| 10 | 10 KB | 26 KB | ~21 KB | Sûr |
| 15 | 15 KB | 31 KB | ~16 KB | Raisonnable, à confirmer |
| 20 | 20 KB | 36 KB | ~11 KB | Risqué (JSON, ticker, fragmentation) |
| 30 | 30 KB | 46 KB | **~1 KB** | **Non viable en l'état** — échec de malloc quasi garanti au premier cycle réseau concurrent |

Ce calcul ne compte même pas la fragmentation heap (connue sur ESP8266 avec des cycles malloc/free répétés de tailles différentes), le buffer SSD1306 lui-même (1024 B, déjà résident via `oled.getBuffer()`), ni les documents `ArduinoJson` (512-1024 B par `CLAUDE.md`). **30 frames en RAM pure sur l'OLED n'est pas soutenable dans l'architecture actuelle.**

### 4.3 Budget TFT — le stockage n'est pas le facteur limitant, le firmware l'est

`esp_tft1.8.ino` ne bufferise **jamais** une frame complète : `doFetchFrame()` lit le flux HTTP par ligne de `TFT_ROW_BYTES = 256` octets (un `rowBuf[256]` sur la pile) et écrit directement au ST7735 via `tft.writePixels()`, ligne par ligne, avec `yield()` à chaque itération pour nourrir le watchdog. 1,17 Mo pour 30 frames tiendrait trivialement sur la carte SD déjà câblée (fonctions `saveFrameToSD()`/`loadFrameFromSD()` existent déjà dans le code, mais sont actuellement **du code mort** pour ce même motif : *"non restauré au boot (malloc impossible)"*).

Le vrai obstacle n'est donc pas la taille, mais deux inconnues non mesurées :
1. **Partage de bus SPI** : le TFT est en SPI **logiciel** (bit-bang GPIO) précisément pour coexister avec la SD en SPI matériel sur les mêmes broches (MOSI=D7/GPIO13, SCK=D5/GPIO14). Chaque bascule `spiForSD()`/`spiForTFT()` reconfigure le périphérique SPI et les pins (`SPI.begin()`/`SPI.end()` + `delayMicroseconds(10)`). Lire une frame depuis la SD pour l'écrire à l'écran demanderait d'alterner ces bascules — au pire ligne par ligne (160 bascules/frame × 30 frames = 4800 bascules pour une boucle complète), ce qui n'a jamais été mesuré ni implémenté.
2. **Vitesse réelle du SPI logiciel** : aucune mesure de débit de `tft.writePixels()` en bit-bang n'existe dans le dépôt. Le SPI logiciel (digitalWrite) est structurellement bien plus lent que le SPI matériel (souvent un ou deux ordres de grandeur) — un chiffre de FPS ne peut pas être avancé sans benchmark sur le matériel réel.

---

## 5. Limite recommandée par profil

| Profil | Limite recommandée **maintenant** (architecture inchangée) | Limite atteignable **après changement firmware** (hors périmètre de cette session) |
|---|---|---|
| OLED | **10 frames** (10 KB, marge confortable même avec BearSSL récurrent) | Jusqu'à 30+ si le stockage passe en LittleFS (natif ESP8266 Arduino, pas de matériel supplémentaire) et que la lecture repasse en "une frame en RAM à la fois", comme le fait déjà le firmware pour une frame statique |
| TFT | **10 frames en démarrage prudent**, à valider par mesure | Potentiellement 30 si la lecture SD par blocs de plusieurs lignes (pas ligne à ligne) tient le budget watchdog/latence — nécessite un prototype et une mesure réelle du SPI logiciel avant toute promesse de chiffre |

**Aucun des deux profils ne confirme 30 frames avec l'architecture et le firmware actuels.**

---

## 6. Encodage recommandé

- **Aperçu web (galerie ANA/PoD)** : GIF animé ou WebP — lisible nativement par tout navigateur, aucune contrainte matérielle. C'est déjà le rôle que `screenEncode.ts` ne joue pas (il produit directement le format binaire écran, pas un aperçu) — un aperçu web serait un artefact **séparé**, généré une fois à la capture, jamais transmis à l'ESP.
- **Paquet appareil** : **binaire brut par frame, dans le format déjà utilisé aujourd'hui** (1bpp page-major pour l'OLED, RGB565 little-endian pour le TFT) — **pas un GIF/WebP décodé sur l'ESP8266**. Un décodeur GIF (LZW) ou WebP nécessite une table de couleurs et un buffer de travail que le budget heap ESP8266 ne peut déjà pas se permettre pour une seule frame RGB565 (40 960 B) — ajouter un décodeur général par-dessus serait strictement pire que le problème qu'on essaie de résoudre. **Ne pas présumer qu'un GIF web est lisible par le firmware — confirmé : il ne l'est pas et ne devrait pas chercher à l'être.**
- **Compression du paquet binaire lui-même** (au-delà du format déjà 1bpp/RGB565) : aucune compression n'existe aujourd'hui côté firmware (ni RLE, ni delta, ni DEFLATE). Une RLE simple sur le contenu actuel (encre noire sur fond blanc, `encodeTft18()`/`encodeOled096()` ne produisent que 2 couleurs même en RGB565) pourrait apporter un gain significatif pour ce type de contenu précis (memorial, dessin spontané) mais un gain bien moindre pour une pièce générative multicolore ou un dégradé — **ce ratio doit être mesuré sur de vraies captures avant d'être promis dans le manifeste**, pas supposé.

---

## 7. Cadence recommandée

Deux bornes distinctes, à ne pas confondre :
- **Le cycle réseau** (`PULL_INTERVAL`/`VALIDATE_INTERVAL`, 30-60s) régit la fraîcheur du contenu, pas la cadence de lecture locale d'une animation déjà téléchargée — une fois le paquet reçu, la boucle locale peut tourner à son propre rythme, indépendamment du polling serveur.
- **Le débit d'affichage local** est la vraie borne de FPS :
  - OLED : I2C à 100 kHz (`Wire.setClock(100000)`, valeur codée en dur). Un transfert de 1024 octets (8192 bits + overhead ACK/adressage, ~10 bits effectifs par octet en I2C) ≈ 100+ ms au minimum pour l'écriture seule, avant tout traitement — un plafond théorique de l'ordre de 5-9 FPS pour des mises à jour plein écran, marge de watchdog non comprise. **Non mesuré sur matériel réel** : à confirmer par un chronométrage `millis()` autour de `oled.display()`.
  - TFT : SPI logiciel non chiffré dans le dépôt — **inconnue non mesurée**, voir §4.3.

**Recommandation** : ne pas fixer de FPS cible dans le manifeste tant que ces deux mesures n'existent pas. Le champ `fps` du manifeste candidat (`5` dans l'exemple fourni) est une hypothèse de travail raisonnable pour l'OLED d'après le calcul ci-dessus, mais reste à valider par chronométrage réel — pas à valider par calcul seul.

---

## 8. Architecture du renderer génératif (à construire — n'existe pas aujourd'hui)

Rien dans les deux dépôts n'implémente de capture headless. `package.json` de PoD comme d'ANA ne contient ni `puppeteer`, ni `playwright`, ni `@sparticuz/chromium`. C'est une brique entièrement nouvelle.

**Ce qui existe déjà et sur quoi s'appuyer** (`src/lib/generativeArtwork.ts`) :
- Une liste `FORBIDDEN_PATTERNS` qui bloque déjà, **à la validation d'auteurship**, `fetch()`, `XMLHttpRequest`, `import()` dynamique, `eval()`, `new Function()`, `document.write`, `window.parent`/`window.top`, `window.ethereum`, `<iframe>` et les attributs `onX=`. C'est une première ligne de défense statique (regex sur le code source), pas une garantie d'exécution — mais elle réduit déjà beaucoup la surface qu'un renderer doit re-vérifier à l'exécution.
- Une seule dépendance CDN externe possible et épinglée par SRI (`p5.js` ou `three.js` depuis `cdnjs.cloudflare.com`, hash `sha384` fixe) — aucune autre ressource réseau n'est autorisée par construction dans une pièce validée.
- `MAX_HTML_BYTES = 20 000` — les pièces sont petites (≤ ~20 Ko).
- Un CSP déjà calculé par hash (`buildGenerativeCsp()`) pour l'affichage en `<iframe>` côté galerie web — un précédent direct pour le sandboxing du renderer de capture.

**Ce qui manque et qu'il faudrait construire (hors périmètre d'implémentation ici)** :
1. **Déterminisme** : aucune graine n'est actuellement imposée. Les pièces peuvent utiliser `Math.random()` librement (aucun pattern interdit ne le bloque). Pour une boucle capturée **reproductible**, le renderer doit shimmer `Math.random`/`performance.now`/`Date.now` par un PRNG et une horloge fixes **avant** d'exécuter le script de la pièce — c'est une capacité du renderer, pas une modification de l'œuvre ni du contrat de validation existant.
2. **Isolation réseau réelle à l'exécution** : les `FORBIDDEN_PATTERNS` sont une vérification statique à l'auteurship, pas un blocage runtime. Le renderer doit lui-même couper tout accès réseau à l'exécution (ex. interception de requêtes headless, tout refuser sauf — au choix — pré-télécharger et inliner le script CDN pinné avant capture, pour arriver à zéro requête réseau pendant le rendu).
3. **Environnement de capture** : viewport fixe = dimensions cible de l'écran (128×64 ou 128×160), `devicePixelRatio` fixé à 1, popups/téléchargements/navigation désactivés, durée max de capture (ex. 10s), limite CPU/mémoire du process de rendu, hash du HTML source ET hash de chaque frame produite (pour le `payloadHash` du manifeste et pour la traçabilité).
4. **Hébergement du renderer** : Vercel serverless avec `@sparticuz/chromium` est un patron répandu et compatible avec la taille de déploiement Vercel, mais le cold-start (chromium ~50 Mo+) et le temps d'exécution doivent être mesurés — ANA utilise déjà `maxDuration: 60` sur plusieurs routes (`vercel.json`, ex. `keeper/orchestrator`), ce qui suggère un plan permettant au moins 60s, **à confirmer directement dans le dashboard Vercel avant de dimensionner le pipeline** plutôt que de le supposer. Si le budget de temps s'avère trop court pour capture + encodage de N frames, l'alternative est un petit worker persistant séparé (hors Vercel serverless) — décision à prendre après un premier prototype chronométré, pas ici.
5. **Politique d'échec** : si la capture dépasse le budget de temps/mémoire, ou si le hash de sortie diffère entre deux tentatives avec la même graine (preuve de non-déterminisme malgré le shim), le travail doit échouer explicitement plutôt que publier une frame partielle ou incohérente — dans l'esprit du critère de GO du brief ("la boucle fonctionne localement").

---

## 9. Architecture du renderer de poèmes — plus simple que prévu

**Constat clé** : un poème n'a pas besoin de 30 frames d'animation fluide. `ANAEditions.artworkContent` pour un poème est du **texte UTF-8 brut** (pas de HTML, pas de mise en page) — la seule vraie décision de rendu est la **pagination** (découpage en strophes/pages successives), pas une boucle animée au sens du renderer génératif. Une "animation" poème réaliste, c'est un nombre **restreint** de pages statiques (quelques strophes → typiquement 3 à 10 pages) avancées lentement (quelques secondes chacune), pas un flux à 5+ FPS.

Ceci change la nature du problème : au lieu de faire porter au poème le même appareil "30 frames à 5 FPS" que le générateur visuel, il rentre presque tel quel dans le pipeline pixel-art **déjà existant** (`screenEncode.ts`) — chaque page devient une frame statique rasterisée, avec un nombre de frames largement sous n'importe quel palier testé (§4).

**Deux briques restent à construire (hors implémentation ici) :**
1. **Layout côté serveur** : police (les deux écrans ont un budget vertical minuscule — 64px pour l'OLED, 160px pour le TFT — donc une police à chasse fixe, lisible à petite taille, est le choix naturel), marges, contraste, césure, pagination par nombre de caractères max/page, comportement si le poème dépasse un nombre de pages raisonnable (troncature explicite avec indicateur, jamais un débordement silencieux).
2. **Rasterisation** : deux voies possibles à évaluer, aucune tranchée ici :
   - Réutiliser les tables de polices bitmap **déjà présentes dans le firmware e-ink** (`font8.cpp` → `font24.cpp`, utilisées par `epdpaint.cpp`) et le rendu texte déjà câblé sur l'OLED (`oled.print()`/`setTextSize()`, déjà utilisé pour le ticker) — rendu **on-device**, le serveur n'envoie que le texte + la pagination, pas des pixels.
   - Ou rasterisation **côté serveur** en bitmap (comme un dessin), réutilisant tel quel `encodeOled096`/`encodeTft18` — plus cohérent avec le pipeline pixel-art existant, mais demande une bibliothèque de rendu de texte côté serveur (aucune n'est présente aujourd'hui — ni Satori/`@vercel/og`, ni `node-canvas` — ce serait une dépendance neuve, plus légère qu'un navigateur headless).

   La deuxième voie est probablement préférable pour la cohérence du pipeline (un poème redevient "juste" une série de frames comme un dessin), mais nécessite de choisir et licencier une police (le brief demande explicitement de vérifier la licence — aucune police n'est embarquée côté serveur aujourd'hui, seulement dans le firmware e-ink en C++).
3. **Défilement/fondu** : hors de portée réaliste sur l'OLED (I2C 100 kHz, §7) et sur le TFT sans mesure de vitesse SPI — recommandé : transition brute page→page (pas de fondu), au moins pour une V1.

---

## 10. Manifeste média proposé — évaluation du candidat fourni

Le candidat fourni est structurellement sain. Remarques concrètes, sans le figer :

- **`frameCount` en champ de manifeste (pas une constante firmware)** : c'est le bon choix — le brief demande explicitement que la limite ne soit "pas codée comme constante", et le candidat le respecte déjà en en faisant une propriété par-animation. À conserver.
- **`encoding: "to-be-validated"`** : cohérent avec l'état réel — aucun format de compression n'est choisi ni mesuré (§6). Ne pas trancher avant mesure sur de vraies frames.
- **`payloadHash`** : recommandé en `sha256` pour rester cohérent avec `lib/crypto.ts` (PoD) et `sha256Hex` (`lib/anaChain.ts`, ANA) déjà utilisés partout ailleurs dans les deux dépôts — pas de nouvel algorithme à introduire.
- **`sourceHash`** : à faire correspondre au hash du contenu source ANA (HTML de la pièce générative, ou texte du poème) — permet de savoir si le contenu source a changé sans avoir à re-diffuser le paquet pour le vérifier.
- **Champ manquant recommandé** : un `screenProfileVersion` ou équivalent — si `screenProfiles.ts` évolue (nouvelle résolution, nouveau format), un paquet déjà en attente de livraison doit pouvoir être invalidé plutôt que livré avec un profil obsolète.
- **`loop: true`** : à documenter explicitement — boucle infinie locale jusqu'à remplacement par un nouveau paquet, ou nombre de répétitions borné avant re-fetch d'un état "actuel" (galerie, chaîne) ? Le choix a un impact direct sur la fraîcheur perçue vs. la charge réseau — à trancher en produit, pas en ingénierie pure.

---

## 11. Architecture de queue / livraison / ACK (à construire)

**Ce qui existe et peut être étendu plutôt que remplacé** : `lib/queue.ts`/`lib/broadcast.ts` ont déjà le bon patron (une clé Redis par `(device, screen)`, TTL au lieu de nettoyage actif, pas de nouvelle base de données — respecte l'invariant `AGENTS.md` "ne pas ajouter de base de données"). Étendre plutôt que remplacer :

- **États explicites** (`pending`/`claimed`/`delivered`/`failed`) : aujourd'hui il n'y a que "existe" ou "n'existe pas" (TTL expiré = disparu, sans distinction succès/échec). Un paquet multi-frame, plus coûteux à (re)générer et (re)transmettre qu'une frame unique, justifie ce détail que la frame simple ne justifiait pas.
- **Lease** : le pattern `SET NX EX` déjà utilisé par `maybeCheckAnaFeed()` (verrou de debounce) est directement réutilisable comme lease de livraison — pas besoin d'un nouveau mécanisme.
- **Retry / dead-letter** : absent aujourd'hui (une frame expirée est juste perdue, cf. le bug ACK du 23/09 déjà documenté, §2.2). Pour un paquet plus gros et plus coûteux, un compteur de tentatives + une DLQ (même minimaliste : une liste Redis `queue:ana:dlq`) évite qu'un échec silencieux ne se reproduise à plus grande échelle.
- **Idempotence** : déjà partiellement acquise via `chain:ana:ingested` (dédup par `item.id`), mais ce Set marque "vu" avant confirmation de livraison (risque #1, §2.3) — à séparer clairement pour le multi-frame : "vu/traité" (génération du paquet) doit être distinct de "livré" (confirmé par ACK).
- **Priorité / taille** : aucune borne de taille de paquet n'existe aujourd'hui côté serveur (une frame simple est toujours petite). Avec des paquets de plusieurs centaines de Ko à plus d'1 Mo (TFT, §4.1), une limite de taille explicite avant mise en queue évite qu'un profil mal configuré ne sature Redis/le budget réseau.
- **Où stocker le paquet lui-même** : voir §13.

**ACK signé** — le firmware a déjà toute l'infrastructure cryptographique nécessaire (ED25519 réel, clé privée en EEPROM, déjà utilisé pour signer les votes de validation — `signED25519()` dans `esp_tft1.8.ino`). Réutiliser exactement ce mécanisme pour signer l'ACK plutôt qu'introduire un nouveau schéma : `deviceId`, `screen`/profil, `animationId`, `payloadHash` reçu, résultat (succès/échec + code d'erreur), `timestamp`, `nonce` (anti-replay), signés avec la même paire de clés déjà générée au premier boot. Ceci répond aussi structurellement au risque #3 (§2.3) — un ACK signé prouve que **l'ESP a affirmé avoir affiché avec succès**, ce qui est déjà mieux que l'ACK actuel (aucune preuve d'authenticité), mais **ne prouve toujours pas l'affichage visuel réel** (pas de caméra, pas de lecture de retour du panneau) — à documenter comme limite acceptée, pas comme résolue.

---

## 12. Menaces de sécurité

- **Renderer génératif = exécution de code non fiable par construction.** Même avec les `FORBIDDEN_PATTERNS` existants (défense à l'auteurship), un renderer headless qui exécute du JavaScript arbitraire doit être traité comme une sandbox de sécurité à part entière : isolation process/container, pas de credentials/secrets accessibles dans l'environnement d'exécution, pas de accès filesystem au-delà d'un répertoire de travail jetable, timeout dur.
- **Épuisement de ressources via un paquet volumineux** : sans limite de taille de paquet côté queue (§11), un profil TFT à haute résolution future pourrait produire des paquets qui saturent le budget Redis (`lib/redisBudget.ts` — plafond mensuel Upstash déjà documenté, 250k requêtes/mois, dégradé à 200k) ou la bande passante Vercel.
- **Rejeu d'ACK** : sans `nonce` et fenêtre de validité, un ACK signé intercepté pourrait être republié pour un faux positif de livraison — le champ `nonce` du §11/manifeste candidat est donc structurel, pas cosmétique.
- **Contenu poème non filtré par `FORBIDDEN_PATTERNS`** : ces patterns ne s'appliquent qu'aux formes `html-*` (`generativeArtwork.ts`, `isGenerativeForm()`) — un texte de poème n'est jamais passé dans un moteur JS, donc la classe de risque "évasion de sandbox" ne s'applique pas à lui, mais un texte pathologiquement long ou contenant des caractères de contrôle doit être borné avant rasterisation (déni de service de pagination, pas une évasion de sandbox).
- **Confiance dans le hash du contenu source** : `sourceHash` (§10) n'a de valeur que si le pipeline qui le calcule lit la même source que celle réellement rendue (le contenu on-chain `ANAEditions.artworkContent`, pas une copie locale potentiellement périmée) — à vérifier à l'implémentation, pas supposé ici.

---

## 13. Coûts

**Chiffres réels et vérifiables aujourd'hui :**
- Budget Redis (Upstash, free tier) : plafond mensuel **250 000 requêtes**, mode dégradé à 200k (80%), mode maintenance (503 sur `/api/pull`) à 237,5k (95%) — `lib/redisBudget.ts`. Le pont ANA actuel ne consomme ce budget qu'à la fréquence de debounce (≥60s entre vrais fetchs ANA) + les lectures/écritures per-pull déjà existantes — **le principe "pas de requête par frame" préserve directement ce budget**, quel que soit `frameCount`, tant que le paquet est transféré une fois par nouvelle œuvre et relu localement en boucle. Le nombre de requêtes Redis pour ce pipeline ne dépend donc pas (ou peu) de `frameCount` — c'est la **taille des payloads** transitant par ailleurs (stockage objet, bande passante) qui en dépend.

**Ce qui est réellement inconnu et ne doit pas être inventé :**
- Coût de calcul du renderer génératif (temps CPU/mémoire d'une capture headless × nombre d'œuvres génératives publiées/mois) — dépend entièrement du choix d'hébergement (§8.4), non tranché.
- Coût de stockage objet pour les paquets binaires (§14) — dépend du fournisseur choisi, non tranché. **Note de contexte projet** : ANA a migré *hors* de Vercel Blob vers Neon Postgres en juin 2026 (mémoire du projet, migration complétée le 16/06) — réintroduire un stockage objet doit être scopé strictement aux paquets binaires d'animation (un usage borné et différent de l'usage large qui avait justifié de quitter Blob), pas revenir sur cette décision passée sans le dire explicitement au moment de la décision.
- Coût de bande passante Vercel pour la distribution des paquets vers les devices — dépend du volume réel d'œuvres génératives/poèmes publiées et du nombre d'écrans opt-in, aucun des deux n'est encore défini pour ce cas d'usage.

**Test à faire avant de chiffrer quoi que ce soit** : mesurer un cycle complet (capture d'une œuvre générative réelle → encodage 10 frames OLED + 10 frames TFT → taille totale du paquet après compression réelle) une seule fois, puis extrapoler linéairement par volume mensuel visé — préférable à toute estimation a priori.

---

## 14. Fichiers qui seraient à modifier (aucun n'est touché dans cette session)

**Côté ANA (tout nouveau, rien d'existant ne serait cassé) :**
- `src/app/api/ana-art/feed/route.ts` — étendre le filtre (ou ajouter une route sœur, ex. `ana-art/feed-extended`) pour exposer `html-*` et les `artForm` poème, avec le contenu (`artworkContent` on-chain) et un discriminant de type explicite (aujourd'hui absent du feed, cf. §2.1).
- Nouveau : un service/route de renderer génératif (ex. `src/app/api/ana-art/render-loop/[workId]/route.ts` ou worker séparé) — dépendance neuve (`playwright-core`/`puppeteer-core` + `@sparticuz/chromium` si Vercel serverless).
- Nouveau : `src/lib/poemLayout.ts` (ou équivalent) pour la pagination poème.

**Côté Proof of Draw (tout nouveau, additif) :**
- `lib/screenProfiles.ts` — champs additifs (ex. plafond de frames par profil, FPS max mesuré) — non-cassant, les consommateurs actuels ignorent des champs supplémentaires.
- `lib/anaFeed.ts` — nouvelle branche d'ingestion pour contenu générative/poème, en parallèle de la branche `pixel-drawing` actuelle.
- Nouveau : `lib/animationQueue.ts` (ou extension de `lib/queue.ts`) — états pending/claimed/delivered/failed, lease, DLQ.
- Nouveau : `lib/objectStore.ts` — wrapper vers le stockage objet choisi (§13).
- `app/api/pull-frame/route.ts` ou nouvelle route `app/api/pull-animation/route.ts` — manifeste + livraison paginée/chunkée du paquet binaire.
- `app/api/ack-frame/route.ts` ou nouvelle route `app/api/ack-animation/route.ts` — ACK signé enrichi (§11).
- Firmware `esp8266/esp_eink_2.7BW_OLED/esp_eink_2.7BW_OLED.ino` — nouvelle logique de téléchargement+lecture en boucle locale ; stockage RAM (≤10 frames, §5) ou introduction de LittleFS.
- Firmware `esp8266/esp_tft1.8/esp_tft1.8.ino` — nouvelle logique de stockage SD multi-frame + lecture par blocs (pas ligne à ligne) pour amortir le coût de bascule SPI SD↔TFT.

---

## 15. Plan d'implémentation par phases (proposé, non engagé)

1. **Phase 0 — Mesures** (aucun code produit, juste instrumentation du firmware existant) : chronométrer `oled.display()` réel (FPS OLED), chronométrer `tft.writePixels()` réel sur un buffer complet (débit SPI logiciel TFT), confirmer le heap libre réel sur le firmware actuel (`logHeapState()` est déjà câblé partout — juste lire les logs Série sur matériel réel) avant toute décision de `frameCount`.
2. **Phase 1 — Poèmes en frames statiques** (§9) : le chantier le plus proche de l'existant — réutilise `screenEncode.ts` presque tel quel, juste une nouvelle source de frames (pages de texte au lieu de pixels ANA). Pas de nouvelle logique de "boucle" firmware nécessaire au-delà d'un compteur de page qui avance toutes les N secondes.
3. **Phase 2 — Multi-frame RAM sur OLED** (10 frames, §5) : premier vrai support d'animation firmware, sur le profil le moins risqué (RAM, pas de SD, bus I2C simple).
4. **Phase 3 — Renderer génératif + capture déterministe** (§8) : la brique la plus lourde à construire, à isoler et valider indépendamment du firmware (peut être testée entièrement côté serveur avant tout déploiement matériel).
5. **Phase 4 — TFT multi-frame via SD** (§4.3) : dépend des mesures de Phase 0 ; le patron de lecture par blocs (pas ligne à ligne) doit être prototypé et chronométré avant d'être considéré fiable.
6. **Phase 5 — Extension au-delà de 10-15 frames** : conditionnée aux résultats mesurés des phases précédentes, pas planifiée à l'avance.

---

## 16. Plan de tests logiciels

- Tests unitaires pour tout nouvel encodeur/pagineur (suivant le patron déjà en place : `test/generativeArtwork.test.ts` existe côté ANA pour la validation des œuvres génératives — même esprit à appliquer à un `poemLayout.test.ts` et à un éventuel `animationEncode.test.ts` côté PoD).
- Test de non-régression sur `screenEncode.ts` existant — toute extension du module doit laisser les 4 encodeurs actuels (`oled096`/`eink27bw`/`eink29bwr`/`tft18`) strictement inchangés dans leur comportement pixel-art actuel.
- Test de déterminisme du renderer génératif : exécuter la même capture deux fois avec la même graine, comparer les hashes de sortie frame par frame — doit être bit-à-bit identique, sinon la capacité "déterministe" annoncée n'est pas honorée.
- Test de charge du budget Redis : simuler N paquets/jour à la taille réelle mesurée (Phase 0) contre le plafond documenté (`lib/redisBudget.ts`) avant tout déploiement à volume.
- Test du chemin d'échec ACK : device qui ne répond jamais, device qui répond avec un ACK mal signé, device qui répond en dehors de la fenêtre de `nonce` — vérifier que la queue retente puis passe en DLQ plutôt que de boucler indéfiniment.

## 17. Plan de tests sur matériel réel

- **OLED** : flasher le firmware actuel instrumenté (`logHeapState`), lire les logs Série lors d'un cycle pull/validate/fetch complet, confirmer le heap réellement disponible avant/après une reconnexion BearSSL — comparer au calcul du §4.2 avant de valider un nombre de frames.
- **OLED — cadence** : chronométrer `oled.display()` sur 10 appels consécutifs, calculer le FPS réel, comparer à l'estimation théorique du §7 (5-9 FPS).
- **TFT — SPI logiciel** : chronométrer `tft.writePixels()` sur un buffer complet (40 960 octets) plusieurs fois, en conditions réelles (WiFi actif en tâche de fond) — c'est la mesure manquante la plus critique de toute cette étude.
- **TFT — bascule SD/TFT** : prototyper une lecture SD par blocs de 8-16 lignes suivie d'une écriture TFT, mesurer le temps total par frame, en déduire un FPS réaliste avant de promettre un chiffre dans un manifeste.
- **Test de robustesse redémarrage** : couper l'alimentation en plein milieu d'une animation multi-frame (RAM ou SD), vérifier qu'au redémarrage le device ne reste pas bloqué (watchdog, EEPROM incohérente) et qu'il retélécharge proprement plutôt que d'afficher un état corrompu.
- **Test réseau dégradé** : simuler un débit lent/coupures pendant le téléchargement du paquet complet (avant toute lecture en boucle) — vérifier que le device abandonne proprement (comme le fait déjà `doFetchFrame()` pour une frame simple : `success = false` si une ligne timeout) plutôt que d'afficher un paquet partiel.

---

## 18. Risques et inconnues

| Inconnue | Ce qui manque exactement | Comment la mesurer |
|---|---|---|
| Heap OLED réel sur le firmware actuel (pas la valeur de mai citée par `CLAUDE.md`) | Le firmware a gagné Ed25519, SD (variante TFT), et d'autres logiques depuis mai — le chiffre "~47 KB" n'est peut-être plus exact | Lire `ESP.getFreeHeap()` via les logs `logHeapState()` déjà présents, sur le firmware actuellement flashé, en conditions réelles |
| Débit SPI logiciel TFT | Aucune mesure n'existe dans le dépôt | Chronométrage direct sur matériel (§17) |
| Taux de compression réel (RLE ou autre) sur du contenu généré vs. pixel-art | Aucune capture réelle d'œuvre générative n'existe encore pour mesurer | Capturer une pièce réelle en Phase 0/3, mesurer avant de choisir `encoding` dans le manifeste |
| Plan Vercel (Hobby/Pro/Enterprise) et budget de temps réel disponible pour un renderer headless | Déduit indirectement de `maxDuration: 60` déjà utilisé ailleurs, jamais confirmé directement | Vérifier dans le dashboard de facturation Vercel avant de dimensionner le pipeline |
| Fournisseur de stockage objet à choisir | Aucun n'est actuellement intégré (ANA a explicitement quitté Vercel Blob en juin) | Décision produit + devis, hors ingénierie pure |
| Fiabilité de l'ACK comme preuve d'affichage visuel réel | Aucun mécanisme de vérification physique (caméra, lecture du framebuffer écran) n'existe ni n'est proposé ici | Rester conscient que l'ACK signé (§11) prouve l'intention/l'exécution locale, jamais le résultat optique réel |
| Discrépance de canvas ANA (528×352 en commentaire PoD vs. 360×240 réel) | Sans impact fonctionnel aujourd'hui (canvas toujours lu dynamiquement), mais signe que la doc PoD dérive du code ANA réel | Corriger le commentaire de `screenEncode.ts` la prochaine fois qu'il est touché |

---

## 19. Verdict séparé

- **OLED (`oled096`) : GO avec réduction.** 10 frames en RAM pure sont réalistes et sûrs dans l'architecture actuelle (marge confirmée par calcul, §4.2) ; 30 frames nécessitent un changement d'architecture de stockage (LittleFS) non entrepris ici.
- **TFT (`tft18`) : GO avec réduction, sous réserve de mesures.** La RAM n'est pas bloquante (le streaming ligne-par-ligne l'évite déjà, §4.3), mais deux inconnues non mesurées (débit SPI logiciel, coût de bascule SD↔TFT) empêchent de confirmer un nombre de frames ou un FPS avant un prototype chronométré sur matériel réel.

---

## 20. Réponse explicite

**30 frames ne sont pas confirmées.**

**Limite recommandée = 10 frames** pour les deux profils (OLED et TFT) comme point de départ mesuré et sûr dans l'architecture et le firmware actuels, avec un chemin d'extension explicite mais conditionnel :
- OLED → jusqu'à 30+ si le stockage passe de la RAM à LittleFS (changement firmware, pas entrepris ici).
- TFT → potentiellement jusqu'à 30 si un prototype de lecture SD par blocs, chronométré sur matériel réel, confirme un débit et un budget watchdog compatibles (changement firmware + mesure, pas entrepris ici).

---

*Fin de l'étude. Aucun fichier applicatif, firmware, contrat, workflow ou configuration n'a été modifié pendant cette session — seul ce rapport a été créé.*
