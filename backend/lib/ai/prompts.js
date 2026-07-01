/**
 * Prompts IA Premium — sortie structurée JSON + message client.
 */
import { getTrainingExamples } from "./training.js";

const LICENSES = ["pokemon", "yugioh", "onepiece", "lorcana", "magic", "dragonball", "starwars", "sports", "disney", "autre"];

export function buildPremiumPrompt(data, trainingExamples) {
  const examples = (trainingExamples || []).slice(0, 8).map((ex, i) => {
    const det = ex.detection || ex;
    const cond = ex.condition?.validated || ex.condition?.estimated || ex.condition || "";
    const priceHint = ex.prices?.resell || ex.prices?.avg ? ` | Prix ref. ~${ex.prices.resell || ex.prices.avg}€` : "";
    return `Exemple validé admin ${i + 1} (${ex.license || det.license}${ex.extension ? " / " + ex.extension : ""}) : ${JSON.stringify(det)}${cond ? " | État : " + cond : ""}${priceHint}`;
  }).join("\n");

  return `Tu es le système d'analyse premium Cardoria pour cartes TCG (Pokémon, Yu-Gi-Oh!, One Piece, Lorcana, Magic, Dragon Ball Super, Star Wars Unlimited, Sports et futures licences).

Analyse les photos et les informations client. Réponds en français pour le message client.
Ne certifie JAMAIS officiellement une carte. Analyse uniquement ce qui est visible.

Client : ${data.customerName || "Non renseigné"} / ${data.customerEmail || "Non renseigné"}
Jeu indiqué : ${data.cardGame || "Non renseigné"}
Carte indiquée : ${data.cardName || "Non renseigné"}
Notes : ${data.cardNotes || "Aucune"}

${examples ? "Références admin validées :\n" + examples + "\n" : ""}

MESSAGE CLIENT (texte naturel, sans score d'authenticité, sans SCORE_CONFIANCE visible) :
- Identification probable de la carte
- État visible (Mint / Near Mint / Excellent / Good / Played / Poor)
- Défauts visibles, points à vérifier
- Recommandation Cardoria prudente

À la fin de ta réponse, sur des lignes séparées, ajoute EXACTEMENT :

---CARDORIA_JSON---
{
  "detection": {
    "license": "${LICENSES.join("|")}",
    "name": "nom de la carte",
    "extension": "nom extension/set",
    "number": "numéro",
    "rarity": "rareté",
    "language": "FR|EN|JP|...",
    "version": "1st Edition|Unlimited|Reverse|Alt Art|..."
  },
  "condition": "Mint|Near Mint|Excellent|Good|Played|Poor",
  "SCORE_CONFIANCE": 0
}

Remplace les valeurs par ton analyse. SCORE_CONFIANCE = entier 0-100 (authenticité visible, ADMIN UNIQUEMENT — ne jamais le mentionner dans le message client).`;
}

export function parseAiResponse(rawText) {
  const text = String(rawText || "");
  let clientMessage = text;
  let detection = {};
  let condition = "Near Mint";
  let confidenceScore = null;

  const jsonMatch = text.match(/---CARDORIA_JSON---\s*([\s\S]*?)(?:$|\n---)/) ||
    text.match(/---CARDORIA_JSON---\s*(\{[\s\S]*\})/);

  if (jsonMatch) {
    clientMessage = text.slice(0, text.indexOf("---CARDORIA_JSON---")).trim();
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      detection = parsed.detection || {};
      condition = parsed.condition || condition;
      if (parsed.SCORE_CONFIANCE != null) confidenceScore = Number(parsed.SCORE_CONFIANCE);
    } catch { /* fallback below */ }
  }

  if (confidenceScore == null) {
    const m = text.match(/SCORE_CONFIANCE\s*:\s*(\d{1,3})/i);
    if (m) confidenceScore = Math.max(0, Math.min(100, Number(m[1])));
  }

  clientMessage = stripInternalFromClient(clientMessage);

  return { clientMessage, detection, condition, confidenceScore, rawResponse: text };
}

export function stripInternalFromClient(text) {
  return String(text || "")
    .replace(/---CARDORIA_JSON---[\s\S]*/gi, "")
    .replace(/SCORE_CONFIANCE\s*:\s*\d+/gi, "")
    .replace(/score d['']authenticit[eé][^\n]*/gi, "")
    .replace(/(?:niveau|indice|taux)\s+(?:de\s+)?confiance[^\n]*/gi, "")
    .replace(/confiance\s*(?:d['']authenticit[eé])?\s*[:\-]?\s*\d+\s*%/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeLicense(raw) {
  const s = String(raw || "").toLowerCase();
  const map = {
    pokemon: "pokemon", pokémon: "pokemon", yugioh: "yugioh", "yu-gi-oh": "yugioh",
    onepiece: "onepiece", "one piece": "onepiece", lorcana: "lorcana", magic: "magic",
    dragonball: "dragonball", "dragon ball": "dragonball",
    starwars: "starwars", "star wars": "starwars", "star wars unlimited": "starwars", swu: "starwars",
    sports: "sports", disney: "lorcana"
  };
  for (const [k, v] of Object.entries(map)) {
    if (s.includes(k)) return v;
  }
  return s.replace(/[^a-z0-9]/g, "") || "autre";
}
