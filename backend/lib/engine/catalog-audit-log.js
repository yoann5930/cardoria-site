import { getCatalogAuditSummary, listCatalogAuditReferences, getImageHostAudit } from "./catalog-audit.js";

function sample(category, language = "", limit = 12) {
  try {
    return listCatalogAuditReferences({ category, language, page: 1, limit });
  } catch (error) {
    return { category, language: language || "all", error: error?.message || String(error) };
  }
}

function emitAudit(label) {
  try {
    const report = {
      label,
      summary: getCatalogAuditSummary(),
      imageHosts: getImageHostAudit(),
      samples: {
        missingImageFr: sample("missing-image", "fr"),
        missingImageEn: sample("missing-image", "en"),
        missingImageJa: sample("missing-image", "ja"),
        missingImageKo: sample("missing-image", "ko"),
        missingPriceFr: sample("missing-price", "fr"),
        missingPriceEn: sample("missing-price", "en"),
        missingPriceJa: sample("missing-price", "ja"),
        missingPriceKo: sample("missing-price", "ko"),
        genericNames: sample("generic-name", "", 20),
        missingSourceNames: sample("missing-source-name", "", 20),
        malformedIds: sample("malformed-id", "", 20),
        duplicateReferences: sample("duplicate-reference", "", 20),
        imageLanguageMismatch: sample("image-language-mismatch", "", 20)
      }
    };
    console.log(`[catalog-full-audit] ${JSON.stringify(report)}`);
  } catch (error) {
    console.error("[catalog-full-audit] failed", error?.message || String(error));
  }
}

const earlyTimer = setTimeout(() => emitAudit("startup-early"), 75000);
earlyTimer.unref?.();
const settledTimer = setTimeout(() => emitAudit("startup-settled"), 210000);
settledTimer.unref?.();
