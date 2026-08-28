import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { getFinanceSummary, listFinanceSales, listFinancePurchases, financeCsv } from "../lib/admin/finance.js";

const router = Router();
const EXPORT_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "export" });
router.use(requireAdmin);
router.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

function filters(req) {
  return {
    period: req.query.period || "month",
    q: req.query.q || "",
    source: req.query.source || "",
    status: req.query.status || "",
    buyer: req.query.buyer || "",
    category: req.query.category || ""
  };
}

router.get("/summary", (req, res) => {
  res.json({ ok: true, summary: getFinanceSummary({ period: req.query.period || "month" }) });
});

router.get("/sales", (req, res) => {
  const rows = listFinanceSales(filters(req));
  res.json({ ok: true, sales: rows, total: rows.length });
});

router.get("/purchases", (req, res) => {
  const rows = listFinancePurchases(filters(req));
  res.json({ ok: true, purchases: rows, total: rows.length });
});

router.get("/export.csv", EXPORT_ADMIN, (req, res) => {
  const type = ["sales", "purchases", "summary"].includes(String(req.query.type || "")) ? String(req.query.type) : "sales";
  const csv = financeCsv(type, filters(req));
  logAudit({ type: "export", action: "finance_csv", user: req.authUser?.email || "admin", detail: `${type} — ${req.query.period || "month"}` });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cardoria-comptabilite-${type}-${Date.now()}.csv"`);
  res.send("\uFEFF" + csv);
});

export default router;
