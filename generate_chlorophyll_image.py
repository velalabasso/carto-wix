#!/usr/bin/env python3
"""
Génère une image PNG de chlorophylle de surface à partir de Copernicus
Marine Service (produit OCEANCOLOUR_GLO_BGC_L4_NRT_009_102, dataset
"cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D", variable CHL).

Ce produit est du "L4 gap-free" : interpolé spatio-temporellement par
Copernicus pour combler les trous dus aux nuages — contrairement au L2 de
la NASA GIBS, qui est un passage satellite brut.

Sortie :
  chlorophyll/chlorophyll_latest.png   - image RGBA, fond transparent
  chlorophyll/chlorophyll_latest.json  - bornes géographiques réelles de
                                          l'image (west/east/south/north),
                                          utilisées par vela-carto.js pour
                                          positionner l'image sur la carte.

Authentification Copernicus Marine via variables d'environnement
(définies comme GitHub Secrets dans le workflow, jamais committées) :
  COPERNICUSMARINE_SERVICE_USERNAME
  COPERNICUSMARINE_SERVICE_PASSWORD
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

import copernicusmarine

# =========================================================
# CONFIG — à ajuster selon la zone de navigation de ZOPA
# =========================================================

DATASET_ID = "cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D"
VARIABLE   = "CHL"

# Zone géographique couverte par l'image (Méditerranée -> traversée
# Atlantique -> Caraïbes, cohérent avec le tracé pointillé annexe de la
# carte). À élargir/rétrécir si besoin — impacte la taille du fichier PNG.
MIN_LON, MAX_LON = -75.0, 20.0
MIN_LAT, MAX_LAT = -5.0, 50.0

# Échelle de couleur (mg/m3), log car la concentration varie sur plusieurs
# ordres de grandeur entre eaux oligotrophes et zones côtières riches.
VMIN, VMAX = 0.01, 10.0

OUTPUT_DIR  = "chlorophyll"
OUTPUT_PNG  = os.path.join(OUTPUT_DIR, "chlorophyll_latest.png")
OUTPUT_META = os.path.join(OUTPUT_DIR, "chlorophyll_latest.json")
TMP_NC      = "chl_subset.nc"


def main():
    username = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME")
    password = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
    if not username or not password:
        print("ERREUR : identifiants Copernicus Marine manquants "
              "(variables d'environnement COPERNICUSMARINE_SERVICE_USERNAME / "
              "COPERNICUSMARINE_SERVICE_PASSWORD).")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    now = datetime.now(timezone.utc)
    # Fenêtre de quelques jours en arrière : le produit NRT a parfois un
    # léger délai de publication, on prend le dernier pas de temps
    # réellement disponible dans cette fenêtre plutôt que de viser "hier"
    # à l'aveugle.
    start = now - timedelta(days=5)

    print(f"Téléchargement Copernicus Marine : {DATASET_ID} / {VARIABLE}")
    print(f"  Fenêtre temporelle : {start.date()} -> {now.date()}")
    print(f"  Zone : lon [{MIN_LON}, {MAX_LON}]  lat [{MIN_LAT}, {MAX_LAT}]")

    if os.path.exists(TMP_NC):
        os.remove(TMP_NC)

    copernicusmarine.subset(
        dataset_id=DATASET_ID,
        variables=[VARIABLE],
        minimum_longitude=MIN_LON,
        maximum_longitude=MAX_LON,
        minimum_latitude=MIN_LAT,
        maximum_latitude=MAX_LAT,
        start_datetime=start.strftime("%Y-%m-%dT00:00:00"),
        end_datetime=now.strftime("%Y-%m-%dT23:59:59"),
        output_filename=TMP_NC,
        output_directory=".",
        username=username,
        password=password,
        overwrite=True,
    )

    if not os.path.exists(TMP_NC):
        print("ERREUR : le fichier NetCDF n'a pas été téléchargé.")
        sys.exit(1)

    ds = xr.open_dataset(TMP_NC)

    if "time" not in ds[VARIABLE].dims or ds.sizes.get("time", 0) == 0:
        print("ERREUR : aucun pas de temps disponible dans la fenêtre demandée.")
        sys.exit(1)

    # Dernier pas de temps disponible = donnée la plus récente publiée
    da = ds[VARIABLE].isel(time=-1)
    used_time = str(ds["time"].isel(time=-1).values)
    print(f"  Pas de temps utilisé : {used_time}")

    lat_name = "latitude" if "latitude" in da.coords else "lat"
    lon_name = "longitude" if "longitude" in da.coords else "lon"
    lats = da[lat_name].values
    lons = da[lon_name].values
    data = np.asarray(da.values, dtype="float64")

    # Écrase les valeurs <= 0 (invalides pour une échelle log) en NaN
    data = np.where(data > 0, data, np.nan)

    norm = mcolors.LogNorm(vmin=VMIN, vmax=VMAX, clip=True)
    cmap = plt.get_cmap("viridis").copy()
    cmap.set_bad(alpha=0)  # NaN (terre, pas de donnée) -> transparent

    lat_ascending = lats[0] < lats[-1]

    height_px = data.shape[0]
    width_px  = data.shape[1]
    dpi = 100
    fig = plt.figure(figsize=(width_px / dpi, height_px / dpi), dpi=dpi)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    ax.imshow(
        data, cmap=cmap, norm=norm,
        origin="lower" if lat_ascending else "upper",
        aspect="auto",
    )
    fig.patch.set_alpha(0)
    fig.savefig(OUTPUT_PNG, transparent=True, dpi=dpi)
    plt.close(fig)

    meta = {
        "west": float(lons.min()),
        "east": float(lons.max()),
        "south": float(lats.min()),
        "north": float(lats.max()),
        "generated_at": now.isoformat(),
        "data_time": used_time,
        "dataset_id": DATASET_ID,
    }
    with open(OUTPUT_META, "w") as f:
        json.dump(meta, f, indent=2)

    ds.close()
    if os.path.exists(TMP_NC):
        os.remove(TMP_NC)

    print("OK :", OUTPUT_PNG)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
