# Requêtes MongoDB — documentation

Toutes les requêtes du projet, regroupées par phase. Elles s'exécutent dans l'éditeur de requêtes
Navicat Premium, connecté à la base MongoDB (`CONNECT_MDB`) et à la collection
`ai_jobs_salaries_clean`.

Les scripts équivalents sont dans `queries/`, un fichier par phase.

---

## Points de méthode

**Ne jamais placer de commentaire avant le `db.`** dans l'éditeur Navicat. Un titre de section en
première ligne fait découper le bloc par l'éditeur avant son envoi au moteur, qui reçoit alors un
pipeline tronqué et renvoie une erreur d'opérateur (par exemple
`$round accumulator is a unary operator`). Les commentaires se placent *à l'intérieur* du pipeline
ou entre deux instructions.

**Sélectionner avant de lancer.** Navicat n'affiche qu'un seul jeu de résultats à la fois — celui
de la dernière instruction exécutée. Pour conserver plusieurs résultats côte à côte, utiliser le
bouton **Pin**.

**Le nom de la collection est `ai_jobs_salaries_clean`**, et non `jobs`. Une instruction sur une
collection inexistante ne lève pas d'erreur : `updateMany` renvoie simplement
`matchedCount: 0`, et `find` un résultat vide.

---

## Q01 — Découverte de la structure

```javascript
db.getCollectionNames()
db.ai_jobs_salaries_clean.countDocuments()
db.ai_jobs_salaries_clean.findOne()
typeof db.ai_jobs_salaries_clean.findOne().salary_in_usd
typeof db.ai_jobs_salaries_clean.findOne().salary_outlier_flag
```

**Résultat :** 71 913 documents. `salary_in_usd` est de type `number` et `salary_outlier_flag`
de type `boolean` — l'import a conservé les types, aucun nettoyage n'est nécessaire.

---

## Q02 — Enrichissement et isolation des valeurs aberrantes

```javascript
db.ai_jobs_salaries_clean.updateMany({}, [{ $set: {
  salaire_mensuel_usd: { $round: [{ $divide: ["$salary_in_usd", 12] }, 0] },
  cross_border: { $ne: ["$employee_residence", "$company_location"] }
}}])

db.ai_jobs_salaries_clean.aggregate([
  { $match: { salary_outlier_flag: true } },
  { $out: "jobs_outliers" }
])

db.createCollection("jobs_clean", {
  viewOn: "ai_jobs_salaries_clean",
  pipeline: [{ $match: { salary_outlier_flag: false } }]
})
```

**Résultat :** 1 754 documents isolés dans `jobs_outliers`, et une vue `jobs_clean` de
70 159 documents. Écart de salaire moyen entre les deux périmètres : 409 749 $ contre 144 696 $.

---

## Q03 — Carte d'identité du marché (`$facet`)

```javascript
db.jobs_clean.aggregate([
  { $facet: {
      par_annee: [
        { $group: { _id: "$work_year", nb: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $group: { _id: null, annees: { $push: { annee: "$_id", nb: "$nb" } }, total: { $sum: "$nb" } } },
        { $unwind: "$annees" },
        { $project: { _id: 0, annee: "$annees.annee", nb: "$annees.nb",
                      part_pct: { $round: [{ $multiply: [{ $divide: ["$annees.nb", "$total"] }, 100] }, 1] } } },
        { $sort: { annee: 1 } }
      ],
      par_experience: [{ $group: { _id: "$experience_level_label", n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      par_mode:       [{ $group: { _id: "$work_mode", n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      par_zone:       [{ $group: { _id: { $cond: [{ $eq: ["$company_location", "US"] }, "US", "Hors US"] }, n: { $sum: 1 } } },
                       { $sort: { n: -1 } }]
  }}
])
```

**Résultat :** 60 147 offres américaines contre 11 766 hors US. Contrats Full-time à 99 %,
entreprises de taille Medium à 97,5 %, mode Hybrid à 327 lignes seulement, et 92 % du corpus
sur 2024-2025.

---

## Q04 — Salaires par niveau d'expérience

```javascript
db.jobs_clean.aggregate([
  { $group: {
      _id: "$experience_level_label",
      moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
      mediane: { $median: { input: "$salary_in_usd", method: "approximate" } },
      q1_q3: { $percentile: { input: "$salary_in_usd", p: [0.25, 0.75], method: "approximate" } },
      n: { $sum: 1 }
  }},
  { $sort: { moyenne: -1 } }
])
```

**Résultat :**

