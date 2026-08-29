(function () {
  "use strict";

  function value(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function buildSellUrl() {
    var params = new URLSearchParams();
    var cardId = value("cardId");
    var cardName = value("cardName");
    var cardGame = value("cardGame");
    var condition = value("cardCondition");
    var customerName = value("customerName");
    var customerEmail = value("customerEmail");

    if (cardId) params.set("card", cardId);
    if (cardName) params.set("name", cardName);
    if (cardGame) params.set("game", cardGame);
    if (condition) params.set("condition", condition);
    if (customerName) params.set("customerName", customerName);
    if (customerEmail) params.set("customerEmail", customerEmail);
    params.set("source", "estimation");

    return "/rachat-cartes.html?" + params.toString();
  }

  function ensureSellAction() {
    var result = document.getElementById("estimateResult");
    if (!result) return;

    var text = (result.textContent || "").trim();
    if (!text || /Analyse IA Cardoria en cours|Erreur/i.test(text)) return;
    if (document.getElementById("estimateSellAction")) return;

    var box = document.createElement("div");
    box.id = "estimateSellAction";
    box.className = "estimate-sell-action";
    box.innerHTML =
      '<div class="estimate-sell-action__copy">' +
        '<span>Vous souhaitez la vendre ?</span>' +
        '<strong>Proposez cette carte à Cardoria</strong>' +
        '<p>Les informations déjà renseignées sont reprises automatiquement.</p>' +
      '</div>' +
      '<a class="estimate-sell-action__button" href="' + buildSellUrl() + '">Vendre cette carte à Cardoria</a>';

    result.insertAdjacentElement("afterend", box);
  }

  function init() {
    var result = document.getElementById("estimateResult");
    if (!result) return;

    var observer = new MutationObserver(function () {
      window.setTimeout(ensureSellAction, 50);
    });
    observer.observe(result, { childList: true, subtree: true, characterData: true });

    ["cardName", "cardGame", "cardCondition", "customerName", "customerEmail", "cardId"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", function () {
        var button = document.querySelector("#estimateSellAction .estimate-sell-action__button");
        if (button) button.href = buildSellUrl();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
