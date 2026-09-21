import { Router } from "express";
import { colissimoPublicStatus, readStoredLabelPdf } from "../lib/colissimo.js";
import { requireAuth } from "../lib/auth.js";
import { validateSession } from "../lib/auth/session.js";
import { readJson } from "../lib/storage.js";
import { getOrder } from "../lib/marketplace/orders.js";

const router = Router();
const WRITE_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "write" });

router.get("/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(colissimoPublicStatus());
});

function sendPdf(res, orderId) {
  const bytes = readStoredLabelPdf(orderId);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="bordereau-laposte.pdf"');
  res.setHeader("Content-Length", String(bytes.length));
  res.send(bytes);
}

router.get("/labels/:orderId", WRITE_ADMIN, (req, res) => {
  try { sendPdf(res, req.params.orderId); }
  catch (error) {
    const status = Number(error?.status);
    res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 404).json({
      ok: false,
      code: error?.code || "COLISSIMO_LABEL_MISSING",
      error: "Bordereau La Poste introuvable."
    });
  }
});

router.get("/my-labels/:orderId", (req, res) => {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-session-token"];
    const user = validateSession(token);
    if (!user) return res.status(401).json({ ok: false, error: "Session expiree." });
    const orderId = String(req.params.orderId || "");
    const boutique = readJson("orders", []).find((row) => String(row.id) === orderId);
    if (boutique) {
      if (user.role !== "client") return res.status(403).json({ ok: false, error: "Compte client requis." });
      const ownsAccount = String(boutique.userId || "") && String(boutique.userId) === String(user.id);
      const ownsEmail = String(boutique.email || "").toLowerCase() === String(user.email || "").toLowerCase();
      if (!ownsAccount && !ownsEmail) return res.status(403).json({ ok: false, error: "Commande introuvable." });
      return sendPdf(res, orderId);
    }
    if (user.role !== "client") return res.status(403).json({ ok: false, error: "Compte client requis." });
    const market = getOrder(orderId);
    if (!market || String(market.buyerId || "") !== String(user.id)) return res.status(404).json({ ok: false, error: "Bordereau introuvable." });
    return sendPdf(res, orderId);
  } catch (error) {
    const status = Number(error?.status);
    res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 404).json({
      ok: false,
      code: error?.code || "COLISSIMO_LABEL_MISSING",
      error: "Bordereau La Poste introuvable."
    });
  }
});

export default router;
