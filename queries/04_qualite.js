// =====================================================================
// PHASE 4 — CONTRÔLE QUALITÉ
// À lancer avant de publier le moindre chiffre : ces requêtes disent si
// les données supportent les analyses qu'on en tire.
// =====================================================================

// ---------------------------------------------------------------------
// 4.1 — COMPLÉTUDE
// $count dans un $facet renvoie null quand aucun document ne correspond,
// ce qui vaut zéro.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.aggregate([
  { $facet: {
      sans_titre:   [{ $match: { $or: [{ job_title: "" }, { job_title: null }] } }, { $count: "n" }],
      sans_salaire: [{ $match: { $or: [{ salary_in_usd: null }, { salary_in_usd: { $lte: 0 } }] } }, { $count: "n" }],
      sans_pays:    [{ $match: { $or: [{ company_location: "" }, { company_location: null }] } }, { $count: "n" }],
      sans_annee:   [{ $match: { work_year: null } }, { $count: "n" }]
  }}
])

// Détection de salaires anormalement bas, signe d'une erreur de saisie.
db.jobs_clean.aggregate([
  { $match: { salary_in_usd: { $lt: 20000 } } },
  { $count: "salaires_tres_bas" }
])

// ---------------------------------------------------------------------
// 4.2 — DOUBLONS
// Le jeu de données n'a pas de clé métier : on teste la combinaison
// identifiante la plus probable. Ces requêtes NE SUPPRIMENT RIEN.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.aggregate([
  { $group: { _id: { t: "$job_title", a: "$work_year", s: "$salary_in_usd",
                     l: "$company_location", e: "$experience_level" },
              n: { $sum: 1 } }},
  { $match: { n: { $gt: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 20 }
])

// Combien de groupes uniques subsisteraient après déduplication ?
// À comparer aux 71913 lignes totales pour mesurer l'ampleur du phénomène.
db.ai_jobs_salaries_clean.aggregate([
  { $group: { _id: { t: "$job_title", a: "$work_year", s: "$salary_in_usd",
                     l: "$company_location", e: "$experience_level" } } },
  { $count: "groupes_uniques" }
])

// ---------------------------------------------------------------------
// 4.3 — COHÉRENCE DES CONVERSIONS DE DEVISE
// Le taux implicite = salary_in_usd / salary. Pour une devise donnée,
// il doit être à peu près constant. Un écart signale une ligne corrompue.
// ---------------------------------------------------------------------
db.jobs_clean.aggregate([
  { $match: { salary_currency: { $ne: "USD" } } },
  { $group: { _id: "$salary_currency",
              taux_min: { $min: { $divide: ["$salary_in_usd", "$salary"] } },
              taux_max: { $max: { $divide: ["$salary_in_usd", "$salary"] } },
              taux_moyen: { $round: [{ $avg: { $divide: ["$salary_in_usd", "$salary"] } }, 4] },
              n: { $sum: 1 } }},
  { $sort: { n: -1 } }
])

// Liste des lignes les plus suspectes (taux implicite le plus faible).
db.jobs_clean.aggregate([
  { $match: { salary_currency: { $ne: "USD" } } },
  { $project: { salary_currency: 1, salary: 1, salary_in_usd: 1,
                taux_implicite: { $round: [{ $divide: ["$salary_in_usd", "$salary"] }, 4] } }},
  { $sort: { taux_implicite: 1 } },
  { $limit: 20 }
])

// ---------------------------------------------------------------------
// 4.4 — COHÉRENCE INTERNE
// Le ratio remote_ratio et le libellé work_mode doivent concorder.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.aggregate([
  { $group: { _id: { ratio: "$remote_ratio", mode: "$work_mode" }, n: { $sum: 1 } } },
  { $sort: { "_id.ratio": 1 } }
])

// Nombre de pays d'employeur distincts pour une même résidence déclarée.
db.ai_jobs_salaries_clean.aggregate([
  { $group: { _id: "$employee_residence",
              pays_employeur: { $addToSet: "$company_location" },
              n: { $sum: 1 } }},
  { $project: { n: 1, nb_pays_employeurs: { $size: "$pays_employeur" } } },
  { $sort: { n: -1 } },
  { $limit: 10 }
])
