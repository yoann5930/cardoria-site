/**
 * API publique SEO Cardoria — sitemap, robots, blog, pages générées.
 */
import { Router } from "express";
import {
  generateSitemapXml,
  generateCoreSitemapXml,
  generateCardsSitemapXml,
  generateRobotsTxt,
  getSitemapStats,
  getCardSitemapPageCount
} from "../lib/seo/sitemap.js";
import { listBlogPosts, getBlogPost } from "../lib/seo/blog.js";
import { getLicenseSeoContent, listExtensions, getGeneratedPage } from "../lib/seo/generator.js";
import { readJson } from "../lib/storage.js";

const router = Router();
const SITE = process.env.SITE_URL || "https://www.cardoriashop.fr";

function sendXml(res, xml, maxAge = 3600) {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
  res.send(xml);
}

// Index principal : référence le sitemap éditorial + tous les sitemaps cartes.
router.get("/sitemap.xml", (req, res) => {
  sendXml(res, generateSitemapXml(SITE));
});

router.get("/core.xml", (req, res) => {
  sendXml(res, generateCoreSitemapXml(SITE));
});

router.get("/cards-:page.xml", (req, res) => {
  const page = Number(req.params.page);
  const maxPage = getCardSitemapPageCount();
  if (!Number.isInteger(page) || page < 1 || page > maxPage) {
    return res.status(404).type("text/plain").send("Sitemap introuvable");
  }
  return sendXml(res, generateCardsSitemapXml(SITE, page));
});

router.get("/robots.txt", (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(generateRobotsTxt(SITE));
});

router.get("/stats", (req, res) => {
  res.json({ ok: true, stats: getSitemapStats() });
});

router.get("/tracking", (req, res) => {
  const settings = readJson("settings", {});
  res.json({
    ok: true,
    ga4Id: settings.ga4Id || process.env.GA4_MEASUREMENT_ID || "",
    clarityId: settings.clarityId || process.env.CLARITY_PROJECT_ID || "",
    gscVerified: !!settings.gscVerified
  });
});

router.get("/blog", (req, res) => {
  res.json({ ok: true, posts: listBlogPosts({ limit: req.query.limit || 24 }) });
});

router.get("/blog/:slug", (req, res) => {
  const post = getBlogPost(req.params.slug);
  if (!post || !post.published) return res.status(404).json({ ok: false, error: "Article introuvable" });
  res.json({ ok: true, post });
});

router.get("/licences/:slug", (req, res) => {
  const page = getLicenseSeoContent(req.params.slug);
  if (!page) return res.status(404).json({ ok: false, error: "Licence introuvable" });
  res.json({ ok: true, page });
});

router.get("/extensions", (req, res) => {
  res.json({ ok: true, extensions: listExtensions(req.query.license) });
});

router.get("/pages/:type/:slug", (req, res) => {
  const page = getGeneratedPage(req.params.type, req.params.slug, req.query.license || "");
  if (!page) return res.status(404).json({ ok: false, error: "Page introuvable" });
  res.json({ ok: true, page });
});

export default router;
