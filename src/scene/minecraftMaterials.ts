/**
 * Material metadata used by the Minecraft export pipeline.
 *
 * The web renderer still only needs the colour/PBR fields.  The optional role
 * is deliberately kept beside the colour so the same procedural geometry can
 * be exported with semantic Minecraft blocks later, without changing the
 * viewer appearance.
 */
export type MinecraftMaterialRole =
  | 'unknown'
  | 'wall'
  | 'glass'
  | 'metal'
  | 'roof'
  | 'wood'
  | 'stone'
  | 'road'
  | 'paving'
  | 'shore'
  | 'water'
  | 'grass'
  | 'soil'
  | 'tree_trunk'
  | 'tree_leaf'
  | 'sport_surface'
  | 'sport_line'
  | 'tile'
  | 'rail'
  | 'light';

export type MinecraftMaterial = {
  color: string;
  role: MinecraftMaterialRole;
};

export type MaterialInput = string | MinecraftMaterial;

const roleByColor = new Map<string, MinecraftMaterialRole>();

/** Register a legacy colour literal with a semantic role while preserving the
 * old string API used by small geometry helpers. First registration wins so a
 * shared accent colour remains deterministic. */
export function mcColor(role: MinecraftMaterialRole, color: string): string {
  const key = color.toLowerCase();
  if (!roleByColor.has(key)) roleByColor.set(key, role);
  return color;
}

export function mcMaterial(role: MinecraftMaterialRole, color: string): MinecraftMaterial {
  return {color, role};
}

export function materialColor(input: MaterialInput): string {
  return typeof input === 'string' ? input : input.color;
}

export function materialRole(input: MaterialInput): MinecraftMaterialRole {
  return typeof input === 'string' ? (roleByColor.get(input.toLowerCase()) ?? 'unknown') : input.role;
}
