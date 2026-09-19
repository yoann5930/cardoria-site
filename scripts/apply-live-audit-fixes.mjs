// One-shot, reviewed patch set. Every edit is anchored; no production commands or secrets.
import fs from "node:fs";
const files = new Map();
function get(path) { if (!files.has(path)) files.set(path, fs.readFileSync(path, "utf8")); return files.get(path); }
function replace(path, before, after) {
  const source = get(path);
  if (!source.includes(before) && source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error("Patch anchor mismatch: " + path);
  files.set(path, source.replace(before, after));
}
replace("backend/tests/paypal-webhooks-3b.test.mjs", 'import { getDb }', 'import { migrateMarketplace } from "../lib/marketplace/migrate.js";\nimport { migrateMarketplaceV1 } from "../lib/marketplace/v1/migrate.js";\nimport { migratePayments } from "../lib/payments/migrate.js";\nimport { getDb }');
replace("backend/tests/paypal-webhooks-3b.test.mjs", '  const previousWebhookId = process.env.PAYPAL_WEBHOOK_ID;', '  // Run the production migration order even when this test file runs alone.\n  migrateMarketplace();\n  migrateMarketplaceV1();\n  migratePayments();\n  const previousWebhookId = process.env.PAYPAL_WEBHOOK_ID;');
replace("tests/ovh-smtp-bridge.test.mjs", 'assert.match(run, /smtp-configure\\) ;;/);', 'assert.match(run, /(?:^|\\|)smtp-configure(?:\\||\\) ;;)/m);');
replace("backend/lib/storage.js", '  "live-sessions.json":', '  "live-actions.json": "live-actions.json",\n  "live-sessions.json":');
replace("backend/lib/storage.js", '  catch { return fallback; }', '  catch (error) {\n    if (["live-shipments", "live-sessions.json", "live-actions.json", "seller-subscriptions"].includes(key)) {\n      throw Object.assign(new Error("Critical Live storage cannot be read; recovery required."), { status: 503, code: "LIVE_STORAGE_CORRUPT", cause: error });\n    }\n    return fallback;\n  }');
replace("backend/routes/live.js", 'import liveRealtimeRoutes from "./live-realtime.js";', 'import liveLabelRoutes from "./live-labels.js";\nimport liveRealtimeRoutes from "./live-realtime.js";');
replace("backend/routes/live.js", 'const router = Router();', 'const router = Router();\nrouter.use(liveLabelRoutes);');
replace("backend/lib/marketplace/paypal-events.js", 'import { getDb }', 'import { handleVerifiedLiveFinancialEvent } from "../live/paypal-capture-validation.js";\nimport { getDb }');
replace("backend/lib/marketplace/paypal-events.js", '  const resource = event?.resource || {};', '  const resource = event?.resource || {};\n  const liveFinancial = handleVerifiedLiveFinancialEvent(type, resource);\n  if (liveFinancial) return { received: true, type, live: liveFinancial };');
replace("backend/lib/marketplace/paypal.js", 'import { getDb }', 'import { applyVerifiedLiveCapture } from "../live/paypal-capture-validation.js";\nimport { getDb }');
replace("backend/lib/marketplace/paypal.js", '  if (checkout.status === "paid") return { provider: "paypal", alreadyPaid: true, checkout };', '  if (["paid", "completed", "refunded", "refund_reconciliation_required"].includes(checkout.status)) return { provider: "paypal", alreadyPaid: true, checkout };');
replace("backend/lib/marketplace/paypal.js", '  const captureStatus = String(capture?.status || result.status || "").toUpperCase();', '  const captureStatus = String(capture?.status || "").toUpperCase();');
replace("backend/lib/marketplace/paypal.js", '    applyLivePaymentStatus(checkout.id, "paid", {\n      paymentProviderOrderId: paypalOrderId,\n      paymentProviderTransactionId: capture?.id || ""\n    });', '    applyVerifiedLiveCapture(checkout, capture, { paypalOrderId, merchantId: seller.paypalMerchantId });');
replace("backend/lib/live/sessions.js", 'const prev=c.status;if(prev==="paid"&&status==="paid")', 'const prev=c.status;if(["refunded","refund_reconciliation_required"].includes(prev))return{...c,protected:true,duplicate:prev===status};if(prev==="completed"&&status==="paid")return{...c,alreadyPaid:true,duplicate:true};if(prev==="paid"&&status==="paid")');
replace("backend/lib/live/checkout-lifecycle.js", '  "creating", "pending", "authorized", "authorised", "reconciliation_required"', '  "creating", "pending", "authorized", "authorised", "reconciliation_required", "refund_reconciliation_required"');
replace("backend/lib/live/checkout-lifecycle.js", '  if (["creating", "reconciliation_required"].includes(status)) {', '  if (["creating", "reconciliation_required", "refund_reconciliation_required", "refunded"].includes(status)) {');
for (const path of ["css/live-studio-clean.css", "backend/public/css/live-studio-clean.css"]) replace(path, '#lasGiveFollow{display:none!important}', '#lasGiveFollow[hidden]{display:none!important}');
for (const path of ["js/live-studio-sales-controls.js", "backend/public/js/live-studio-sales-controls.js"]) {
  replace(path, '["lasGiveaway","lasGiveFollow"]', '["lasGiveaway","lasGiveFollow","lasGiveBuyer"]');
  replace(path, 'if(buyer){if(isAdmin()){buyer.hidden=false;buyer.style.display="";buyer.removeAttribute("aria-hidden");buyer.disabled=false;if(buyer.dataset.buyerGiveawayBound!=="1"){buyer.dataset.buyerGiveawayBound="1";buyer.onclick=startBuyerGiveaway;}}else{buyer.hidden=true;buyer.style.display="none";buyer.setAttribute("aria-hidden","true");}}', 'if(buyer){buyer.hidden=false;buyer.style.display="";buyer.removeAttribute("aria-hidden");buyer.disabled=false;if(buyer.dataset.buyerGiveawayBound!=="1"){buyer.dataset.buyerGiveawayBound="1";buyer.onclick=startBuyerGiveaway;}}');
}
replace("tests/live-admin-sales-menu.test.mjs", 'assert.match(css,/#lasGiveFollow\\{display:none!important\\}/);', 'assert.match(css,/#lasGiveFollow\\[hidden\\]\\{display:none!important\\}/);');
const safeTracking = `      host.replaceChildren();
      for (const s of items) {
        const box = document.createElement("div"), title = document.createElement("strong"), state = document.createElement("p"), tracking = document.createElement("p");
        title.textContent = s.carrier || "Expédition Live";
        state.textContent = "Statut : " + (s.status || "En préparation");
        tracking.textContent = "Suivi : ";
        let url = null;
        try { const candidate = new URL(s.trackingUrl); if (candidate.protocol === "https:" && !candidate.username && !candidate.password) url = candidate; } catch {}
        const link = document.createElement(url ? "a" : "span");
        link.textContent = s.trackingNumber || (url ? "Suivre le colis" : "Suivi en attente");
        if (url) { link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; }
        tracking.appendChild(link); box.append(title, state, tracking); host.appendChild(box);
      }
`;
for (const path of ["js/client-auth.js", "backend/public/js/client-auth.js"]) {
  const source = get(path), start = source.indexOf('      host.innerHTML = items.map((s) => {'), end = source.indexOf('    } catch (e) {', start);
  if (start >= 0 && end > start) files.set(path, source.slice(0, start) + safeTracking + source.slice(end));
  else if (!source.includes('      host.replaceChildren();')) throw new Error("Tracking patch mismatch: " + path);
  replace(path, '    const el = qs("clientAuthMessage");', '    let el = qs("clientAuthMessage");\n    if (qs("clientAccountCard") && !qs("clientAccountCard").hidden) {\n      el = qs("clientProfileMessage");\n      if (!el) { el = document.createElement("p"); el.id = "clientProfileMessage"; el.setAttribute("role", "status"); qs("clientAccountCard").prepend(el); }\n    }');
}
for (const path of ["js/marketplace-seller-dashboard.js", "backend/public/js/marketplace-seller-dashboard.js"]) {
  replace(path, '  function renderShipments(items) {', '  function safeTrackingUrl(value) { try { var url=new URL(value); return url.protocol==="https:"&&!url.username&&!url.password?url.href:""; } catch(e) { return ""; } }\n  function renderShipments(items) {');
  replace(path, '      var label = s.labelUrl ? " · <a target=\'_blank\' rel=\'noopener\' href=\'" + M.esc(s.labelUrl) + "\'>Étiquette PDF</a>" : "";', '      var label = s.sendcloudParcelId ? " · <button type=\'button\' data-live-label=\'" + M.esc(s.id) + "\'>Étiquette PDF</button>" : "";');
  replace(path, '      var tracking = s.trackingUrl ? "<a', '      var trackingUrl = safeTrackingUrl(s.trackingUrl);\n      var tracking = trackingUrl ? "<a');
  replace(path, 'M.esc(s.trackingUrl)', 'M.esc(trackingUrl)');
  replace(path, '.then(function (r) { return r.json(); }).catch(function () { return { shipments: [] }; })', '.then(function (r) { return r.json().then(function (d) { if (!r.ok || d.ok === false) throw new Error(d.error || "Expéditions Live indisponibles."); return d; }); })');
  replace(path, '    var form = document.getElementById("sellerSenderForm");', `    root.querySelectorAll("button[data-live-label]").forEach(function(button) {
      button.onclick = async function() {
        button.disabled = true;
        try {
          var response = await fetch((window.CARDORIA_BACKEND || location.origin) + "/api/live/seller/shipments/" + encodeURIComponent(button.dataset.liveLabel) + "/label", { headers: { Authorization: "Bearer " + M.getToken(), Accept: "application/pdf" }, cache: "no-store" });
          if (!response.ok || !(response.headers.get("content-type") || "").startsWith("application/pdf")) throw new Error("Étiquette PDF indisponible.");
          var url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
          link.href=url; link.download="etiquette-live.pdf"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function(){URL.revokeObjectURL(url);},30000);
        } catch(error) { alert(error.message); } finally { button.disabled=false; }
      };
    });
    var form = document.getElementById("sellerSenderForm");`);
}
// Write only after all anchors have been validated.
for (const [path, source] of files) fs.writeFileSync(path, source);
fs.writeFileSync("/tmp/cardoria-audit-patched-files.json", JSON.stringify([...files.keys()]));
console.log("Reviewed audit patches applied to " + files.size + " files.");
