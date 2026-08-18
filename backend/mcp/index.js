import crypto from "crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import { getDb, normalizeText } from "../lib/engine/database.js";
import { readJson } from "../lib/storage.js";

const VERSION = "0.1.0";
const SOURCE = "cardoria";

function nowIso() {
  return new Date().toISOString();
}

function result(data, warnings = []) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, source: SOURCE, generatedAt: nowIso(), data, warnings }) }],
    structuredContent: { ok: true, source: SOURCE, generatedAt: nowIso(), data, warnings }
  };
}

function failure(code, message) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code, message } }) }]
  };
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

export function mcpEnabled() {
  return String(process.env.CARDORIA_MCP_ENABLED || "false").toLowerCase() === "true";
}

export function mcpHealth(req, res) {
  res.json({
    ok: mcpEnabled(),
    service: "cardoria-mcp",
    version: VERSION,
    readOnly: String(process.env.CARDORIA_MCP_READ_ONLY || "true").toLowerCase() !== "false"
  });
}

export function requireMcpBearer(req, res, next) {
  if (!mcpEnabled()) return res.status(503).json({ ok: false, error: "CARDORIA_MCP_DISABLED" });
  const expected = process.env.CARDORIA_MCP_TOKEN_SECRET || "";
  if (!expected) return res.status(503).json({ ok: false, error: "CARDORIA_MCP_TOKEN_SECRET_NOT_CONFIGURED" });
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!safeEqual(token, expected)) return res.status(401).json({ ok: false, error: "CARDORIA_MCP_UNAUTHORIZED" });
  next();
}

function getCardsDb() {
  return getDb();
}

