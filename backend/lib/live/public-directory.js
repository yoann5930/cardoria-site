/** Classement public Live : packs Elite → Pro → Starter, puis audience. */
import { getSellerPlanState } from "../subscriptions/seller-plans.js";

export const LIVE_CATEGORY_OPTIONS = Object.freeze([
  Object.freeze({ id: "pokemon", label: "Pokémon" }),
  Object.freeze({ id: "yugioh", label: "Yu-Gi-Oh!" }),
  Object.freeze({ id: "onepiece", label: "One Piece" }),
  Object.freeze({ id: "lorcana", label: "Lorcana" }),
  Object.freeze({ id: "magic", label: "Magic" }),
  Object.freeze({ id: "other", label: "Autre" })
]);

const LIVE_CATEGORY_IDS = new Set(LIVE_CATEGORY_OPTIONS.map((item) => item.id));
const CATEGORY_ALIASES = Object.freeze({
  pokemon: "pokemon",
  poke: "pokemon",
  pkmn: "pokemon",
  yugioh: "yugioh",
  yugi: "yugioh",
  onepiece: "onepiece",
  opcg: "onepiece",
  lorcana: "lorcana",
  magic: "magic",
  mtg: "magic",
  other: "other",
  autre: "other"
});
const PLAN_RANK = Object.freeze({ cardoria: 0, elite: 1, pro: 2, starter: 3 });
const PLAN_LABEL = Object.freeze({
  cardoria: "Officiel",
  elite: "Elite",
  pro: "Pro",
  starter: "Starter"
});

function foldLiveText(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function compactLiveToken(value) {
  return foldLiveText(value).replace(/[^a-z0-9]+/g, "");
}

function inferLiveCategory(title) {
  const text = foldLiveText(title);
  if (/pokemon|\bpkmn\b|\bpoke\b/.test(text)) return "pokemon";
  if (/yu-?gi|yugioh/.test(text)) return "yugioh";
  if (/one\s*piece|\bopcg\b/.test(text)) return "onepiece";
  if (/lorcana/.test(text)) return "lorcana";
  if (/\bmagic\b|\bmtg\b/.test(text)) return "magic";
  return "other";
}

export function normalizeLiveCategory(value, title = "") {
  const token = compactLiveToken(value);
  if (LIVE_CATEGORY_IDS.has(token)) return token;
  if (CATEGORY_ALIASES[token]) return CATEGORY_ALIASES[token];
  return inferLiveCategory(title);
}

export function requestedLiveCategory(value) {
  const token = compactLiveToken(value);
  if (!token || token === "all" || token === "tous") return "";
  if (LIVE_CATEGORY_IDS.has(token)) return token;
  return CATEGORY_ALIASES[token] || "";
}

export function publicPlanMeta(session) {
  if (String(session?.ownerRole || "").toLowerCase() === "admin") {
    return { planId: "cardoria", planLabel: PLAN_LABEL.cardoria, featured: true, rank: PLAN_RANK.cardoria };
  }
  let planId = "starter";
  try {
    const state = getSellerPlanState(session?.ownerId);
    if (state?.active && PLAN_RANK[state.planId] != null && state.planId !== "cardoria") {
      planId = state.planId;
    }
  } catch {}
  return {
    planId,
    planLabel: PLAN_LABEL[planId] || PLAN_LABEL.starter,
    featured: planId === "elite",
    rank: PLAN_RANK[planId] ?? PLAN_RANK.starter
  };
}

export function filterPublicSessionsByCategory(sessions, category) {
  const selected = requestedLiveCategory(category);
  if (!selected) return [...sessions];
  return sessions.filter((session) => normalizeLiveCategory(session.category, session.title) === selected);
}

function timestamp(value) {
  const ms = Date.parse(value || 0);
  return Number.isFinite(ms) ? ms : 0;
}

export function sortPublicSessions(sessions) {
  return [...sessions].sort((left, right) => {
    const leftLive = String(left?.status || "") === "live";
    const rightLive = String(right?.status || "") === "live";
    if (leftLive !== rightLive) return leftLive ? -1 : 1;
    const rank = Number(left?.planRank ?? 99) - Number(right?.planRank ?? 99);
    if (rank) return rank;
    const viewers = Number(right?.viewerCount || 0) - Number(left?.viewerCount || 0);
    if (viewers) return viewers;
    if (leftLive) return timestamp(right.startedAt) - timestamp(left.startedAt);
    return timestamp(left.scheduledAt) - timestamp(right.scheduledAt);
  });
}

export function publicClientSession(session) {
  if (!session) return null;
  const { planRank, ...client } = session;
  return client;
}
