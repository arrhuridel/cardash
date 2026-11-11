# CarDash sur ton iPad : guide pas à pas

Le principe : GitHub fabrique l'application (un fichier `.ipa`), puis Sideloadly l'installe sur ton iPad.

## A. Tester en local (avant d'envoyer)

1. Ouvre un terminal dans `C:\Users\Arthur\Documents\CarDash\apercu`.
2. Lance : `python -m http.server 8765 --bind 0.0.0.0`
3. Sur l'iPad (même Wi-Fi), ouvre Safari : `http://192.168.1.61:8765`
4. Regarde le visuel. Le GPS sera refusé dans Safari (page non sécurisée). C'est normal : dans l'application installée, il marchera.

## B. Envoyer sur GitHub

1. Sur github.com, crée un dépôt **privé** nommé `cardash` (sans README).
2. Dans un terminal, dans `C:\Users\Arthur\Documents\CarDash` :
   - `git init`
   - `git add .`
   - `git status` (vérifie qu'il n'y a ni clé ni mot de passe dans la liste)
   - `git commit -m "CarDash"`
   - `git branch -M main`
   - `git remote add origin https://github.com/TON_NOM/cardash.git`
   - `git push -u origin main`
3. Ne mets jamais ta clé TomTom ni ton jeton Apple Music dans les fichiers : tu les saisis dans l'application, dans Réglages.

## C. Fabriquer l'application

1. Sur GitHub, ouvre ton dépôt, onglet **Actions**.
2. Choisis « Construire CarDash pour iPad », puis **Run workflow**.
3. Attends 10 à 15 minutes. Une coche verte = réussi.
4. Ouvre l'exécution terminée, en bas : **CarDash-ipa**. Télécharge-le et dézippe-le : tu obtiens `CarDash.ipa`.
5. Si c'est rouge : copie-moi le message d'erreur, je corrige.

## D. Installer avec Sideloadly

1. Installe Sideloadly sur ton PC (sideloadly.io), et iTunes + iCloud versions de apple.com (pas Microsoft Store) si Sideloadly le demande.
2. Branche l'iPad en USB, touche « Se fier à cet ordinateur ».
3. Sur l'iPad : Réglages, Confidentialité et sécurité, active le **Mode développeur** (redémarrage de l'iPad).
4. Dans Sideloadly : glisse `CarDash.ipa`, entre ton identifiant Apple, clique **Start**.
5. Sur l'iPad : Réglages, Général, VPN et gestion de l'appareil, fais confiance à ton identifiant.
6. Ouvre CarDash. Autorise la localisation quand l'iPad le demande.

## Limites à connaître

- Avec un identifiant Apple gratuit, l'application expire au bout de **7 jours** : il faut la réinstaller avec Sideloadly.
- Non vérifié : le fonctionnement d'Apple Music dans l'application installée.
- Non vérifié : la construction sur GitHub (je n'ai pas pu la lancer d'ici).
