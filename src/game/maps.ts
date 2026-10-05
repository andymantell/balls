/**
 * Levels shipped with v1.02. The SINGLE MAP list is the maps directory in
 * FindFirstFile order (alphabetical); START GAME plays the twelve campaign
 * levels in the order hard-coded at 0x423380.. ("maps/lazer maze", ...).
 */
export const MAPS = [
  'bounce', 'cannon', 'castle', 'castlecoaster', 'chase', 'city', 'disco', 'jump',
  'killer', 'lazer_maze', 'loops', 'nightmare', 'ollin', 'rollercoaster', 'trapped',
];

export const CAMPAIGN = [
  'lazer_maze', 'chase', 'bounce', 'disco', 'loops', 'rollercoaster',
  'city', 'castle', 'cannon', 'jump', 'killer', 'nightmare',
];

/** Name as the menus print it (the original file name, upper-cased by the font). */
export function displayName(slug: string): string {
  return slug.replace(/_/g, ' ').toUpperCase();
}

/** "s,th" exactly like the HUD (seconds, then tenths and hundredths). */
export function formatTime(ms: number): string {
  ms = Math.max(0, Math.trunc(ms));
  const s = Math.trunc(ms / 1000);
  const th = Math.trunc((ms % 1000) / 10);
  return `${s},${th < 10 ? '0' : ''}${th}`;
}
