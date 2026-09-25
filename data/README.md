# Données sources

## Fichier

`data/raw/ai_jobs_salaries_clean.csv`

- **Volume** : 8,7 Mo
- **Lignes** : 71 913 + 1 ligne d'en-tête
- **Colonnes** : 17
- **Encodage** : UTF-8, sans BOM
- **Séparateur** : virgule

Le fichier **n'est pas versionné** dans ce dépôt. Pour reproduire le projet, le placer dans
`data/raw/` avant de lancer l'import.

## Colonnes

| Colonne | Type | Description |
|---|---|---|
| `work_year` | entier | Année de l'offre (2020 à 2025) |
| `experience_level` | texte | Code du niveau : EN, MI, SE, EX |
| `employment_type` | texte | Code du contrat : FT, PT, CT, FL |
| `job_title` | texte | Intitulé du poste (422 valeurs distinctes) |
| `salary` | entier | Salaire annuel dans la devise d'origine |
| `salary_currency` | texte | Devise : USD, GBP, EUR, CAD, INR |
| `salary_in_usd` | entier | Salaire annuel converti en dollars |
| `employee_residence` | texte | Pays de résidence de l'employé (code ISO) |
| `remote_ratio` | entier | Part de télétravail : 0, 50 ou 100 |
| `company_location` | texte | Pays d'implantation de l'entreprise (97 valeurs) |
| `company_size` | texte | Taille : S, M, L |
| `experience_level_label` | texte | Libellé lisible du niveau d'expérience |
| `employment_type_label` | texte | Libellé lisible du type de contrat |
| `work_mode` | texte | On-site, Hybrid ou Remote |
| `salary_outlier_flag` | booléen | Marque les 1 754 salaires extrêmes |
| `role_family` | texte | Famille de métiers (11 valeurs) |
| `isco_group_hint` | texte | Rattachement à la nomenclature internationale des métiers |

## Points d'attention

Le jeu de données est **semi-préparé** : les colonnes `_label`, `work_mode`, `salary_outlier_flag`
et `role_family` sont fournies avec le fichier, ce qui dispense de les recalculer à l'import.

Deux particularités ont guidé la conception de la base :

- `salary_outlier_flag` est un **booléen** après import. Les filtres s'écrivent donc
  `{ salary_outlier_flag: false }`, **sans guillemets** autour de `false`.
- Les champs numériques doivent être importés en **Int64** et non en texte, faute de quoi les
  opérateurs `$avg`, `$sum` et `$gt` renverraient des résultats nuls ou erronés.

## Licence et origine

Le jeu de données provient d'une source publique de type *AI Jobs & Salaries*. Vérifier la licence
d'origine avant toute redistribution et citer la source dans tout travail dérivé. En cas de doute
sur les droits de diffusion, conserver uniquement le lien de téléchargement et le script d'import,
sans inclure le CSV dans le dépôt.
