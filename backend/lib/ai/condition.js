/**
 * Grades d'état Cardoria — normalisation IA → standard.
 */
export const CONDITION_GRADES = [
  { key: "mint", label: "Mint", aliases: ["mint", "mt", "gem mint", "gem"] },
  { key: "near_mint", label: "Near Mint", aliases: ["near mint", "near-mint", "nm", "presque mint"] },
  { key: "excellent", label: "Excellent", aliases: ["excellent", "ex", "excellent condition"] },
  { key: "good", label: "Good", aliases: ["good", "gd", "bon", "bon état"] },
  { key: "played", label: "Played", aliases: ["played", "lp", "mp", "light played", "moderate played", "light played", "used", "jouée"] },
  { key: "poor", label: "Poor", aliases: ["poor", "hp", "damaged", "dmg", "mauvais", "abîmée", "heavily played"] }
];

export function normalizeCondition(raw) {
  const s = String(raw || "").toLowerCase().trim();
  for (const g of CONDITION_GRADES) {
    if (g.aliases.some((a) => s === a || s.includes(a))) return { key: g.key, label: g.label };
  }
  return { key: "near_mint", label: "Near Mint" };
}

export function conditionToEngineKey(gradeKey) {
  const map = { mint: "mint", near_mint: "nm", excellent: "ex", good: "gd", played: "lp", poor: "hp" };
  return map[gradeKey] || "nm";
}
