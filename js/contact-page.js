(function () {
  "use strict";
  var btn = document.getElementById("contactSend");
  if (!btn) return;
  btn.onclick = function () {
    var email = document.getElementById("contactEmail").value;
    var name = document.getElementById("contactName").value;
    var msg = document.getElementById("contactMsg").value;
    if (!email) { alert("Indiquez votre email."); return; }
    var subject = encodeURIComponent("Contact Cardoria — " + (name || "Client"));
    var body = encodeURIComponent(msg || "");
    window.location.href = "mailto:Cardoria59330@gmail.com?subject=" + subject + "&body=" + body;
    if (window.CardoriaAnalytics) CardoriaAnalytics.trackEvent("contact_form", { method: "mailto" });
  };
})();
