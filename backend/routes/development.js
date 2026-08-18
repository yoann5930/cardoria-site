import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { readJson, writeJson } from "../lib/storage.js";
import { logAudit } from "../lib/audit.js";

const router = Router();
router.use(requireAdmin);

const ROADMAP_FILE = "development-roadmap.json";

const CRITERIA = [
  { id: "structure", label: "Structure et contenu finalisés" },
  { id: "design", label: "Design desktop validé" },
  { id: "responsive", label: "Mobile et tablette validés" },
  { id: "navigation", label: "Navigation et liens vérifiés" },
  { id: "data", label: "Données réelles / aucun contenu démo trompeur" },
  { id: "security", label: "Sécurité et confidentialité contrôlées" },
  { id: "performance", label: "Performance et chargement contrôlés" },
  { id: "accessibility", label: "Accessibilité de base contrôlée" },
  { id: "seo", label: "SEO, titres et métadonnées validés" },
  { id: "functional", label: "Fonctions et formulaires testés" },
  { id: "production", label: "Page vérifiée sur la production Render" },
  { id: "owner", label: "Validation finale utilisateur" }
];

const PAGE_ORDER = [
  ["home", "Accueil", "/index.html"],
  ["shop", "Boutique", "/boutique.html"],
  ["estimation", "Estimation", "/estimation.html"],
  ["buyback", "Rachat de cartes", "/rachat-cartes.html"],
  ["marketplace", "Marketplace", "/marketplace.html"],
  ["scanner", "Scanner", "/scanner.html"],
  ["card", "Fiche carte", "/carte.html"],
  ["license", "Catalogue / Licence", "/licence.html"],
  ["accessories", "Accessoires", "/accessoires.html"],
  ["compare", "Comparateur", "/comparateur.html"],
  ["trends", "Tendances", "/tendances.html"],
  ["sell", "Vendre", "/vendre.html"],
  ["listing", "Annonce", "/annonce.html"],
  ["seller", "Espace vendeur", "/espace-vendeur.html"],
  ["my-listings", "Mes annonces", "/mes-annonces.html"],
  ["market-cart", "Panier marketplace", "/panier-marketplace.html"],
  ["my-orders", "Mes commandes", "/mes-commandes.html"],
  ["wishlist", "Souhaits", "/souhaits.html"],
  ["favorites", "Favoris", "/favoris.html"],
  ["ai-search", "Recherche IA", "/recherche-ia.html"],
  ["seo-service", "Référencement", "/referencement.html"],
  ["contact", "Contact", "/contact.html"],
  ["about", "À propos", "/pages/a-propos/"],
  ["faq", "FAQ", "/pages/faq/"],
  ["blog", "Blog", "/pages/blog/"],
  ["legal", "Pages légales", "/pages/mentions-legales/"],
  ["admin-login", "Connexion admin", "/admin-login.html"],
  ["admin", "Administration complète", "/admin.html"]
];

function makeDefaultRoadmap() {
  return {
    version: 1,
    strategy: "Une seule page active à la fois. La suivante se débloque uniquement quand tous les critères de la page courante sont validés.",
    updatedAt: new Date().toISOString(),
    pages: PAGE_ORDER.map((page, index) => ({
      id: page[0],
      name: page[1],
      path: page[2],
      order: index + 1,
      notes: "",
      checks: Object.fromEntries(CRITERIA.map((criterion) => [criterion.id, false]))
    }))
  };
}

function normalizeRoadmap(input) {
  const base = makeDefaultRoadmap();
  const existing = input && Array.isArray(input.pages) ? input.pages : [];
  const byId = new Map(existing.map((page) => [page.id, page]));

  base.pages = base.pages.map((page) => {
    const saved = byId.get(page.id) || {};
    const savedChecks = saved.checks || {};
    return {
      ...page,
      notes: typeof saved.notes === "string" ? saved.notes : "",
      checks: Object.fromEntries(CRITERIA.map((criterion) => [criterion.id, savedChecks[criterion.id] === true]))
    };
  });

  base.updatedAt = input?.updatedAt || base.updatedAt;
  return base;
}

function enrich(roadmap) {
  let previousComplete = true;
  const pages = roadmap.pages.map((page, index) => {
    const total = CRITERIA.length;
    const done = CRITERIA.reduce((count, criterion) => count + (page.checks?.[criterion.id] ? 1 : 0), 0);
    const progress = Math.round((done / total) * 100);
    const complete = done === total;
    const unlocked = index === 0 || previousComplete;
    const status = complete ? "complete" : unlocked ? "active" : "locked";
    previousComplete = previousComplete && complete;
    return { ...page, done, total, progress, complete, unlocked, status };
  });

  const completeCount = pages.filter((page) => page.complete).length;
  const activePage = pages.find((page) => page.status === "active") || pages[pages.length - 1];
  return {
    ...roadmap,
    criteria: CRITERIA,
    pages,
    summary: {
      totalPages: pages.length,
      completePages: completeCount,
      overallProgress: Math.round((completeCount / pages.length) * 100),
      activePageId: activePage?.id || null,
      activePageName: activePage?.name || null
    }
  };
}

function loadRoadmap() {
  return normalizeRoadmap(readJson(ROADMAP_FILE, makeDefaultRoadmap()));
}

router.get("/roadmap", (req, res) => {
  res.json({ ok: true, roadmap: enrich(loadRoadmap()) });
});

router.put("/roadmap/pages/:pageId", (req, res) => {
  const roadmap = loadRoadmap();
  const pageIndex = roadmap.pages.findIndex((page) => page.id === req.params.pageId);
  if (pageIndex === -1) return res.status(404).json({ ok: false, error: "Page inconnue." });

  const enrichedBefore = enrich(roadmap);
  const targetBefore = enrichedBefore.pages[pageIndex];
  if (!targetBefore.unlocked) {
    return res.status(409).json({ ok: false, error: "Cette page est verrouillée tant que la page précédente n'est pas validée à 100 %." });
  }

  const patch = req.body || {};
  if (patch.checks && typeof patch.checks === "object") {
    for (const criterion of CRITERIA) {
      if (Object.prototype.hasOwnProperty.call(patch.checks, criterion.id)) {
        roadmap.pages[pageIndex].checks[criterion.id] = patch.checks[criterion.id] === true;
      }
    }
  }
  if (typeof patch.notes === "string") roadmap.pages[pageIndex].notes = patch.notes.slice(0, 5000);

  roadmap.updatedAt = new Date().toISOString();
  writeJson(ROADMAP_FILE, roadmap);

  const result = enrich(roadmap);
  const updated = result.pages[pageIndex];
  logAudit({
    type: "development",
    action: updated.complete ? "page_validated" : "roadmap_update",
    user: req.authUser?.email || "admin",
    detail: `${updated.name} — ${updated.progress}%`
  });

  res.json({ ok: true, roadmap: result });
});

router.post("/roadmap/reset", (req, res) => {
  const roadmap = makeDefaultRoadmap();
  writeJson(ROADMAP_FILE, roadmap);
  logAudit({ type: "development", action: "roadmap_reset", user: req.authUser?.email || "admin", detail: "Roadmap développement réinitialisée" });
  res.json({ ok: true, roadmap: enrich(roadmap) });
});

export default router;
