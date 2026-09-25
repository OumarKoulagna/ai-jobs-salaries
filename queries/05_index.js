// =====================================================================
// PHASE 5 — INDEXATION ET PLANS D'EXÉCUTION
// À lancer APRÈS avoir testé les requêtes : un index ralentit les écritures,
// donc on indexe seulement ce qui sert vraiment.
// =====================================================================

// ---------------------------------------------------------------------
// 5.1 — CRÉATION DES INDEX
// L'ordre des champs compte : le premier est celui des filtres d'égalité,
// le second celui du tri ou du filtre de plage.
// ---------------------------------------------------------------------

// Sert les analyses par métier et par année (phase 2.5 et 2.10).
db.ai_jobs_salaries_clean.createIndex({ role_family: 1, work_year: 1 })

// Sert les classements par niveau et les tris sur le salaire.
db.ai_jobs_salaries_clean.createIndex({ experience_level: 1, salary_in_usd: -1 })

// Sert les analyses géographiques filtrées sur les extrêmes.
db.ai_jobs_salaries_clean.createIndex({ company_location: 1, salary_outlier_flag: 1 })

// Sert les analyses par mode de travail.
db.ai_jobs_salaries_clean.createIndex({ work_mode: 1, experience_level: 1 })

// ---------------------------------------------------------------------
// 5.2 — ÉTAT DES LIEUX
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.getIndexes()

// Taille occupée par chaque index, pour repérer un index inutile ou obèse.
db.ai_jobs_salaries_clean.stats().indexSizes

// ---------------------------------------------------------------------
// 5.3 — PLANS D'EXÉCUTION
// Chercher "IXSCAN" (lecture par index) contre "COLLSCAN" (parcours complet).
// totalKeysExamined indique combien de clés l'index a fait lire ;
// totalDocsExamined, combien de documents ont été ouverts.
// ---------------------------------------------------------------------

// Requête servie par l'index composé role_family + work_year.
db.ai_jobs_salaries_clean.find({ role_family: "ML Engineer", work_year: 2025 })
  .explain("executionStats")

// Requête servie par l'index experience_level + salary_in_usd.
db.ai_jobs_salaries_clean.find({ experience_level: "SE" })
  .sort({ salary_in_usd: -1 })
  .limit(20)
  .explain("executionStats")

// Requête NON indexée : doit produire un COLLSCAN sur les 71913 documents.
db.ai_jobs_salaries_clean.find({ job_title: "Data Scientist" })
  .explain("executionStats")

// ---------------------------------------------------------------------
// 5.4 — COMPARAISON AVANT / APRÈS (démonstration)
// Supprimer l'index, relancer l'explain, puis le recréer : l'écart entre
// totalDocsExamined et nReturned mesure le gain.
// ---------------------------------------------------------------------
// db.ai_jobs_salaries_clean.dropIndex({ role_family: 1, work_year: 1 })
// db.ai_jobs_salaries_clean.createIndex({ role_family: 1, work_year: 1 })
