(function () {
  "use strict";

  function enhanceReferenceSearch() {
    var input = document.getElementById("catSearch");
    if (!input || input.dataset.referenceSearchEnhanced === "1") return;
    input.dataset.referenceSearchEnhanced = "1";
    input.placeholder = "Nom ou référence imprimée (ex. SVPFR 031)…";
    input.setAttribute("aria-label", "Rechercher par nom, numéro ou référence imprimée, par exemple SVPFR 031");

    var filters = input.closest(".admin-filters");
    if (!filters) return;
    var help = document.createElement("small");
    help.id = "catalogReferenceSearchHelp";
    help.style.cssText = "width:100%;color:#baaf97;margin-top:2px";
    help.textContent = "Recherche par code imprimé acceptée : SVPFR 031, SVPFR031, SVPFR-031, code d’extension ou numéro de carte.";
    filters.appendChild(help);
  }

  enhanceReferenceSearch();
  var observer = new MutationObserver(enhanceReferenceSearch);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () { observer.disconnect(); }, 10000);
})();
