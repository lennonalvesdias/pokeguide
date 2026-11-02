#!/usr/bin/env bash
# Baixa somente os arquivos do decomp pret/pokefirered usados pelo pipeline,
# num commit fixado para que o dataset seja reproduzível.
set -euo pipefail

COMMIT="ce6406d8c2eaf46d543c8a2606de0c3cb1951982"
DEST="${1:-.decomp}"

if [ ! -d "$DEST/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/pret/pokefirered.git "$DEST"
fi

cd "$DEST"
git sparse-checkout init --no-cone
git sparse-checkout set \
  /include/constants/species.h \
  /include/constants/moves.h \
  /include/constants/items.h \
  /include/constants/abilities.h \
  /include/constants/pokemon.h \
  /src/data/text/species_names.h \
  /src/data/text/move_names.h \
  /src/data/text/abilities.h \
  /src/data/items.json \
  /src/data/battle_moves.h \
  /src/data/pokemon/species_info.h \
  /src/data/pokemon/level_up_learnsets.h \
  /src/data/pokemon/level_up_learnset_pointers.h \
  /src/battle_main.c \
  /src/pokemon.c \
  /src/data/party_menu.h \
  /src/data/pokemon/tmhm_learnsets.h \
  /src/data/trainers.h \
  /include/constants/opponents.h \
  /include/constants/flags.h \
  /src/data/trainer_parties.h \
  /src/data/text/trainer_class_names.h \
  '/data/maps/*/scripts.inc' \
  '/data/maps/*/map.json' \
  /data/scripts/trainers.inc \
  /data/maps/map_groups.json \
  /include/constants/pokedex.h \
  /src/data/wild_encounters.json \
  /src/data/pokemon/experience_tables.h \
  /data/scripts/pokemon_mansion.inc \
  /data/scripts/item_ball_scripts.inc \
  /data/layouts/layouts.json \
  '/data/layouts/PokemonMansion_*/map.bin' \
  /data/tilesets/primary/building/metatile_attributes.bin \
  /data/tilesets/secondary/pokemon_mansion/metatile_attributes.bin \
  /include/constants/metatile_behaviors.h \
  /include/constants/metatile_labels.h \
  /include/fieldmap.h
git fetch --depth 1 origin "$COMMIT"
git checkout --quiet "$COMMIT"
echo "decomp pronto em $DEST @ $COMMIT"
