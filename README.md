# ViaWrist

Application web personnelle pour exploiter le bracelet **Bionny 4.0** sur iPhone, sans l'app officielle : sommeil et ses phases, pouls et FC de repos, oxygène, pas et distance, lus directement dans le bracelet en Bluetooth (via l'app Bluefy). La variabilité et le stress du bracelet ne sont affichés que s'ils passent un contrôle de fiabilité.

- **Aujourd'hui** : pouls en direct, ta forme ce matin, quoi faire aujourd'hui, à quelle heure te coucher ce soir.
- **Coach** : pose tes questions (sommeil, sport, fatigue, cœur) ; il répond avec tes chiffres et des règles reconnues (OMS), sans IA en ligne.
- **Données** : sommeil, activité, cœur, oxygène ; détail du jour, tendances et calendrier.
- **Réglages** : profil, objectifs, heure de lever, sauvegarde.

Aucune valeur inventée : sans mesure, l'app affiche « – ». Site statique sans dépendance ni ressource tierce. Aucune donnée n'est envoyée sur un serveur : tout reste dans le navigateur du téléphone.

Développement : `npm test`, puis `python -m http.server 8765` et `http://localhost:8765/outils/apercu.html` pour des données d'exemple. Détails dans `CLAUDE.md`.
