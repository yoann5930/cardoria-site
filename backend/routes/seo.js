/**
 * API publique SEO Cardoria — sitemap, robots, blog, pages générées.
 */
import { Router } from "express";
import { generateSitemapXml, generateRobotsTxt, getSitemapStats } from "../lib/seo/sitemap.js";
import { listBlogPosts, getBlogPost } from "../lib/seo/blog.js";
import { getLicenseSeoContent, listExtensions, getGeneratedPage } from "../lib/seo/generator.js";
import { readJson } from "../lib/storage.js";

const router = Router();
const SITE = process.env.SITE_URL || "https://cardoria.vercel.app";

router.get("/sitemap.xml", (req, res) => {
  const xml = generateSitemapXml(SITE);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

router.get("/robots.txt", (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
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
