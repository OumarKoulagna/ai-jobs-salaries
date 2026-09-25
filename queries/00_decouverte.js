// =====================================================================
// PHASE 0 — DÉCOUVERTE
// Vérifie la structure, les types et le volume avant toute analyse.
// Objectif : éviter un nettoyage inutile et détecter un import incomplet.
// =====================================================================

// Liste les collections présentes dans la base.
db.getCollectionNames()

// Nombre total de documents : la valeur attendue est 71913.
// Un écart signale un import partiel ou un doublon.
db.ai_jobs_salaries_clean.countDocuments()

// Affiche un document complet, pour inspecter la structure et les noms de champs.
db.ai_jobs_salaries_clean.findOne()

// Vérifie le type de salary_in_usd : "number" = aucune conversion nécessaire.
db.ai_jobs_salaries_clean.findOne({}, { salary_in_usd: 1, work_year: 1, remote_ratio: 1 })

// Contrôle le type de chaque champ numérique d'un coup.
typeof db.ai_jobs_salaries_clean.findOne().salary_in_usd
typeof db.ai_jobs_salaries_clean.findOne().salary
typeof db.ai_jobs_salaries_clean.findOne().work_year
typeof db.ai_jobs_salaries_clean.findOne().remote_ratio

// Contrôle le type du drapeau d'outlier.
// "boolean" = filtrer avec false ; "string" = filtrer avec "False".
typeof db.ai_jobs_salaries_clean.findOne().salary_outlier_flag

// Liste les noms exacts des champs, pour repérer une colonne renommée à l'import.
Object.keys(db.ai_jobs_salaries_clean.findOne())

// Distribution des valeurs du drapeau : confirme le nombre d'extrêmes (1754 attendus).
db.ai_jobs_salaries_clean.aggregate([
  { $group: { _id: "$salary_outlier_flag", n: { $sum: 1 } } },
  { $sort: { n: -1 } }
])

// Empreinte du dataset : années couvertes, titres distincts, pays distincts.
db.ai_jobs_salaries_clean.aggregate([
  { $facet: {
      annees:  [{ $group: { _id: "$work_year", n: { $sum: 1 } } }, { $sort: { _id: 1 } }],
      titres:  [{ $group: { _id: "$job_title" } }, { $count: "distincts" }],
      pays:    [{ $group: { _id: "$company_location" } }, { $count: "distincts" }],
      devises: [{ $group: { _id: "$salary_currency", n: { $sum: 1 } } }, { $sort: { n: -1 } }]
  }}
])
