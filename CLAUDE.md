# ViaWrist

App web perso et gratuite pour exploiter le bracelet **Bionny 4.0** sur iPhone, sans l'appli officielle. Le nom de l'app est **ViaWrist** ; « Bionny » ne désigne que le bracelet. UI et commentaires en **français**, tutoiement, jamais de tiret cadratin dans les textes affichés.

Exigence centrale : **des vraies données, rien d'inventé**. Sans mesure, on affiche « – » ; chaque calcul est expliqué dans Réglages → « D'où viennent les chiffres » ; ce qui n'est pas fiable n'est pas affiché (calories).

En ligne : https://vdelbreu.github.io/Bionny-live/ (dépôt `vdelbreu/Bionny-live`, GitHub Pages sur `main`). Toujours demander avant de pousser.

## Les 4 onglets (pensés pour un non-médecin : un chiffre, une phrase qui l'explique, une action)

1. **Aujourd'hui** (`#jour`) : bandeau direct (états `absent`, `deconnecte`, `connexion`, `synchro`, `mesure`, `direct`, `demo` sur `#carteDirect[data-etat]`), puis une tuile « Ta forme » et 6 tuiles de chiffres (sommeil, au lit ce soir, pas, effort, cœur au repos, oxygène) : un chiffre et deux mots chacune. Toucher une tuile ouvre sa fiche (`<dialog id="fiche">`, feuille en bas d'écran) avec l'explication et l'action (lever du jour visé, sport déclaré). Demande de l'utilisateur : pas de texte en première vue, le détail seulement au toucher.
2. **Coach** (`#coach`) : ta semaine en 4 chiffres, une conversation (questions suggérées ou libres, intentions détectées par mots-clés dans `coach.js`, pas d'IA en ligne : rien d'inventé, rien d'envoyé). Réponse : une phrase-choc, le reste sous « Détails ».
3. **Données** (`#donnees`, lien direct `#donnees/coeur/2026-10-12`) : Sommeil, Activité, Cœur, Oxygène (+ Variabilité et Stress seulement s'ils passent `fiabilite()`). Détail du jour, tendance 7/30/90 j, calendrier.
4. **Détente** (`#detente`) : respiration guidée (`EXOS` dans live.js : cohérence cardiaque, soupir physiologique, 4-7-8, carrée ; phases [consigne, secondes, volume visé]), durée 1/3/5/10 min, pouls en direct pendant l'exercice et bilan début/fin.
5. **Réveil** (`#reveil`) : heures de lever par jour de la semaine, réveil vibreur, rappel du coucher, rappels, test du vibreur, appels et messages (désactivé de base, explication).
6. **Réglages** (`#reglages`) : prénom, âge, objectifs (sommeil, pas), bracelet, Apple Santé, sauvegarde ; le reste dans « Avancé » (FC max mesurée, contrôles de fiabilité, méthodes, démo, exemple, journal Bluetooth, effacer).

Pas d'entraînement en direct : le bracelet n'est pas porté au sport. Ses séances se déclarent (« J'ai fait du sport » : durée + tranquille/soutenu) et comptent dans les minutes d'effort (`seanceDeclaree`, soutenu = intense, compte double).

## Le bracelet : protocole Colmi (app QRing)

Le Bionny 4.0 expose `1800`, `1801`, `180A`, `FEE7`, `6e40fff0-…`, `de5bf728-…`. Pas de profil cardio standard `180D`, et l'app Bionny n'écrit pas dans Apple Santé. Les deux derniers services sont ceux des bagues **Colmi** ; protocole décodé par [colmi_r02_client](https://github.com/tahnok/colmi_r02_client) et Gadgetbridge (`devices/colmi/ColmiR0xConstants.java`, `ColmiR0xPacketHandler.java`, `service/devices/colmi/ColmiR0xDeviceSupport.java`).

| Canal | UUID |
|---|---|
| Service V1 | `6e40fff0-b5a3-f393-e0a9-e50e24dcca9e` |
| Écriture V1 | `6e400002-…`, paquets de 16 octets : cmd, 14 octets, somme & 0xff |
| Notifications V1 | `6e400003-…` |
| Service V2 | `de5bf728-d711-4e47-af26-65e3012a5dc7` |
| Écriture V2 | `de5bf72a-…`, sans cadre ni somme |
| Notifications V2 | `de5bf729-…`, `[0xbc, type, longueur LE, 2 octets, données]` en plusieurs notifications |

Commandes en lecture, plus la mesure en direct :
- `0x03` batterie → `[1]` niveau, `[2]` en charge ; aussi notification `0x73 0x0c`.
- `0x73 0x12` activité du jour en direct : pas `[2..4]`, distance `[8..10]` en big-endian 24 bits.
- `0x1e [01]` pouls en continu (Gadgetbridge, `CMD_REALTIME_HEART_RATE`) : réponse `[1e, bpm]` chaque seconde, `0x1e [03]` à renvoyer toutes les 30 s (coupe au bout de 60 s), `0x1e [02]` arrêter ; relancé après 10 s de silence. Secours si aucune réponse en 8 s : `0x69 [1,1]` mesure ponctuelle, `[1,3]` continuer, `0x6a [1,0,0]` arrêter. Réponse `[2]` erreur (1 = mal porté, 2 = pas encore), `[3]` bpm. Pas de R-R.
- `0x15 + uint32 LE` FC d'une journée, un relevé toutes les 5 min ; heure murale locale encodée comme de l'UTC (`secondesMurales`).
- `0x43 [jours avant, 0x0f, 0, 0x5f, 1]` activité par quart d'heure : date BCD, calories `[7..8]` (×10 si en-tête `0xf0` `[3] == 1`, unité non documentée : stockées, jamais affichées), pas `[9..10]`, distance m `[11..12]`.
- `0x39 [jours avant]` variabilité, `0x37 [0]` stress du jour : une valeur par demi-heure (12 puis 13 par paquet).
- V2 `bc 27 01 00 ff 00 ff` sommeil : `[6]` nb de jours, puis `[jours avant, taille, début LE, fin LE, (stade, minutes)…]`, stades 2 léger, 3 profond, 4 paradoxal, 5 éveil. La nuit est bornée par ce début et cette fin (stade qui déborde coupé, jour aux heures impossibles ignoré) ; une réponse incomplète (`!collecte.fini`) n'est pas lue.
- V2 `bc 2a 01 00 ff 00 ff` oxygène : blocs de 49 octets `[jours avant, (min, max) × 24 h]`.

**Incident du 21-23/10** : après la mise en ligne du pouls en continu (0x1e), le bracelet a cessé ses mesures automatiques (une seule mesure de pouls par jour, plus de pas, plus d'oxygène, aucune nuit enregistrée les 21-22 et 22-23). Cause la plus probable : le mode continu laissé allumé quand l'app passait en arrière-plan. Depuis : le continu s'arrête dès qu'on quitte l'app (`visibilitychange`) et `verifierMesuresAuto()` lit à chaque connexion les réglages pouls `0x16` (`[16 01]` → `[16 01 actif minutes]`, écriture `[16 02 01 05]`), oxygène `0x2c`, stress `0x36`, variabilité `0x38` (`[cmd 02 01]`), rallume ceux qui sont coupés et relit ; état dans Réglages → Bracelet.

Écritures (à la demande de l'utilisateur, formats du code Gadgetbridge `service/devices/yawell/ring/YawellRingDeviceSupport.java` et `devices/yawell/ring/YawellRingPacketHandler.java`, appareils Yawell/QRing du même protocole ; le bracelet H59 a 10 réveils nommés) :
- `0x01 [aa mm jj hh mi ss]` en BCD, heure locale : mise à l'heure à chaque connexion (`mettreALHeure`), changement d'heure compris.
- `0x50 [0x55, 0xaa]` « trouver l'appareil » : le bracelet vibre (bouton Tester le vibreur).
- Grande trame `bc type longueur(LE) crc16-Modbus(LE) charge` (`paquetGros`, la demande de sommeil suit le même schéma) ; réveils type `0x2c` : lecture `[01]` → `[01, n, (taille, drapeaux, minutes LE, nom UTF-8 ≤ 28 o)…]`, drapeaux bit 7 = actif, bits 0-6 = jours (0 = dimanche) ; écriture `[02, n, …]` remplace toute la liste, accusé `[02]`. Trame longue : d'un bloc si écriture avec réponse, sinon morceaux de 20 octets.
- Réveils qui ne vibrent pas (dit par l'utilisateur le 14/11 ; seul « trouver l'appareil » `0x50` vibre). Format vérifié identique à Gadgetbridge (`YawellRingPacketHandler.encodeAlarmsPayload`, `H59Coordinator` : 10 réveils, nom ≤ 28 o, bit 0 = dimanche, bit 7 = actif, trame `bc 2c` sur `de5bf72a`). Gadgetbridge envoie aussi à la connexion les préférences `0x0a` (format 24 h, unités, profil) : pas fait ici. Le réveil vibreur est désactivé de base (il l'était dans la sauvegarde du 03/11). Bouton « Essayer un réveil dans 3 min » (Réveil, `essayerReveil`, alarme « Essai » retirée 10 min après) ; le journal note l'essai et le détail des réveils relus.
- `js/reveil.js` décide la liste : réveil vibreur à chaque heure de `leverJours` (une alarme par heure, ses jours), rappel du coucher 30 min avant l'heure conseillée (jour du soir visé), rappels de l'utilisateur ; 10 au plus. Première lecture : les réveils déjà présents (app Bionny) deviennent des rappels. Écrit seulement si la liste diffère, puis relu pour vérifier. Pas de réglage de durée ni de force de vibration dans ce protocole, et pas de notifications d'appel ou de message : sur iPhone c'est iOS qui les envoie (ANCS) une fois le bracelet associé, ce qui le bloque pour ViaWrist ; désactivé de base, la carte explique.

`synchroniser(jours)` produit le même objet que `parseImport` (+ `activite`, `stress`) : tout passe par `fusionner`, puis `nuits` et `journees`. Synchro du bracelet (`parJour`) : le sommeil est remplacé nuit par nuit (chaque période renvoyée, à 2 h près), une nuit que le bracelet ne renvoie plus reste.

## Calculs (tous dans du code pur testé)

- `coach.js` : `planSommeil` (besoin = objectif + ¼ de la dette nette des 7 nuits, 1 h max, cf. NSF 7 à 9 h à 18-25 ans ; lever = `R.leverJours[jour du matin visé]` (cours variables, réglé par jour de la semaine, la carte Sommeil modifie le jour visé), sinon médiane des réveils ; coucher = lever − besoin − éveils médians dans la nuit − 15 min, jamais calé sur l'habitude ; `avance` ≥ 60 min sur l'endormissement habituel → conseil écrans/lumière ; `tard` + `possible` quand l'heure est passée ; pas de cycles de 90 min, sans base solide), `effort` (OMS/ACSM : relevés ≥ 64 % FC max = modéré, ≥ 77 % = intense ×2, séances déclarées en plus), `conseilJour`, `semaine` (dont décalage du week-end), phrases d'explication selon le cas, `repondre`/`detecter` pour le Coach.
- `sante.js` : `parseImport`, `fusionner`, `nuits` (vérifiées au pouls, voir Sommeil plus bas)/`analyseNuit` (efficacité seulement avec segments « au lit »), `fcRepos`, `resume`, `recuperation` (nuit vs objectif, FC de repos vs 14 nuits, VFC seulement si fiable).
- `stats.js` : `journees`, `repere` (normale = moyenne ± 1 écart-type sur 30 j, bornée aux valeurs observées), `comparerSemaines`, `records`, `pointsAttention`, `fiabilite` (VFC/stress physiologiques ou non).
- `coeur.js` : zones en mots simples (Repos, Léger, Modéré, Soutenu, Intense, Maximal), `fcMaxTanaka`, `trimp`, `parseHR`.
- Mesures qui s'accumulent dans la journée (pas, stress) : la journée en cours est exclue des normales, moyennes et couleurs.

## Structure (statique, sans build)

- `index.html` (CSP stricte, tout en `'self'`), `style.css` (tokens clair/sombre ; section « Version simplifiée » en fin de fichier)
- `js/app.js` : stockage (`nettoyer`), réglages (dont `reveil`), navigation, imports, sport déclaré, sauvegarde
- `js/coach.js` (pur), `js/vues/coach.js` (conversation), `js/vues/jour.js`, `js/vues/donnees.js`, `js/ui.js`
- `js/live.js` : direct, synchro, démo, cohérence ; `js/connexion.js` (Web Bluetooth, journal) ; `js/bracelet.js` (protocole, pur)
- Sommeil, constaté sur la sauvegarde du 03/11 : le bracelet renvoie d'anciennes nuits sous un autre « jours avant » (11/10 revenue les 16 et 18/10, 12-14/10 revenues les 22-24/10, 19/10 le 20/10 : mêmes phases à la minute près, même heure). `sansCopies` (sessions = phases contiguës ; copie = même heure, autre jour, phases égales ou début de celles d'une session plus ancienne d'au moins 4 phases) les écarte à la lecture (`grappesSommeil`) et à la fusion (une copie ne remplace jamais une nuit enregistrée). En-têtes reçus notés dans le journal (`entetesSommeil`). Depuis le 27/10, plus aucune mesure la nuit (ni pouls, ni pas, ni sommeil) et aucune le 03/11 : `nuitMuette` (pouls la veille et après 6 h, < 15 relevés entre 1 h et 6 h) et `silenceBracelet` (synchro > 3 h après le dernier relevé) le disent (tuile et fiche Sommeil, Données, Réglages → Contrôles) au lieu de deviner. Cause : bracelet peu porté la nuit fin octobre, parce que les durées affichées étaient fausses (dit par l'utilisateur le 03/11).
- Sommeil : la règle de l'utilisateur (14/11), seuil `R.seuilEveil` (65 bpm par défaut, Réglages → Objectifs) : au-dessus éveillé, en dessous endormi. `etatsAuSeuil` : éveillé si 2 relevés de suite au-dessus (10 min) ou 3 pics sur 5 relevés (plusieurs pics le matin) ; pic isolé = rêve ; creux isolé dans l'éveil = éveillé. `nuitAuSeuil` (de 18 h à 14 h) : blocs de sommeil ≥ 20 min ; la nuit part du plus long bloc entre minuit et 7 h ; avant lui, blocs à ≤ 30 min (sinon calme du soir) ; après lui, réveil dans la nuit si rendormi en ≤ 30 min, ou ≤ 1 h pour ≥ 1 h ; 250 pas dans l'heure = levé ; bouts de calme < 30 min au matin ne prolongent pas ; horaires de l'utilisateur (endormi 23 h-2 h, levé 7 h-10 h) à 1 h près : rien qui finit avant 22 h ou commence après 11 h n'entre dans la nuit (`SOIR_TOT`, `MATIN_TARD`) ; ≥ 3 h de sommeil et 30 min de relevés après le réveil. Sans ces garde-fous, la règle seule faisait commencer des nuits à 18 h 45 (calme du soir) et finir à midi (assis au calme le matin). `nuits(d, { seuil })` : heures de la règle, phases du bracelet gardées entre ces heures si sa nuit est la même (moitié en commun), réveils comptés éveillés ; sans nuit à la règle, heures du bracelet sauf si `controleAuPouls` les contredit (pouls de sommeil = 10e centile des 7 jours ; confirmée si ≥ 60 % ≤ + 10 ou ≥ 5 bpm sous l'éveil autour). Champs : `source` ('bracelet' = phases du bracelet, 'pouls' = pouls seul), `debutSource`/`finSource` ('pouls' si ≠ bracelet de plus de 5 min, 'toi'), `controle`, `debutBracelet`, `finBracelet`, `finAuto`/`finAutoSource` ; `origineNuit` (ui.js) l'écrit sous chaque nuit. Siestes probables : la même règle en journée, ≥ 30 min, ≤ 150 pas/h. Sur les nuits d'octobre : à 15 min près du bracelet une fois sur deux. `reveilAuPouls` et la vérification au 10e centile (bornes, prolongement, nuit au pouls) ont été retirés. Deux périodes du bracelet qui finissent le même jour ne fusionnent que si < 4 h les séparent ; ≥ 3 h l'après-midi (milieu entre 12 h et 19 h) = pas une nuit ; `siestesFaites(d, ns)` ne compte pas une sieste qui chevauche une nuit. L'heure de réveil corrigée à la main (`D.reveils[cle]`, fiche Sommeil) passe avant tout ; `finProvisoire` (nuit arrêtée à une synchro, `D.synchros`).
- Siestes : le bracelet n'en enregistre pas (une période de sommeil par jour). `siestesFaites` = déclarées ou confirmées (`D.siestes`) + périodes courtes du bracelet ; `siestesProbables` = ≥ 30 min sous le seuil d'éveil en journée avec ≤ 150 pas/h (heure absente = 0), à confirmer (Oui → `D.siestes`, Non → `D.nonSiestes`), jamais comptées seules. Les siestes des 7 derniers jours réduisent la dette de `planSommeil`. Une sieste déclarée remplace celles qu'elle chevauche.
- Apple Santé : un site ne peut pas écrire dans Santé. « Envoyer mon pouls vers Santé » (Réglages, fiche Cœur) copie les mesures de pouls pas encore envoyées (`R.santeJusqua`, 24 h au plus, une par quart d'heure + la dernière), une ligne `jj/mm/aaaa hh:mm;bpm` chacune, puis ouvre `shortcuts://run-shortcut?name=ViaWrist Santé`. Le raccourci (créé à la main, étapes dans Réglages) lit le presse-papiers et enregistre chaque ligne ; « Mon pouls » lit le dernier échantillon pour un widget. Non testé sur iPhone (presse-papiers et ouverture de Raccourcis depuis Bluefy).
- Connexion : une recherche (`requestDevice`) ne voit pas un bracelet que l'iPhone tient déjà (il n'émet plus). Ordre : bracelet déjà connecté dans la page (`S.appareilOk`, connexion directe) ; à l'ouverture, une tentative discrète sur `getDevices` (+ `watchAdvertisements`), mise en pause une semaine après 2 échecs sans réussite (`localStorage viawrist-reconnexion`) car Bluefy retrouve l'appareil sans savoir s'y reconnecter ; sinon la liste. Sur écran tactile, la liste montre tous les appareils : le filtre de Bluefy cache le bracelet. La connexion reste ouverte tant que l'app l'est (le direct continue au retour, écran gardé allumé si le navigateur le permet) ; seule la fermeture de la page (`pagehide`) libère le bracelet. Si l'app Bionny est associée, iOS reprend le bracelet en permanence : il faut couper son Bluetooth (Réglages → Apps → Bionny) et « Oublier » le bracelet. Étapes notées dans le journal (`info`).
- `js/graphes.js`, `js/exemple.js`, `sw.js`

Stockage : `localStorage` `bionny-reglages` et `bionny-sante` (noms gardés pour ne pas perdre les données), toujours en `try/catch`. Bluefy, Safari et Chrome ont chacun leur stockage : sauvegarde/restauration JSON pour passer de l'un à l'autre.

## Tester

- `npm test` : 87 tests (sante, coeur, bracelet, stats, coach, et `connexion.test.js` avec un faux bracelet)
- `npm run test:navigateur` (site servi sur le port 8765) : scénarios dans un Chrome sans fenêtre, profil jetable (`test/navigateur/` : parcours, connexion avec faux Web Bluetooth, ouverture, Santé, sommeil, réveils, mesures automatiques ; `captures` fait seulement des images). `CAPTURES=dossier` pour des images.
- `python -m http.server 8765`, puis `outils/apercu.html#donnees/coeur` (données d'exemple, refuse d'écraser de vraies données) ou `outils/mobile.html#bilan` (cadre 390 px pour les captures headless)
- Debug BLE : `chrome://bluetooth-internals` sur PC (couper le Bluetooth de l'iPhone pour libérer le bracelet)

## Constaté sur le vrai bracelet

- Format Colmi confirmé : nuits avec phases, FC toutes les 5 min, pas et distance **par heure** (index de quart d'heure multiple de 4), oxygène par heure (quelques jours), variabilité par heure, stress par demi-heure (jour en cours).
- **Variabilité et stress du bracelet ne sont pas physiologiques** : pas plus hauts (ou plus bas) pendant le sommeil, sans lien avec la FC, valeurs bornées. `fiabilite()` (stats.js) les écarte ; détail dans Réglages → Avancé. Ils réapparaissent seuls s'ils passent le test.
- Le bracelet commence la nuit à l'endormissement (pas de segment « au lit ») : l'efficacité n'est pas mesurable, donc masquée.
- Calories brutes ≈ 33 par pas (avec le ×10 de l'en-tête) : probablement des calories au sens strict (kcal = brut ÷ 1000). **À confirmer avec l'app Bionny avant de les afficher.**
- Batterie lue correctement.

Aucune donnée personnelle (valeurs mesurées, prénom, identifiants) dans ce dépôt public : les sauvegardes et captures restent sur le PC.

## À vérifier

- [ ] Règle des 65 bpm : comparer les heures affichées avec le ressenti sur quelques nuits portées ; ajuster le seuil dans Réglages si besoin.
- [ ] Réveil d'essai : le bracelet vibre-t-il ? Sinon, journal (réveils relus, accusé `bc 2c … 02`) ; piste suivante : envoyer les préférences `0x0a` comme Gadgetbridge.
- [ ] Copies de nuits : vérifier dans le journal les « J-n » reçus après une nuit sans bracelet.

- [ ] Pouls en direct `0x69` : prolongation toutes les 15 s, relance seulement après 45 s sans aucun paquet ; vérifier avec le journal Bluetooth (Réglages → Avancé).
- [ ] Comparer une nuit et un total de pas avec l'app Bionny (les pas de l'app Santé viennent de l'iPhone, pas du bracelet).
- [ ] iPhone : Bluefy ne voit pas le bracelet tant qu'iOS le garde connecté (« Bionny 4.0 » dans le Centre de contrôle).
