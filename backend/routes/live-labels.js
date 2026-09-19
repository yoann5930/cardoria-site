/** Owned label downloads: browsers never receive a Sendcloud API credential. */
import { Router } from "express";
import { assertSellerSession } from "../lib/marketplace/v1/security.js";
import { listLiveShipments } from "../lib/live/shipments.js";
import { downloadSendcloudLabel } from "../lib/sendcloud.js";
const router = Router();
router.get("/seller/shipments/:id/label", async (req, res) => {
  try {
    const seller = assertSellerSession(req);
    const shipment = listLiveShipments({ sellerId: seller.id }).find(row => row.id === req.params.id);
    if (!shipment?.sendcloudParcelId) return res.status(404).json({ ok: false, error: "Étiquette introuvable." });
    const bytes = await downloadSendcloudLabel(shipment.sendcloudParcelId);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="etiquette-live.pdf"');
    res.send(bytes);
  } catch (error) {
    const status = Number(error?.status);
    res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502).json({ ok: false, code: error?.code || "LIVE_LABEL_UNAVAILABLE", error: "Téléchargement de l'étiquette indisponible." });
  }
});
export default router;
