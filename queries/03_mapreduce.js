// =====================================================================
// PHASE 3 — MAPREDUCE ET ÉQUIVALENTS EN PIPELINE
//
// mapReduce est DÉPRÉCIÉ depuis MongoDB 4.4 et SUPPRIMÉ depuis 5.0.
// Si "Unrecognized command: mapReduce" s'affiche, utiliser la section 3.3.
//
// Structure du paradigme :
//   MAP      : émet une paire (clé, valeur) par document, indépendamment
//   SHUFFLE  : regroupe les paires par clé (fait par le moteur)
//   REDUCE   : agrège les valeurs d'une même clé
//   FINALIZE : dernière passe, calcule la moyenne à partir des sommes
// =====================================================================

// ---------------------------------------------------------------------
// 3.1 — SALAIRE MOYEN PAR FAMILLE DE MÉTIERS
// Règle capitale : le reduce renvoie des SOMMES, jamais une moyenne.
// MongoDB peut l'appeler plusieurs fois sur une même clé (re-reduce) ;
// une moyenne de moyennes serait fausse. C'est le finalize qui divise.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.mapReduce(
  // MAP : une paire par document. On ignore les extrêmes et la famille fourre-tout.
  function () {
    if (this.salary_outlier_flag === true) return;
    if (this.role_family === "Other / Unclassified") return;
    emit(this.role_family, { somme: this.salary_in_usd, nb: 1 });
  },

  // REDUCE : reçoit la clé et TOUTES les valeurs émises pour elle.
  // La fonction doit être additive : on additionne sommes et compteurs.
  function (cle, valeurs) {
    let somme = 0, nb = 0;
    for (const v of valeurs) { somme += v.somme; nb += v.nb; }
    return { somme: somme, nb: nb };
  },

  {
    // FINALIZE : une seule passe, après le reduce, pour produire la moyenne.
    finalize: function (cle, r) { r.moyenne_usd = Math.round(r.somme / r.nb); return r; },
    // OUT : collection de sortie. Sans cette option, la sortie est inline
    // et plafonnée à 16 Mo.
    out: "mr_moyenne_par_famille",
    // QUERY : filtre appliqué AVANT le map, pour limiter le volume traité.
    query: { salary_outlier_flag: false }
  }
)

// Lecture du résultat. Le _id contient la clé émise (la famille de métiers),
// et la valeur est un sous-document {somme, nb, moyenne_usd}.
db.mr_moyenne_par_famille.find().sort({ "value.moyenne_usd": -1 })
db.mr_moyenne_par_famille.countDocuments()

// ---------------------------------------------------------------------
// 3.2 — TABLEAU CROISÉ MODE DE TRAVAIL × NIVEAU D'EXPÉRIENCE
// Clé composée par concaténation, pour obtenir une clé par combinaison.
// min et max sont transportés dans le document émis, puis agrégés.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.mapReduce(
  function () {
    if (this.salary_outlier_flag === true) return;
    emit(this.work_mode + " / " + this.experience_level_label,
         { somme: this.salary_in_usd, nb: 1, min: this.salary_in_usd, max: this.salary_in_usd });
  },
  function (cle, valeurs) {
    let somme = 0, nb = 0, min = Infinity, max = -Infinity;
    for (const v of valeurs) {
      somme += v.somme; nb += v.nb;
      if (v.min < min) min = v.min;
      if (v.max > max) max = v.max;
    }
    return { somme: somme, nb: nb, min: min, max: max };
  },
  {
    finalize: function (cle, r) { r.moyenne_usd = Math.round(r.somme / r.nb); return r; },
    out: "mr_mode_par_niveau",
    query: { salary_outlier_flag: false }
  }
)

db.mr_mode_par_niveau.find().sort({ "value.moyenne_usd": -1 })

// ---------------------------------------------------------------------
// 3.3 — ÉQUIVALENTS EN PIPELINE D'AGRÉGATION
// Correspondance terme à terme :
//   emit(clé, valeur)  ->  $group avec _id: "$champ"
//   fonction reduce    ->  accumulateurs $sum, $min, $max
//   fonction finalize  ->  $project après le $group
//   option query       ->  $match en tête de pipeline
//   option out         ->  $out ou $merge en fin de pipeline
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.aggregate([
  { $match: { salary_outlier_flag: false, role_family: { $ne: "Other / Unclassified" } } },
  { $group: {
      _id: "$role_family",
      somme: { $sum: "$salary_in_usd" },
      nb: { $sum: 1 },
      min: { $min: "$salary_in_usd" },
      max: { $max: "$salary_in_usd" }
  }},
  { $project: { _id: 0, role_family: "$_id",
                moyenne_usd: { $round: [{ $divide: ["$somme", "$nb"] }, 0] },
                min: 1, max: 1, nb: 1 } },
  { $sort: { moyenne_usd: -1 } }
])

// Même équivalence pour le tableau croisé.
db.ai_jobs_salaries_clean.aggregate([
  { $match: { salary_outlier_flag: false } },
  { $group: { _id: { mode: "$work_mode", exp: "$experience_level_label" },
              moyenne_usd: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              min: { $min: "$salary_in_usd" },
              max: { $max: "$salary_in_usd" },
              nb: { $sum: 1 } }},
  { $project: { _id: 0, mode: "$_id.mode", niveau: "$_id.exp", moyenne_usd: 1, min: 1, max: 1, nb: 1 } },
  { $sort: { moyenne_usd: -1 } }
])

// ---------------------------------------------------------------------
// 3.4 — LA LIMITE STRUCTURELLE DU MAPREDUCE
// La médiane n'est PAS décomposable en résultats partiels : elle ne peut
// pas s'exprimer avec un reduce associatif. Seul le pipeline la fournit.
// Sur les mêmes données, les deux méthodes donnent des moyennes identiques
// au dollar près, mais seule celle-ci sait produire la médiane.
// ---------------------------------------------------------------------
db.ai_jobs_salaries_clean.aggregate([
  { $match: { salary_outlier_flag: false, role_family: { $ne: "Other / Unclassified" } } },
  { $group: { _id: "$role_family",
              moyenne: { $round: [{ $avg: "$salary_in_usd" }, 0] },
              mediane: { $median: { input: "$salary_in_usd", method: "approximate" } },
              n: { $sum: 1 } }},
  { $sort: { moyenne: -1 } }
])

// ---------------------------------------------------------------------
// 3.5 — BENCHMARK
// Relancer les deux requêtes ci-dessus et comparer le "Elapsed Time"
// de l'onglet Message dans Navicat. Le pipeline s'exécute en code natif,
// le MapReduce passe par un interpréteur JavaScript : l'écart se compte
// en dizaines de millisecondes contre plusieurs secondes.
// ---------------------------------------------------------------------