function listSales({ startDate, endDate, platform, license, query, limit }) {
  const db = getCardsDb();
  const clauses = [];
  const params = [];
  if (startDate) { clauses.push("sold_at >= ?"); params.push(startDate); }
  if (endDate) { clauses.push("sold_at <= ?"); params.push(endDate + "T23:59:59"); }
  if (platform) { clauses.push("LOWER(channel) = LOWER(?)"); params.push(platform); }
  if (license) { clauses.push("c.license_slug = ?"); params.push(license); }
  if (query) { clauses.push("LOWER(c.name) LIKE ?"); params.push(`%${String(query).toLowerCase()}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `
    SELECT s.id, s.card_id, s.sold_at, s.price, s.condition, s.channel,
           c.name, c.license_slug, c.extension, c.number
    FROM sales_history s
    LEFT JOIN cards c ON c.id = s.card_id
    ${where}
    ORDER BY s.sold_at DESC
    LIMIT ?`;
  params.push(Math.min(Math.max(Number(limit || 50), 1), 200));
  return db.prepare(sql).all(...params).map((r) => ({
    id: r.id,
    date: r.sold_at,
    cardId: r.card_id,
    product: r.name || r.card_id,
    license: r.license_slug || "",
    extension: r.extension || "",
    number: r.number || "",
    salePrice: Number(r.price || 0),
    platform: r.channel || "Cardoria",
    condition: r.condition || ""
  }));
}

function listPurchases({ startDate, endDate, license, query, limit }) {
  let rows = readJson("purchases", []);
  if (!Array.isArray(rows)) rows = [];
  if (startDate) rows = rows.filter((p) => String(p.date || "") >= startDate);
  if (endDate) rows = rows.filter((p) => String(p.date || "") <= endDate);
  if (license) rows = rows.filter((p) => String(p.license || "").toLowerCase() === String(license).toLowerCase());
  if (query) {
    const q = String(query).toLowerCase();
    rows = rows.filter((p) => JSON.stringify(p).toLowerCase().includes(q));
  }
  return rows.slice(0, Math.min(Math.max(Number(limit || 50), 1), 200));
}

function inventorySearch({ query, license, extension, number, rarity, limit }) {
  const db = getCardsDb();
  const clauses = ["c.active = 1"];
  const params = [];
  if (query) { clauses.push("c.name_normalized LIKE ?"); params.push(`%${normalizeText(query)}%`); }
  if (license) { clauses.push("c.license_slug = ?"); params.push(license); }
  if (extension) { clauses.push("LOWER(c.extension) LIKE ?"); params.push(`%${String(extension).toLowerCase()}%`); }
  if (number) { clauses.push("c.number = ?"); params.push(number); }
  if (rarity) { clauses.push("LOWER(c.rarity) LIKE ?"); params.push(`%${String(rarity).toLowerCase()}%`); }
  const sql = `
    SELECT c.id, c.name, c.license_slug, c.extension, c.number, c.rarity,
           c.condition_note, c.avg_price, c.low_price, c.high_price,
           c.recommended_price, c.image_hd, c.image_thumb,
           COALESCE(SUM(CASE WHEN l.status = 'active' THEN l.stock ELSE 0 END), 0) AS listed_stock
    FROM cards c
    LEFT JOIN mk_listings l ON l.card_id = c.id
    WHERE ${clauses.join(" AND ")}
    GROUP BY c.id
    ORDER BY c.name ASC
    LIMIT ?`;
  params.push(Math.min(Math.max(Number(limit || 50), 1), 200));
  return db.prepare(sql).all(...params).map((r) => ({
    id: r.id,
    name: r.name,
    license: r.license_slug,
    extension: r.extension,
    number: r.number,
    rarity: r.rarity,
    condition: r.condition_note,
    listedStock: Number(r.listed_stock || 0),
    prices: {
      avg: Number(r.avg_price || 0),
      low: Number(r.low_price || 0),
      high: Number(r.high_price || 0),
      recommended: Number(r.recommended_price || 0)
    },
    image: r.image_thumb || r.image_hd || ""
  }));
}

function dashboard(month, year) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const sales = listSales({ startDate: start, endDate: end, limit: 200 });
  const purchases = listPurchases({ startDate: start, endDate: end, limit: 200 });
  const revenue = sales.reduce((s, x) => s + Number(x.salePrice || 0), 0);
  const purchaseSpend = purchases.reduce((s, x) => s + Number(x.amount || x.total || 0), 0);
  const db = getCardsDb();
  const inventory = db.prepare("SELECT COUNT(*) AS cards, COALESCE(SUM(avg_price),0) AS catalogue_value FROM cards WHERE active=1").get();
  return {
    period: { month: Number(month), year: Number(year), start, end },
    revenue,
    salesCount: sales.length,
    purchasesCount: purchases.length,
    purchaseSpend,
    grossAfterPurchasesIndicator: revenue - purchaseSpend,
    catalogueCards: Number(inventory?.cards || 0),
    catalogueIndicativeValue: Number(inventory?.catalogue_value || 0),
    estimated: true,
    note: "Indicateur de pilotage Cardoria. Ne constitue pas une déclaration fiscale ou sociale."
  };
}

function whatnotSummary({ startDate, endDate }) {
  const sales = listSales({ startDate, endDate, platform: "WHATNOT", limit: 200 });
  const gross = sales.reduce((s, x) => s + Number(x.salePrice || 0), 0);
  return {
    salesCount: sales.length,
    grossRevenue: gross,
    importedFees: null,
    netRevenue: null,
    estimated: false,
    warning: "Aucun connecteur Whatnot officiel n'est présent dans le dépôt actuel; seules les ventes déjà enregistrées avec channel=WHATNOT sont lues."
  };
}

function createCardoriaServer() {
  const server = new McpServer({ name: "cardoria", version: VERSION });

  server.registerTool("cardoria_health", {
    description: "Vérifie l'état de la passerelle Cardoria sans exposer de secret.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({})
  }, async () => result({ service: "cardoria-mcp", version: VERSION, readOnly: true, database: "available" }));

  server.registerTool("cardoria_dashboard", {
    description: "Retourne les indicateurs Cardoria d'un mois à partir des données réelles disponibles.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ month: z.number().int().min(1).max(12), year: z.number().int().min(2020).max(2100) })
  }, async ({ month, year }) => {
    try { return result(dashboard(month, year), ["Les champs estimated=true sont des indicateurs de gestion, pas une déclaration officielle."]); }
    catch (e) { return failure("CARDORIA_DASHBOARD_ERROR", String(e?.message || e)); }
  });

  server.registerTool("cardoria_inventory_search", {
    description: "Recherche des cartes réellement présentes dans le catalogue/stock Cardoria.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      query: z.string().optional(),
      license: z.string().optional(),
      extension: z.string().optional(),
      number: z.string().optional(),
      rarity: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional()
    })
  }, async (args) => {
    try { return result(inventorySearch(args)); }
    catch (e) { return failure("CARDORIA_INVENTORY_ERROR", String(e?.message || e)); }
  });

  server.registerTool("cardoria_inventory_item", {
    description: "Retourne une fiche carte Cardoria par identifiant exact.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ id: z.string().min(1) })
  }, async ({ id }) => {
    try {
      const items = inventorySearch({ limit: 200 }).filter((x) => x.id === id);
      if (!items.length) return failure("CARDORIA_INVENTORY_NOT_FOUND", "Carte introuvable");
      return result(items[0]);
    } catch (e) { return failure("CARDORIA_INVENTORY_ERROR", String(e?.message || e)); }
  });

  server.registerTool("cardoria_list_sales", {
    description: "Liste les ventes Cardoria enregistrées dans sales_history avec filtres.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      platform: z.string().optional(),
      license: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional()
    })
  }, async (args) => {
    try { return result(listSales(args)); }
    catch (e) { return failure("CARDORIA_SALES_ERROR", String(e?.message || e)); }
  });

  server.registerTool("cardoria_list_purchases", {
    description: "Liste les achats Cardoria enregistrés dans purchases.json.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      license: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional()
    })
  }, async (args) => {
    try { return result(listPurchases(args)); }
    catch (e) { return failure("CARDORIA_PURCHASES_ERROR", String(e?.message || e)); }
  });

  server.registerTool("cardoria_accounting_month", {
    description: "Synthèse mensuelle EI Cardoria à partir des données disponibles; les estimations sont explicitement marquées.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ month: z.number().int().min(1).max(12), year: z.number().int().min(2020).max(2100) })
  }, async ({ month, year }) => {
    try { return result(dashboard(month, year), ["Ne pas utiliser directement comme déclaration fiscale/URSSAF sans validation comptable."]); }
    catch (e) { return failure("CARDORIA_ACCOUNTING_ERROR", String(e?.message || e)); }
  });

  server.registerTool("cardoria_whatnot_summary", {
    description: "Synthèse des ventes déjà enregistrées comme WHATNOT dans Cardoria. Aucun scraping.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ startDate: z.string().optional(), endDate: z.string().optional() })
  }, async (args) => {
    try { return result(whatnotSummary(args)); }
    catch (e) { return failure("CARDORIA_WHATNOT_ERROR", String(e?.message || e)); }
  });

  return server;
}

const handler = createMcpHandler(() => createCardoriaServer());
const nodeHandler = toNodeHandler(handler);

export function mountCardoriaMcp(app) {
  app.get("/api/mcp/health", mcpHealth);
  app.all("/mcp", requireMcpBearer, (req, res) => void nodeHandler(req, res, req.body));
}

export async function closeCardoriaMcp() {
  await handler.close();
}
