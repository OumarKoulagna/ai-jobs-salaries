// =====================================================================
// PHASE 1 — NETTOYAGE ET ENRICHISSEMENT
// Ajoute les champs calculés, isole les valeurs aberrantes, crée la vue de travail.
// À exécuter une seule fois, dans cet ordre.
// =====================================================================

// ---------------------------------------------------------------------
// 1.1 — Conversion des types (SI ET SEULEMENT SI l'import a laissé du texte)
// La phase 0 a montré que les types sont bons : cette requête est sans effet ici.
// Elle est conservée pour le cas d'un réimport depuis un CSV mal typé.
// Un $set dans un tableau = pipeline d'update, obligatoire pour calculer à partir d'un champ.
// Contrôle : matchedCount doit valoir 71913.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.updateMany({}, [{ $set: {
  salary_in_usd: { $toInt: "$salary_in_usd" },
  salary: { $toInt: "$salary" },
  work_year: { $toInt: "$work_year" },
  remote_ratio: { $toInt: "$remote_ratio" }
}}])

// ---------------------------------------------------------------------
// 1.2 — Normalisation du drapeau d'outlier (inutile ici : il est déjà booléen)
// $eq compare le champ à la chaîne "True" et renvoie true ou false.
// À conserver uniquement si un réimport produit du texte.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.updateMany({}, [{ $set: {
  salary_outlier_flag: { $eq: ["$salary_outlier_flag", "True"] }
}}])

// ---------------------------------------------------------------------
// 1.3 — Salaire mensuel
// Champ dérivé pour rendre les montants plus concrets à la lecture.
// $round prend exactement DEUX arguments : la valeur et le nombre de décimales.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.updateMany({}, [{ $set: {
  salaire_mensuel_usd: { $round: [{ $divide: ["$salary_in_usd", 12] }, 0] }
}}])

// ---------------------------------------------------------------------
// 1.4 — Indicateur transfrontalier
// true si l'employé ne réside pas dans le pays de son employeur.
// Sert à isoler les profils en télétravail international.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.updateMany({}, [{ $set: {
  cross_border: { $ne: ["$employee_residence", "$company_location"] }
}}])

// ---------------------------------------------------------------------
// 1.5 — Tranche de salaire lisible
// $switch évalue les cas dans l'ordre : la première condition vraie gagne.
// Évite d'avoir à écrire un $bucket dans chaque requête d'histogramme.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.updateMany({}, [{ $set: {
  salary_band: { $switch: { branches: [
    { case: { $lt: ["$salary_in_usd", 50000] },   then: "< 50k" },
    { case: { $lt: ["$salary_in_usd", 100000] },  then: "50k-100k" },
    { case: { $lt: ["$salary_in_usd", 150000] },  then: "100k-150k" },
    { case: { $lt: ["$salary_in_usd", 200000] },  then: "150k-200k" }
  ], default: "200k+" } }
}}])

// ---------------------------------------------------------------------
// 1.6 — Isolation des valeurs aberrantes
// $out écrit le résultat dans une nouvelle collection : les 1754 lignes
// extrêmes sont CONSERVÉES pour audit, et non supprimées de la source.
// Effet de bord à connaître : $out remplace la collection cible si elle existe.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.aggregate([
  { $match: { salary_outlier_flag: true } },
  { $out: "jobs_outliers" }
])

// Contrôle : la collection d'audit doit contenir 1754 documents.
db.jobs_outliers.countDocuments()

// Contrôle de l'écart entre les deux périmètres.
// 409749 $ contre 144696 $ : les extrêmes pèsent 2,4 % des lignes
// mais gonflent la moyenne globale d'environ 6000 $.
db.ai_jobs_salaries_clean.aggregate([
  { $group: { _id: "$salary_outlier_flag",
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              min: { $min: "$salary_in_usd" },
              max: { $max: "$salary_in_usd" },
              n: { $sum: 1 } }},
  { $sort: { _id: 1 } }
])

// ---------------------------------------------------------------------
// 1.7 — Vue de travail
// Applique le filtre une fois pour toutes : toutes les analyses pointent
// ensuite sur jobs_clean, sans avoir à se souvenir de la condition.
// Contrôle : doit renvoyer 70159 documents.
// ---------------------------------------------------------------------
db.createCollection("jobs_clean", {
  viewOn: "ai_jobs_salaries_clean",
  pipeline: [{ $match: { salary_outlier_flag: false } }]
})

db.jobs_clean.countDocuments()

// Contrôle final : les champs calculés sont bien présents dans la vue.
db.jobs_clean.findOne({}, { salaire_mensuel_usd: 1, cross_border: 1, salary_band: 1 })
