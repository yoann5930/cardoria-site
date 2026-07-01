/**
 * Administration SEO — blog, génération sitemap, analytics.
 */
import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { readJson, writeJson } from "../lib/storage.js";
import { listBlogPosts, getBlogPost, saveBlogPost, deleteBlogPost } from "../lib/seo/blog.js";
import { generateLicensePages, generateExtensionPages, listGeneratedPages } from "../lib/seo/generator.js";
import { generateSitemapXml, generateRobotsTxt, getSitemapStats } from "../lib/seo/sitemap.js";

const router = Router();
router.use(requireAdmin);

router.get("/stats", (req, res) => {
  res.json({ ok: true, stats: getSitemapStats() });
});

router.post("/regenerate", (req, res) => {
  const licenses = generateLicensePages();
  const extensions = generateExtensionPages();
  logAudit({ type: "seo", action: "regenerate_pages", user: "admin", detail: `${licenses} licences, ${extensions} extensions` });
  res.json({ ok: true, licenses, extensions, stats: getSitemapStats() });
});

router.get("/sitemap.xml", (req, res) => {
  const site = process.env.SITE_URL || "https://cardoria.vercel.app";
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.send(generateSitemapXml(site));
});

router.get("/robots.txt", (req, res) => {
  const site = process.env.SITE_URL || "https://cardoria.vercel.app";
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(generateRobotsTxt(site));
});

router.get("/pages", (req, res) => {
  res.json({ ok: true, pages: listGeneratedPages({ type: req.query.type, license: req.query.license, limit: req.query.limit }) });
});

router.get("/blog", (req, res) => {
  res.json({ ok: true, posts: listBlogPosts({ publishedOnly: false, limit: 100 }) });
});

router.get("/blog/:id", (req, res) => {
  const post = getBlogPost(req.params.id);
  if (!post) return res.status(404).json({ ok: false, error: "Article introuvable" });
  res.json({ ok: true, post });
});

router.post("/blog", (req, res) => {
  const post = saveBlogPost(req.body || {});
  logAudit({ type: "seo", action: "blog_save", user: "admin", detail: post.id });
  res.json({ ok: true, post });
});

router.delete("/blog/:id", (req, res) => {
  deleteBlogPost(req.params.id);
  logAudit({ type: "seo", action: "blog_delete", user: "admin", detail: req.params.id });
  res.json({ ok: true });
});

router.get("/settings", (req, res) => {
  res.json({ ok: true, settings: readJson("settings", {}) });
});

router.put("/settings", (req, res) => {
  const settings = { ...readJson("settings", {}), ...req.body };
  writeJson("settings", settings);
  logAudit({ type: "seo", action: "settings_update", user: "admin", detail: "SEO/Analytics" });
  res.json({ ok: true, settings });
});

export default router;
