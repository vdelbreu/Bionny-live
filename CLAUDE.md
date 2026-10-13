# ViaWrist

App web perso et gratuite pour exploiter le bracelet **Bionny 4.0** sur iPhone, sans l'appli officielle. Le nom de l'app est **ViaWrist** ; « Bionny » ne désigne que le bracelet. UI et commentaires en **français**, tutoiement, jamais de tiret cadratin dans les textes affichés.

Exigence centrale : **des vraies données, rien d'inventé**. Sans mesure, on affiche « – » ; chaque calcul est expliqué dans Réglages → « D'où viennent les chiffres » ; ce qui n'est pas fiable n'est pas affiché (calories).

En ligne : https://vdelbreu.github.io/Bionny-live/ (dépôt `vdelbreu/Bionny-live`, GitHub Pages sur `main`). Toujours demander avant de pousser.

## Les 4 onglets (pensés pour un non-médecin : un chiffre, une phrase qui l'explique, une action)

1. **Aujourd'hui** (`#jour`) : bandeau direct (états `absent`, `deconnecte`, `connexion`, `synchro`, `mesure`, `direct`, `demo` sur `#carteDirect[data-etat]`), puis une tuile « Ta forme » et 6 tuiles de chiffres (sommeil, au lit ce soir, pas, effort, cœur au repos, oxygène) : un chiffre et deux mots chacune. Toucher une tuile ouvre sa fiche (`<dialog id="fiche">`, feuille en bas d'écran) avec l'explication et l'action (lever du jour visé, sport déclaré). Demande de l'utilisateur : pas de texte en première vue, le détail seulement au toucher.
2. **Coach** (`#coach`) : ta semaine en 4 chiffres, une conversation (questions suggérées ou libres, intentions détectées par mots-clés dans `coach.js`, pas d'IA en ligne : rien d'inventé, rien d'envoyé), et la respiration guidée 5 min.
3. **Données** (`#donnees`, lien direct `#donnees/coeur/2026-10-12`) : Sommeil, Activité, Cœur, Oxygène (+ Variabilité et Stress seulement s'ils passent `fiabilite()`). Détail du jour, tendance 7/30/90 j, calendrier.
4. **Réglages** (`#reglages`) : prénom, âge, objectifs (sommeil, heure de lever par jour de la semaine, pas), bracelet, sauvegarde ; le reste dans « Avancé » (FC max mesurée, contrôles de fiabilité, méthodes, démo, exemple, journal Bluetooth, effacer).

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

Commandes (lecture seule plus mesure en direct ; jamais d'écriture de l'heure ni des réglages) :
- `0x03` batterie → `[1]` niveau, `[2]` en charge ; aussi notification `0x73 0x0c`.
- `0x73 0x12` activité du jour en direct : pas `[2..4]`, distance `[8..10]` en big-endian 24 bits.
- `0x69 [1,1]` FC en direct, `[1,3]` continuer (toutes les 10 s), `0x6a [1,0,0]` arrêter. Réponse `[2]` erreur (1 = mal porté, 2 = pas encore), `[3]` bpm. Pas de R-R.
- `0x15 + uint32 LE` FC d'une journée, un relevé toutes les 5 min ; heure murale locale encodée comme de l'UTC (`secondesMurales`).
- `0x43 [jours avant, 0x0f, 0, 0x5f, 1]` activité par quart d'heure : date BCD, calories `[7..8]` (×10 si en-tête `0xf0` `[3] == 1`, unité non documentée : stockées, jamais affichées), pas `[9..10]`, distance m `[11..12]`.
- `0x39 [jours avant]` variabilité, `0x37 [0]` stress du jour : une valeur par demi-heure (12 puis 13 par paquet).
- V2 `bc 27 01 00 ff 00 ff` sommeil : `[6]` nb de jours, puis `[jours avant, taille, début LE, fin LE, (stade, minutes)…]`, stades 2 léger, 3 profond, 4 paradoxal, 5 éveil.
- V2 `bc 2a 01 00 ff 00 ff` oxygène : blocs de 49 octets `[jours avant, (min, max) × 24 h]`.

`synchroniser(jours)` produit le même objet que `parseImport` (+ `activite`, `stress`) : tout passe par `fusionner`, puis `nuits` et `journees`.

## Calculs (tous dans du code pur testé)

- `coach.js` : `planSommeil` (besoin = objectif + ¼ de la dette nette des 7 nuits, 1 h max, cf. NSF 7 à 9 h à 18-25 ans ; lever = `R.leverJours[jour du matin visé]` (cours variables, réglé par jour de la semaine, la carte Sommeil modifie le jour visé), sinon médiane des réveils ; coucher = lever − besoin − éveils médians dans la nuit − 15 min, jamais calé sur l'habitude ; `avance` ≥ 60 min sur l'endormissement habituel → conseil écrans/lumière ; `tard` + `possible` quand l'heure est passée ; pas de cycles de 90 min, sans base solide), `effort` (OMS/ACSM : relevés ≥ 64 % FC max = modéré, ≥ 77 % = intense ×2, séances déclarées en plus), `conseilJour`, `semaine` (dont décalage du week-end), phrases d'explication selon le cas, `repondre`/`detecter` pour le Coach.
- `sante.js` : `parseImport`, `fusionner`, `nuits`/`analyseNuit` (efficacité seulement avec segments « au lit »), `fcRepos`, `resume`, `recuperation` (nuit vs objectif, FC de repos vs 14 nuits, VFC seulement si fiable).
- `stats.js` : `journees`, `repere` (normale = moyenne ± 1 écart-type sur 30 j, bornée aux valeurs observées), `comparerSemaines`, `records`, `pointsAttention`, `fiabilite` (VFC/stress physiologiques ou non).
- `coeur.js` : zones en mots simples (Repos, Léger, Modéré, Soutenu, Intense, Maximal), `fcMaxTanaka`, `trimp`, `parseHR`.
- Mesures qui s'accumulent dans la journée (pas, stress) : la journée en cours est exclue des normales, moyennes et couleurs.

## Structure (statique, sans build)

- `index.html` (CSP stricte, tout en `'self'`), `style.css` (tokens clair/sombre ; section « Version simplifiée » en fin de fichier)
- `js/app.js` : stockage (`nettoyer`), réglages (dont `reveil`), navigation, imports, sport déclaré, sauvegarde
- `js/coach.js` (pur), `js/vues/coach.js` (conversation), `js/vues/jour.js`, `js/vues/donnees.js`, `js/ui.js`
- `js/live.js` : direct, synchro, démo, cohérence ; `js/connexion.js` (Web Bluetooth, journal) ; `js/bracelet.js` (protocole, pur)
- Apple Santé : un site ne peut pas écrire dans Santé. « Envoyer mon pouls vers Santé » (Réglages, fiche Cœur) copie les mesures de pouls pas encore envoyées (`R.santeJusqua`, 24 h au plus, une par quart d'heure + la dernière), une ligne `jj/mm/aaaa hh:mm;bpm` chacune, puis ouvre `shortcuts://run-shortcut?name=ViaWrist Santé`. Le raccourci (créé à la main, étapes dans Réglages) lit le presse-papiers et enregistre chaque ligne ; « Mon pouls » lit le dernier échantillon pour un widget. Non testé sur iPhone (presse-papiers et ouverture de Raccourcis depuis Bluefy).
- Connexion : une recherche (`requestDevice`) ne voit pas un bracelet que l'iPhone tient déjà (il n'émet plus). Ordre : bracelet déjà connecté dans la page (`S.appareilOk`, connexion directe) ; à l'ouverture, une tentative discrète sur `getDevices` (+ `watchAdvertisements`), mise en pause une semaine après 2 échecs sans réussite (`localStorage viawrist-reconnexion`) car Bluefy retrouve l'appareil sans savoir s'y reconnecter ; sinon la liste. Sur écran tactile, la liste montre tous les appareils : le filtre de Bluefy cache le bracelet. Quitter l'app (`visibilitychange`, `pagehide`) libère le bracelet, sauf pendant une synchro. Si l'app Bionny est associée, iOS reprend le bracelet en permanence : il faut couper son Bluetooth (Réglages → Apps → Bionny) et « Oublier » le bracelet. Étapes notées dans le journal (`info`).
- `js/graphes.js`, `js/exemple.js`, `sw.js`

Stockage : `localStorage` `bionny-reglages` et `bionny-sante` (noms gardés pour ne pas perdre les données), toujours en `try/catch`. Bluefy, Safari et Chrome ont chacun leur stockage : sauvegarde/restauration JSON pour passer de l'un à l'autre.

## Tester

- `npm test` : 45 tests (dont `coach.test.js`) (sante, coeur, bracelet, stats, et `connexion.test.js` avec un faux bracelet)
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

- [ ] Pouls en direct `0x69` : prolongation toutes les 15 s, relance seulement après 45 s sans aucun paquet ; vérifier avec le journal Bluetooth (Réglages → Avancé).
- [ ] Comparer une nuit et un total de pas avec l'app Bionny (les pas de l'app Santé viennent de l'iPhone, pas du bracelet).
- [ ] iPhone : Bluefy ne voit pas le bracelet tant qu'iOS le garde connecté (« Bionny 4.0 » dans le Centre de contrôle).
