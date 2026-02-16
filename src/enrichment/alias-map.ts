import { parse } from "yaml";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Bidirectional map: display name → OpenRouter ID and OpenRouter ID → display names
let nameToId = new Map<string, string>();
let idToNames = new Map<string, string[]>();

/** Load aliases from YAML file */
export function loadAliases(): void {
  const aliasPath = join(import.meta.dir, "../data/aliases.yaml");

  if (!existsSync(aliasPath)) {
    console.warn("[alias-map] aliases.yaml not found, using empty map");
    return;
  }

  const raw = readFileSync(aliasPath, "utf-8");
  const parsed = parse(raw) as Record<string, string[]> | null;

  if (!parsed) return;

  nameToId = new Map();
  idToNames = new Map();

  for (const [openrouterId, names] of Object.entries(parsed)) {
    if (!Array.isArray(names)) continue;

    idToNames.set(openrouterId, names);

    for (const name of names) {
      // Store lowercase for case-insensitive matching
      nameToId.set(name.toLowerCase(), openrouterId);
    }
  }

  console.log(
    `[alias-map] Loaded ${idToNames.size} model aliases (${nameToId.size} name entries)`
  );
}

/** Resolve a display name to an OpenRouter ID. Case-insensitive. */
export function resolveAlias(name: string): string | null {
  return nameToId.get(name.toLowerCase()) ?? null;
}

/** Get all known names for an OpenRouter ID */
export function getNamesForId(openrouterId: string): string[] {
  return idToNames.get(openrouterId) ?? [];
}

/** Check if we have an alias for this name */
export function hasAlias(name: string): boolean {
  return nameToId.has(name.toLowerCase());
}

/** Get the full map for debugging */
export function getAliasStats() {
  return {
    modelCount: idToNames.size,
    nameCount: nameToId.size,
  };
}

// Load on module init
loadAliases();
