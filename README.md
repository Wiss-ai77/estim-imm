# Estim'Immo

Estimation du prix au m² d'un bien immobilier **à partir des ventes réelles** (base DVF
« Demandes de valeurs foncières géolocalisées », DGFiP / Etalab) autour d'une position,
avec **ajustement selon la classe DPE** et un module « projet » : vendre un bien ici,
acheter là-bas, bilan financier.

Site 100 % statique (HTML / CSS / JavaScript), sans serveur ni base de données.
Les fichiers DVF ne peuvent pas être lus directement par un navigateur depuis un autre
site (pas de CORS sur `files.data.gouv.fr`), donc une **GitHub Action** (`.github/workflows/update-data.yml`)
télécharge les données par département, les nettoie avec `scripts/build-data.mjs` et les
range en JSON compact dans `data/<code INSEE>.json`. Le site lit ces fichiers depuis sa propre
origine. Par défaut : Île-de-France (75, 77, 78, 91, 92, 93, 94, 95) ; la liste se change dans
le script ou au lancement manuel de l'Action. Mise à jour automatique le 1er de chaque mois.

## Fonctionnalités

- 📍 Géolocalisation du navigateur, saisie d'adresse avec autocomplétion (API Adresse), ou clic sur la carte.
- 🗺️ Carte des ventes (Leaflet / OpenStreetMap), colorées selon leur position par rapport aux quartiles.
- 📊 Médiane et fourchette P25–P75 du prix au m² dans un rayon réglable (300 m → commune entière), évolution par année, liste des ventes comparables.
- 🔋 Ajustement DPE (A → G) d'après l'étude « valeur verte » des Notaires de France (transactions 2024), avec deux jeux de coefficients : Île-de-France (écarts atténués) ou France entière.
- 🏠🔑 Module projet : estimation du bien à vendre et du bien à acheter, frais d'agence, capital restant dû, frais de notaire, apport → solde et surface finançable.
- 🔗 Pré-remplissage par URL : `?q=adresse&type=Maison&surface=100&dpe=D&auto=1`.

## Méthode

1. **Données** : `https://files.data.gouv.fr/geo-dvf/latest/csv/<année>/communes/<dép>/<code INSEE>.csv`, années 2020 → dernière publication (mise à jour en avril et octobre, ~6 mois de décalage).
2. **Nettoyage** : `nature_mutation = Vente` uniquement ; une transaction = un logement (`Maison` ou `Appartement`, dépendances ignorées, ventes en bloc > 2 lots, mélanges maison/appartement et locaux commerciaux exclus) ; prix au m² (surface réelle bâtie) entre 500 et 25 000 €.
3. **Statistique** : médiane et quartiles des ventes dans le rayon, sur 24 mois par défaut (élargi automatiquement si moins de 8 ventes). Moins de 8 ventes → marqué « fragile ».
4. **DPE** : la médiane DVF est prise comme référence d'un bien de classe D, puis multipliée par `1 + coef(classe)`. Coefficients dans `js/dvf.js` (`DPE_COEF`), modifiables.

Limites : pas d'Alsace-Moselle ni de Mayotte dans DVF ; les 6 à 12 derniers mois manquent ; l'état du bien, l'étage, l'exposition ne sont pas pris en compte. Ordre de grandeur pour préparer une négociation, pas une expertise.

## Lancer en local

```bash
# n'importe quel serveur statique, par exemple :
python3 -m http.server 8000
# puis http://localhost:8000
```

Tests du nettoyage : `node test/test_dvf.js`.

Générer les données en local (Île-de-France, quelques minutes) : `node scripts/build-data.mjs`
ou un seul département : `node scripts/build-data.mjs 94`.

## Déployer sur GitHub Pages

1. Onglet **Actions** → « Mise à jour des données DVF » → *Run workflow* (la première fois ; ensuite c'est mensuel).
2. **Settings → Pages** → Source : *Deploy from a branch* → `main` / `/ (root)`.
3. Le site est disponible sur `https://<utilisateur>.github.io/<dépôt>/`.

## Sources et licences

- [DVF géolocalisées](https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres-geolocalisees) — Licence Ouverte 2.0
- [API Adresse](https://adresse.data.gouv.fr/api-doc/adresse) — Base Adresse Nationale
- Notaires de France, *La valeur verte des logements*, transactions 2024 (déc. 2025)
- Cartes : © OpenStreetMap contributors ; [Leaflet](https://leafletjs.com)

Code sous licence MIT.
