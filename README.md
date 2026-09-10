# Privagrane

Ajoutez un filigrane à vos documents. Le fichier reste sur votre machine, il n'est jamais envoyé à un serveur.

## Fonctionnalités

- Texte du filigrane personnalisable : couleur, taille, opacité, rotation, motif répété ou centré
- Compatible PDF, PNG, JPG et WEBP
- Traitement 100 % local : aperçu et export se font entièrement côté client
- Aucun compte, aucun cookie, aucune requête vers un service tiers

## Démarrage

Prérequis : Node.js 22+

```bash
npm install
npm run dev
```

## Build de production

```bash
npm run build    # → dist/
npm run preview  # sert dist/ localement pour vérifier le build
```

`dist/` est un site statique déployable sur n'importe quel hébergeur (GitHub Pages, Netlify, Cloudflare Pages…), sans configuration serveur particulière.

## Stack technique

- [Vite](https://vitejs.dev/) + TypeScript, sans framework UI (DOM manipulé directement)
- [pdf.js](https://mozilla.github.io/pdf.js/) pour l'aperçu et la rasterisation des PDF
- [pdf-lib](https://pdf-lib.js.org/) pour reconstruire le PDF exporté
- Bibliothèques et polices auto-hébergées avec le site

## Limites connues

- Un filigrane est une marque dissuasive, pas une protection cryptographique
- Le PDF exporté est rasterisé (texte non sélectionnable ni recherchable)
- Les PDF chiffrés ou protégés par mot de passe en entrée ne sont pas pris en charge

## Contribuer

Les contributions sont bienvenues : ouvrez une [issue](https://github.com/Skagiggs/privagrane/issues) ou une pull request.

## Licence

MIT — voir [LICENSE](LICENSE).
