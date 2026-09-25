#!/usr/bin/env python3
# =====================================================================
# Analyse du marché des emplois en données et en IA
# Source : data/raw/ai_jobs_salaries_clean.csv (71 913 lignes)
# Produit : reports/analyse-ai-jobs-salaries.xlsx (5 onglets)
#
# Ce script reproduit, hors MongoDB, les agrégations documentées dans
# queries/02_agregations.js. Il sert de contrôle croisé : les chiffres
# produits ici doivent être identiques à ceux obtenus dans Navicat.
#
# Dépendances : pandas, openpyxl  (pip install -r requirements.txt)
# =====================================================================

from pathlib import Path
import pandas as pd

# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------
RACINE = Path(__file__).resolve().parent.parent
SOURCE = RACINE / "data" / "raw" / "ai_jobs_salaries_clean.csv"
SORTIE = RACINE / "reports" / "analyse-ai-jobs-salaries.xlsx"

NIVEAUX = {
    "EX": "Executive-level",
    "SE": "Senior-level",
    "MI": "Mid-level",
    "EN": "Entry-level",
}

FAMILLES_PHARES = ["Data Scientist", "Data Engineer", "Data Analyst"]


# ---------------------------------------------------------------------
# 1. EXTRACT — lecture du CSV
# ---------------------------------------------------------------------
def charger() -> pd.DataFrame:
    """Charge le CSV et force les types des colonnes numériques."""
    df = pd.read_csv(SOURCE)

    for colonne in ["salary", "salary_in_usd", "work_year", "remote_ratio"]:
        df[colonne] = pd.to_numeric(df[colonne], errors="coerce")

    # salary_outlier_flag arrive en texte depuis le CSV
    df["outlier"] = df["salary_outlier_flag"].astype(str).str.lower() == "true"

    print(f"[Extract] {len(df):,} lignes lues · {df.shape[1]} colonnes")
    return df


# ---------------------------------------------------------------------
# 2. TRANSFORM — nettoyage et enrichissement (miroir de queries/01_nettoyage.js)
# ---------------------------------------------------------------------
def transformer(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Sépare les outliers et ajoute les champs calculés."""
    outliers = df[df["outlier"]].copy()
    propre = df[~df["outlier"]].copy()

    propre["salaire_mensuel_usd"] = (propre["salary_in_usd"] / 12).round(0).astype(int)
    propre["cross_border"] = propre["employee_residence"] != propre["company_location"]

    print(f"[Transform] {len(propre):,} documents retenus · {len(outliers):,} outliers isolés")
    print(f"            moyenne outliers : {outliers['salary_in_usd'].mean():,.0f} $")
    print(f"            moyenne propre   : {propre['salary_in_usd'].mean():,.0f} $")
    return propre, outliers


# ---------------------------------------------------------------------
# 3. AGRÉGATIONS
# ---------------------------------------------------------------------
def stats(groupe: pd.Series) -> dict:
    """Résumé statistique d'une série de salaires."""
    return {
        "moyenne": round(groupe.mean()),
        "mediane": round(groupe.median()),
        "q1": round(groupe.quantile(0.25)),
        "q3": round(groupe.quantile(0.75)),
        "min": round(groupe.min()),
        "max": round(groupe.max()),
        "n": len(groupe),
    }


def par_niveau(df: pd.DataFrame) -> pd.DataFrame:
    """Équivalent de queries/02_agregations.js § 2.2."""
    lignes = []
    for code, label in NIVEAUX.items():
        salaires = df[df["experience_level"] == code]["salary_in_usd"]
        if len(salaires):
            lignes.append({"niveau": label, **stats(salaires)})
    return pd.DataFrame(lignes).sort_values("moyenne", ascending=False)


def par_metier(df: pd.DataFrame) -> pd.DataFrame:
    """Équivalent de queries/02_agregations.js § 2.5."""
    df = df[df["role_family"] != "Other / Unclassified"]
    lignes = [
        {"famille": famille, **stats(groupe["salary_in_usd"]),
         "part_pct": round(100 * len(groupe) / len(df), 1)}
        for famille, groupe in df.groupby("role_family")
    ]
    return pd.DataFrame(lignes).sort_values("moyenne", ascending=False)


def par_mode(df: pd.DataFrame) -> pd.DataFrame:
    """Équivalent de queries/02_agregations.js § 2.7."""
    lignes = [
        {"mode": mode, **stats(groupe["salary_in_usd"])}
        for mode, groupe in df.groupby("work_mode")
    ]
    return pd.DataFrame(lignes).sort_values("moyenne", ascending=False)


def par_annee(df: pd.DataFrame) -> pd.DataFrame:
    """Équivalent de queries/02_agregations.js § 2.4."""
    lignes = [
        {"annee": int(annee), **stats(groupe["salary_in_usd"])}
        for annee, groupe in df.groupby("work_year")
    ]
    return pd.DataFrame(lignes).sort_values("annee")


def croise(df: pd.DataFrame) -> pd.DataFrame:
    """Équivalent de queries/02_agregations.js § 2.6 — cellules d'au moins 20 offres."""
    lignes = []
    for famille in FAMILLES_PHARES:
        for code, label in NIVEAUX.items():
            sous = df[(df["role_family"] == famille) & (df["experience_level"] == code)]
            if len(sous) >= 20:
                lignes.append({"famille": famille, "niveau": label, **stats(sous["salary_in_usd"])})
    return pd.DataFrame(lignes).sort_values(["famille", "moyenne"], ascending=[True, False])


# ---------------------------------------------------------------------
# 4. LOAD — écriture du classeur
# ---------------------------------------------------------------------
def ecrire(feuilles: dict) -> None:
    """Écrit chaque DataFrame dans un onglet du classeur."""
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(SORTIE, engine="openpyxl") as writer:
        for nom, df in feuilles.items():
            df.to_excel(writer, sheet_name=nom, index=False)
            feuille = writer.sheets[nom]
            for i, colonne in enumerate(df.columns, start=1):
                largeur = max(len(str(colonne)) + 2, df[colonne].astype(str).str.len().max() + 2)
                feuille.column_dimensions[feuille.cell(row=1, column=i).column_letter].width = min(largeur, 24)
    print(f"[Load] {SORTIE.name} écrit · {len(feuilles)} onglets")


# ---------------------------------------------------------------------
# 5. Point d'entrée
# ---------------------------------------------------------------------
def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(
            f"Fichier source introuvable : {SOURCE}\n"
            "Placer ai_jobs_salaries_clean.csv dans data/raw/ avant de relancer."
        )

    df = charger()
    propre, outliers = transformer(df)

    feuilles = {
        "Par expérience": par_niveau(propre),
        "Par métier": par_metier(propre),
        "Par mode de travail": par_mode(propre),
        "Par année": par_annee(propre),
        "Croisé métier expérience": croise(propre),
    }
    ecrire(feuilles)

    print("\n=== Contrôle : salaire moyen par niveau ===")
    print(feuilles["Par expérience"].to_string(index=False))


if __name__ == "__main__":
    main()
