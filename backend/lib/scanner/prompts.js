/**
 * Prompts Scanner Intelligent — multi-cartes, défauts visibles, grade.
 */
import { normalizeLicense } from "../ai/prompts.js";

export function buildScannerPrompt(data, trainingExamples) {
  const examples = (trainingExamples || []).slice(0, 6).map((ex, i) => {
    const det = ex.detection || ex;
    return `Exemple ${i + 1} : ${JSON.stringify(det)}`;
  }).join("\n");

  const sides = [];
  if (data.rectoBase64) sides.push("recto");
  if (data.versoBase64) sides.push("verso");
  (data.extraImages || []).forEach((_, i) => sides.push("photo_" + (i + 1)));

  return `Tu es le Scanner Intelligent Cardoria (mobile) pour cartes TCG.
Analyse les photos (${sides.join(", ") || "fournies"}) et identifie chaque carte visible.
Licences : Pokémon, Yu-Gi-Oh!, One Piece, Lorcana, Magic, Dragon Ball Super, Star Wars Unlimited, Sports.

Client : ${data.customerName || "Anonyme"} / ${data.customerEmail || "—"}
Indice jeu : ${data.cardGame || "—"}
Indice nom : ${data.cardName || "—"}

${examples ? "Références validées :\n" + examples + "\n" : ""}

MESSAGE CLIENT (naturel, sans score d'authenticité, sans prix de rachat/marge) :
- Carte(s) identifiée(s), état visible, défauts visibles
- Estimation prudente si plusieurs cartes sur la photo

À la fin, bloc JSON EXACT :

---CARDORIA_SCANNER_JSON---
{
  "detection": {
    "license": "pokemon|yugioh|onepiece|lorcana|magic|dragonball|starwars|sports|autre",
    "name": "",
    "extension": "",
    "number": "",
    "rarity": "",
    "language": "FR|EN|JP|...",
    "version": ""
  },
  "condition": "Mint|Near Mint|Excellent|Good|Played|Poor",
  "probableGrade": "Mint|NM|EX|GD|Played|Poor",
  "visibleDefects": ["liste des défauts visibles"],
  "SCORE_CONFIANCE": 0,
  "additionalCards": [
    { "name": "", "extension": "", "number": "", "license": "", "rarity": "" }
  ],
  "recognitionConfidence": "high|medium|low"
}

SCORE_CONFIANCE = authenticité visible 0-100 (ADMIN UNIQUEMENT). additionalCards = autres cartes visibles sur la même photo (tableau vide si une seule).`;
}

export function parseScannerResponse(rawText) {
  const text = String(rawText || "");
  let clientMessage = text;
  let detection = {};
  let condition = "Near Mint";
  let confidenceScore = null;
  let visibleDefects = [];
  let probableGrade = null;
  let additionalCards = [];
  let recognitionConfidence = "medium";

  const jsonMatch = text.match(/---CARDORIA_SCANNER_JSON---\s*([\s\S]*?)(?:$|\n---)/) ||
    text.match(/---CARDORIA_SCANNER_JSON---\s*(\{[\s\S]*\})/) ||
    text.match(/---CARDORIA_JSON---\s*([\s\S]*?)(?:$|\n---)/);

  if (jsonMatch) {
    const marker = text.indexOf("---CARDORIA_SCANNER_JSON---") >= 0
      ? "---CARDORIA_SCANNER_JSON---"
      : "---CARDORIA_JSON---";
    clientMessage = text.slice(0, text.indexOf(marker)).trim();
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      detection = parsed.detection || {};
      condition = parsed.condition || condition;
      probableGrade = parsed.probableGrade || null;
      visibleDefects = Array.isArray(parsed.visibleDefects) ? parsed.visibleDefects : [];
      additionalCards = Array.isArray(parsed.additionalCards) ? parsed.additionalCards : [];
      recognitionConfidence = parsed.recognitionConfidence || "medium";
      if (parsed.SCORE_CONFIANCE != null) confidenceScore = Number(parsed.SCORE_CONFIANCE);
    } catch { /* fallback parse below */ }
  }

  if (confidenceScore == null) {
    const m = text.match(/SCORE_CONFIANCE\s*:\s*(\d{1,3})/i);
    if (m) confidenceScore = Math.max(0, Math.min(100, Number(m[1])));
  }

  detection.license = normalizeLicense(detection.license);

  clientMessage = clientMessage
    .replace(/---CARDORIA_SCANNER_JSON---[\s\S]*/gi, "")
    .replace(/---CARDORIA_JSON---[\s\S]*/gi, "")
    .replace(/SCORE_CONFIANCE\s*:\s*\d+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    clientMessage,
    detection,
    condition,
    confidenceScore,
    visibleDefects,
    probableGrade,
    additionalCards,
    recognitionConfidence,
    rawResponse: text
  };
}