| Niveau | Moyenne | Médiane | Q1 – Q3 | n |
|---|---|---|---|---|
| Executive-level | 188 040 $ | 183 800 $ | 142 250 – 233 600 $ | 2 638 |
| Senior-level | 160 838 $ | 153 600 $ | 114 108 – 201 100 $ | 36 623 |
| Mid-level | 130 783 $ | 120 000 $ | 85 000 – 166 810 $ | 22 971 |
| Entry-level | 96 019 $ | 85 080 $ | 60 000 – 122 500 $ | 7 927 |

---

## Q05 — Tableau croisé métier × niveau d'expérience

```javascript
db.jobs_clean.aggregate([
  { $match: { role_family: { $in: ["Data Scientist", "Data Engineer", "Data Analyst"] } } },
  { $group: {
      _id: { famille: "$role_family", niveau: "$experience_level" },
      moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
      n: { $sum: 1 }
  }},
  { $match: { n: { $gte: 20 } } },
  { $project: { _id: 0, famille: "$_id.famille", niveau: "$_id.niveau", moyenne: 1, n: 1 } },
  { $sort: { famille: 1, moyenne: -1 } }
])
```

**Résultat :** le classement des métiers est stable à tous les niveaux — Data Scientist devant
Data Engineer, devant Data Analyst. L'écart se creuse avec la séniorité : 11 000 $ en Entry,
40 000 $ entre Senior Data Scientist et Senior Data Analyst.

---

## Q06 — Effet du mode de travail

```javascript
db.jobs_clean.aggregate([
  { $group: { _id: "$work_mode",
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              n: { $sum: 1 } }},
  { $sort: { moyenne: -1 } }
])
```

**Résultat :** Remote 145 486 $, On-site 144 843 $, Hybrid 78 841 $ (sur 324 lignes seulement).
L'écart entre télétravail et présentiel est de 0,4 %, non significatif. L'analyse croisée avec le
niveau d'expérience montre que la composition des groupes explique l'écart apparent.

---

## Q07 — Requêtes géographiques

```javascript
db.jobs_clean.aggregate([
  { $group: { _id: "$company_location",
              mediane: { $median: { input: "$salary_in_usd", method: "approximate" } },
              n: { $sum: 1 } }},
  { $match: { n: { $gte: 100 } } },
  { $sort: { mediane: -1 } }
])
```

**Résultat :** les salaires ne sont pas corrigés du coût de la vie, donc les classements par pays
reflètent surtout des niveaux de vie différents. Le corpus étant américain à 83,6 %, les
comparaisons mesurent des écarts au marché américain.

---

## Q08 — MapReduce et équivalent en pipeline

```javascript
db.ai_jobs_salaries_clean.mapReduce(
  function () {
    if (this.salary_outlier_flag === true) return;
    emit(this.role_family, { somme: this.salary_in_usd, nb: 1 });
  },
  function (cle, valeurs) {
    let somme = 0, nb = 0;
    for (const v of valeurs) { somme += v.somme; nb += v.nb; }
    return { somme: somme, nb: nb };
  },
  {
    finalize: function (cle, r) { r.moyenne_usd = Math.round(r.somme / r.nb); return r; },
    out: "mr_moyenne_par_famille",
    query: { salary_outlier_flag: false }
  }
)

db.mr_moyenne_par_famille.find().sort({ "value.moyenne_usd": -1 })
```

**Résultat :** AI Architect 192 781 $, Research Scientist 177 687 $, ML Engineer 176 789 $,
Analytics Manager 168 747 $, Computer Vision 161 895 $. Identique au pipeline d'agrégation.

Deux enseignements techniques : le `reduce` doit renvoyer des **sommes** et non une moyenne, car
MongoDB peut l'appeler plusieurs fois sur une même clé (re-reduce) — d'où le calcul final dans
`finalize`. Et la **médiane ne peut pas** être calculée en MapReduce, n'étant pas décomposable en
résultats partiels.

---

## Q09 — Index et plans d'exécution

```javascript
db.ai_jobs_salaries_clean.createIndex({ role_family: 1, work_year: 1 })
db.ai_jobs_salaries_clean.createIndex({ experience_level: 1, salary_in_usd: -1 })

db.ai_jobs_salaries_clean.find({ role_family: "ML Engineer", work_year: 2025 })
  .explain("executionStats")
```

**Résultat :** passage de `COLLSCAN` (parcours des 71 913 documents) à `IXSCAN` (lecture ciblée).
Le champ `totalDocsExamined` de l'`explain` mesure la différence : il chute de 71 913 à quelques
dizaines de documents pour une requête ciblée.
