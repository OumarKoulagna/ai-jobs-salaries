// =====================================================================
// BENCHMARK — MapReduce contre pipeline d'agrégation
//
// Objectif : mesurer, sur le même indicateur et les mêmes données,
// l'écart de performance entre les deux mécanismes de MongoDB.
//
// Mode opératoire :
//   1. Lancer la requête 1 (MapReduce), puis lire le "Query Time"
//      dans l'onglet Message de Navicat. Relever la valeur.
//   2. Lancer la requête 2 (pipeline), relever le "Query Time".
//   3. Calculer le ratio : temps MapReduce / temps pipeline.
//   4. Lancer la requête 3 pour vérifier que les résultats sont identiques.
//
// Résultats obtenus sur 71 913 documents : voir le README, section 7.7.
// =====================================================================

// ---------------------------------------------------------------------
// REQUÊTE 1 — VERSION MAPREDUCE (JavaScript interprété)
// Le moteur exécute les fonctions map et reduce dans un interpréteur JS,
// et matérialise les paires intermédiaires dans une collection.
// out: { replace: ... } évite d'écraser mr_moyenne_par_famille.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.mapReduce(
  function () {
    if (this.salary_outlier_flag === true) return;
    if (this.role_family === "Other / Unclassified") return;
    emit(this.role_family, { somme: this.salary_in_usd, nb: 1 });
  },
  function (cle, valeurs) {
    let somme = 0, nb = 0;
    for (const v of valeurs) { somme += v.somme; nb += v.nb; }
    return { somme: somme, nb: nb };
  },
  {
    finalize: function (cle, r) { r.moyenne_usd = Math.round(r.somme / r.nb); return r; },
    out: { replace: "mr_benchmark" },
    query: { salary_outlier_flag: false }
  }
)

// ---------------------------------------------------------------------
// REQUÊTE 2 — VERSION PIPELINE D'AGRÉGATION (code natif)
// S'exécute entièrement dans le moteur C++, sans interpréteur ni écriture
// intermédiaire. C'est la raison de l'écart de temps.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.aggregate([
  { $match: { salary_outlier_flag: false, role_family: { $ne: "Other / Unclassified" } } },
  { $group: { _id: "$role_family",
              somme: { $sum: "$salary_in_usd" },
              nb: { $sum: 1 } }},
  { $project: { _id: 0, role_family: "$_id",
                moyenne_usd: { $round: [{ $divide: ["$somme", "$nb"] }, 0] } } },
  { $sort: { moyenne_usd: -1 } }
])

// ---------------------------------------------------------------------
// REQUÊTE 3 — CONTRÔLE D'ÉGALITÉ DES RÉSULTATS
// Les deux méthodes doivent produire exactement les mêmes moyennes,
// à l'unité près. Toute divergence signalerait une erreur dans le reduce
// (typiquement une moyenne de moyennes, fausse en cas de re-reduce).
// ---------------------------------------------------------------------
db.mr_benchmark.find().sort({ "value.moyenne_usd": -1 })
