/** Owned label downloads: browsers never receive a Sendcloud API credential. */
import { Router } from "express";
import { assertSellerSession } from "../lib/marketplace/v1/security.js";
import { getLiveShipmentForSeller } from "../lib/live/shipments.js";
import { downloadSendcloudLabel } from "../lib/sendcloud.js";
import { downloadMondialRelayLabel } from "../lib/mondial-relay.js";
const router = Router();
router.get("/seller/shipments/:id/label", async (req, res) => {
  try {
    const seller = assertSellerSession(req);
    const shipment = getLiveShipmentForSeller(req.params.id, seller.id);
    if (!shipment) return res.status(404).json({ ok: false, error: "Étiquette introuvable." });
    let bytes;
    if (shipment.provider === "mondial_relay_direct" || shipment.mondialRelayShipmentNumber) {
      if (!shipment.mondialRelayLabelUrl) return res.status(404).json({ ok: false, error: "Étiquette Mondial Relay introuvable." });
      bytes = await downloadMondialRelayLabel(shipment.mondialRelayLabelUrl);
    } else {
      if (!shipment.sendcloudParcelId) return res.status(404).json({ ok: false, error: "Étiquette introuvable." });
      bytes = await downloadSendcloudLabel(shipment.sendcloudParcelId);
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="etiquette-live.pdf"');
    res.setHeader("Content-Length", String(bytes.length));
    res.send(bytes);
  } catch (error) {
    const status = Number(error?.status);
    res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502).json({ ok: false, code: error?.code || "LIVE_LABEL_UNAVAILABLE", error: "Téléchargement de l'étiquette indisponible." });
  }
});
export default router;
