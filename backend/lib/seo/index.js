import { migrateSeo } from "./migrate.js";
import { seedBlogIfEmpty } from "./blog.js";
import { generateLicensePages, generateExtensionPages } from "./generator.js";

export function initSeo() {
  migrateSeo();
  seedBlogIfEmpty();
  generateLicensePages();
  generateExtensionPages();
  return { ok: true, module: "cardoria-seo" };
}

export { listBlogPosts, getBlogPost, saveBlogPost, deleteBlogPost } from "./blog.js";
export { generateLicensePages, generateExtensionPages, getLicenseSeoContent, listExtensions, getGeneratedPage, listGeneratedPages } from "./generator.js";
export { generateSitemapXml, generateRobotsTxt, getSitemapStats } from "./sitemap.js";
