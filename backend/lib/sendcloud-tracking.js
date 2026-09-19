/** Pure reducer. Call only after successful verification of the webhook signature. */
export function updateShipmentFromSendcloud(shipment, payload, receivedAt = new Date().toISOString()) {
  if (!shipment || payload?.action !== "parcel_status_changed") return { changed: false, shipment };
  const parcel = payload.parcel;
  if (!parcel || String(parcel.id || "") !== String(shipment.sendcloudParcelId || "")) return { changed: false, shipment };
  const timestamp = Number(payload.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw Object.assign(new Error("Horodatage Sendcloud invalide."), { status: 400, code: "SENDCLOUD_TIMESTAMP_INVALID" });
  if (Number(shipment.lastSendcloudEventTimestamp || 0) >= timestamp) return { changed: false, shipment };
  const status = parcel.status;
  if (!status || typeof status !== "object" || (!status.message && !status.code && status.id == null)) throw Object.assign(new Error("Statut Sendcloud manquant."), { status: 400, code: "SENDCLOUD_STATUS_INVALID" });
  const clean = (value, max) => String(value == null ? "" : value).trim().slice(0, max);
  return {
    changed: true,
    shipment: {
      ...shipment,
      status: clean(status.message || status.code || status.id, 160),
      sendcloudStatusId: status.id == null ? null : clean(status.id, 40),
      trackingNumber: clean(parcel.tracking_number, 160) || shipment.trackingNumber || "",
      lastSendcloudEventTimestamp: timestamp,
      updatedAt: receivedAt
    }
  };
}
