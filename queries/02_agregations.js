// =====================================================================
// PHASE 2 — AGRÉGATIONS D'ANALYSE
// Toutes les requêtes portent sur la vue jobs_clean (sans les valeurs aberrantes).
// NE PAS placer de commentaire avant le "db." : l'éditeur Navicat découpe mal
// le bloc et le moteur reçoit un pipeline tronqué.
// =====================================================================

// ---------------------------------------------------------------------
// 2.1 — CARTE D'IDENTITÉ DU MARCHÉ en une seule requête
// $facet exécute ses sous-pipelines en parallèle sur les mêmes documents
// et renvoie un document unique contenant tous les tableaux.
// ---------------------------------------------------------------------
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
      par_contrat:    [{ $group: { _id: "$employment_type_label", n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      par_mode:       [{ $group: { _id: "$work_mode", n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      par_taille:     [{ $group: { _id: "$company_size", n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      par_devise:     [{ $group: { _id: "$salary_currency", n: { $sum: 1 } } }, { $sort: { n: -1 } }],

      par_zone: [
        { $group: { _id: { $cond: [{ $eq: ["$company_location", "US"] }, "US", "Hors US"] }, n: { $sum: 1 } } },
        { $sort: { n: -1 } }
      ],

      top_pays: [{ $group: { _id: "$company_location", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]
  }}
])

// ---------------------------------------------------------------------
// 2.2 — SALAIRES PAR NIVEAU D'EXPÉRIENCE
// $median et $percentile exigent MongoDB 7.0+. Sinon, voir la version
// compatible en fin de section.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $group: {
      _id: "$experience_level_label",
      moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
      mediane: { $median: { input: "$salary_in_usd", method: "approximate" } },
      q1_q3: { $percentile: { input: "$salary_in_usd", p: [0.25, 0.75], method: "approximate" } },
      min: { $min: "$salary_in_usd" },
      max: { $max: "$salary_in_usd" },
      n: { $sum: 1 }
  }},
  { $sort: { moyenne: -1 } }
])

// Version avec colonnes scalaires : $arrayElemAt déroule le tableau renvoyé.
db.jobs_clean.aggregate([
  { $group: {
      _id: "$experience_level_label",
      moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
      stats: { $percentile: { input: "$salary_in_usd", p: [0.25, 0.5, 0.75], method: "approximate" } },
      n: { $sum: 1 }
  }},
  { $project: { _id: 0, niveau: "$_id", moyenne: 1,
                q1: { $arrayElemAt: ["$stats", 0] },
                mediane: { $arrayElemAt: ["$stats", 1] },
                q3: { $arrayElemAt: ["$stats", 2] },
                n: 1 }},
  { $sort: { moyenne: -1 } }
])

// Version compatible MongoDB 4.x et 5.x : sans $median ni $percentile.
db.jobs_clean.aggregate([
  { $group: { _id: "$experience_level_label",
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              min: { $min: "$salary_in_usd" },
              max: { $max: "$salary_in_usd" },
              n: { $sum: 1 } }},
  { $sort: { moyenne: -1 } }
])

// ---------------------------------------------------------------------
// 2.3 — PROGRESSION ENTRE NIVEAUX
// $setWindowFields compare chaque ligne à la précédente : le $shift -1
// récupère la moyenne du niveau situé juste avant.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $group: { _id: "$experience_level", moyenne: { $avg: "$salary_in_usd" } } },
  { $sort: { _id: 1 } },
  { $setWindowFields: {
      sortBy: { _id: 1 },
      output: { moyenne_precedente: { $shift: { output: "$moyenne", by: -1 } } } } },
  { $project: { _id: 0, niveau: "$_id",
                moyenne: { $round: ["$moyenne", 0] },
                ecart_pct: { $round: [{ $multiply: [{ $divide: [
                  { $subtract: ["$moyenne", "$moyenne_precedente"] }, "$moyenne_precedente"] }, 100] }, 1] } } }
])

// ---------------------------------------------------------------------
// 2.4 — ÉVOLUTION PAR ANNÉE
// Filtre à partir de 2023 : avant, le volume par année est trop faible
// (75 à 1114 offres) pour qu'une tendance soit fiable.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $match: { work_year: { $gte: 2023 } } },
  { $group: { _id: "$work_year",
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              mediane: { $median: { input: "$salary_in_usd", method: "approximate" } },
              n: { $sum: 1 } }},
  { $sort: { _id: 1 } }
])

// ---------------------------------------------------------------------
// 2.5 — CLASSEMENT DES FAMILLES DE MÉTIERS
// "Other / Unclassified" (56 % des lignes) est écartée : elle mélange tout
// et écraserait le classement.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $match: { role_family: { $ne: "Other / Unclassified" } } },
  { $group: { _id: "$role_family",
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              mediane: { $median: { input: "$salary_in_usd", method: "approximate" } },
              n: { $sum: 1 } }},
  { $sort: { moyenne: -1 } }
])

// Poids de chaque famille dans le total, en %.
db.jobs_clean.aggregate([
  { $group: { _id: "$role_family", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $group: { _id: null, familles: { $push: { famille: "$_id", n: "$n" } }, total: { $sum: "$n" } } },
  { $unwind: "$familles" },
  { $project: { _id: 0, famille: "$familles.famille", n: "$familles.n",
                part_pct: { $round: [{ $multiply: [{ $divide: ["$familles.n", "$total"] }, 100] }, 1] } } },
  { $sort: { n: -1 } }
])

// Top 15 des intitulés précis : seuil de 50 offres pour éviter qu'un poste
// vu trois fois avec un salaire extrême arrive en tête.
db.jobs_clean.aggregate([
  { $group: { _id: "$job_title",
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              n: { $sum: 1 } }},
  { $match: { n: { $gte: 50 } } },
  { $sort: { moyenne: -1 } },
  { $limit: 15 }
])

// ---------------------------------------------------------------------
// 2.6 — TABLEAU CROISÉ FAMILLE × NIVEAU
// Cellules d'au moins 20 offres : en dessous, la moyenne n'est pas fiable.
// NE PAS placer de commentaire avant le db : le pipeline serait tronqué.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $match: {
      role_family: { $in: ["Data Scientist", "Data Engineer", "Data Analyst"] }
  }},
  { $group: {
      _id: { famille: "$role_family", niveau: "$experience_level" },
      moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
      n: { $sum: 1 }
  }},
  { $match: { n: { $gte: 20 } } },
  { $project: { _id: 0, famille: "$_id.famille", niveau: "$_id.niveau", moyenne: 1, n: 1 } },
  { $sort: { famille: 1, moyenne: -1 } }
])

// ---------------------------------------------------------------------
// 2.7 — TÉLÉTRAVAIL
// Résultat contre-intuitif : Remote (145486 $) et On-site (144843 $) sont
// au coude à coude. Hybrid décroche mais sur 324 lignes seulement.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $group: { _id: "$work_mode",
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              mediane: { $median: { input: "$salary_in_usd", method: "approximate" } },
              n: { $sum: 1 } }},
  { $sort: { moyenne: -1 } }
])

// Mode de travail × niveau d'expérience : l'effet varie-t-il selon la séniorité ?
db.jobs_clean.aggregate([
  { $group: { _id: { mode: "$work_mode", exp: "$experience_level" },
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              n: { $sum: 1 } }},
  { $match: { n: { $gte: 20 } } },
  { $sort: { "_id.exp": 1, moyenne: -1 } }
])

// Composition par niveau d'expérience selon le mode : c'est ici que se joue
// l'explication de l'absence d'effet du télétravail.
db.jobs_clean.aggregate([
  { $group: { _id: { mode: "$work_mode", exp: "$experience_level" }, n: { $sum: 1 } } },
  { $group: { _id: "$_id.mode", repartition: { $push: { exp: "$_id.exp", n: "$n" } },
              total: { $sum: "$n" } } },
  { $unwind: "$repartition" },
  { $project: { _id: 0, mode: "$_id", exp: "$repartition.exp", n: "$repartition.n",
                part_pct: { $round: [{ $multiply: [{ $divide: ["$repartition.n", "$total"] }, 100] }, 1] } } },
  { $sort: { mode: 1, part_pct: -1 } }
])

// ---------------------------------------------------------------------
// 2.8 — GÉOGRAPHIE
// Au moins 100 offres par pays, sinon la médiane ne veut rien dire.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $group: { _id: "$company_location",
              mediane: { $median: { input: "$salary_in_usd", method: "approximate" } },
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              n: { $sum: 1 } }},
  { $match: { n: { $gte: 100 } } },
  { $sort: { mediane: -1 } }
])

// Flux transfrontaliers : emplois dont l'employé réside dans un autre pays.
db.jobs_clean.aggregate([
  { $match: { cross_border: true } },
  { $group: { _id: { residence: "$employee_residence", entreprise: "$company_location" },
              n: { $sum: 1 },
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] } }},
  { $sort: { n: -1 } },
  { $limit: 20 }
])

// ---------------------------------------------------------------------
// 2.9 — DISTRIBUTION DES SALAIRES
// $bucket découpe en tranches ; la dernière borne est incluse.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $bucket: {
      groupBy: "$salary_in_usd",
      boundaries: [0, 25000, 50000, 75000, 100000, 125000, 150000, 175000, 200000, 250000, 340000],
      default: "Autre",
      output: { n: { $sum: 1 } }
  }}
])

// Répartition par tranche lisible (champ salary_band créé en phase 1).
db.jobs_clean.aggregate([
  { $group: { _id: "$salary_band", n: { $sum: 1 } } },
  { $sort: { n: -1 } }
])

// ---------------------------------------------------------------------
// 2.10 — MATÉRIALISATION DES RÉSUMÉS (phase Load de l'ETL)
// $merge plutôt que $out : la requête est réexécutable sans erreur,
// elle remplace les documents existants au lieu d'échouer.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $match: { role_family: { $ne: "Other / Unclassified" } } },
  { $group: { _id: { famille: "$role_family", annee: "$work_year" },
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              n: { $sum: 1 } }},
  { $merge: { into: "resume_famille_annee", whenMatched: "replace", whenNotMatched: "insert" } }
])

db.resume_famille_annee.countDocuments()
