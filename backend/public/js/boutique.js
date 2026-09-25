(function () {
  "use strict";

  const BACKEND_URL = window.CARDORIA_BACKEND || window.location.origin;
  const TOKEN_KEY = "cardoria_session_token";
  const LEGACY_TOKEN_KEY = "cardoria_client_session";
  const CART_KEY = "cardoria_boutique_cart";
  const POKEMON_LOGO = "https://upload.wikimedia.org/wikipedia/commons/9/98/International_Pok%C3%A9mon_logo.svg";

  let products = [];
  let cart = [];
  let searchIndex = [];
  let activeSuggestion = -1;
  let searchFrame = 0;
  let lastPreviewTrigger = null;
  let selectedRelay = null;
  let cartNotices = [];

  const qs = (id) => document.getElementById(id);
  const euro = (value) => Number(value || 0).toFixed(2).replace(".", ",") + " €";
  const esc = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

  function getToken() {
    let token = localStorage.getItem(TOKEN_KEY) || "";
    if (!token) {
      token = localStorage.getItem(LEGACY_TOKEN_KEY) || "";
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem(LEGACY_TOKEN_KEY);
      }
    }
    return token;
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart.map((item) => ({ id: item.id, qty: item.qty }))));
    } catch {}
  }

  function toggleMenu() {
    qs("menu")?.classList.toggle("open");
  }

  function normalizeSearch(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toLowerCase();
  }

  function buildSearchIndex() {
    searchIndex = products
      .filter((product) => product.category === "pokemon")
      .map((product) => {
        const fields = {
          name: normalizeSearch(product.name),
          extension: normalizeSearch(product.extension),
          number: normalizeSearch(product.number),
          rarity: normalizeSearch(product.rarity),
          condition: normalizeSearch(product.condition)
        };
        return {
          product,
          fields,
          blob: [fields.name, fields.extension, fields.number, fields.rarity, fields.condition].filter(Boolean).join(" ")
        };
      });
  }

  function filterOptions(field) {
    const values = new Map();
    for (const entry of searchIndex) {
      const label = String(entry.product?.[field] || "").trim();
      const value = normalizeSearch(label);
      if (!label || !value) continue;
      const current = values.get(value);
      if (current) current.count += 1;
      else values.set(value, { value, label, count: 1 });
    }
    return [...values.values()].sort((a, b) => a.label.localeCompare(b.label, "fr", { sensitivity: "base" }));
  }

  function populateFilterSelect(id, field) {
    const select = qs(id);
    if (!select) return;
    const previous = select.value;
    const first = select.options[0]?.cloneNode(true);
    select.replaceChildren();
    if (first) select.appendChild(first);
    for (const item of filterOptions(field)) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label + " (" + item.count + ")";
      select.appendChild(option);
    }
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function buildQuickFilters() {
    populateFilterSelect("shopFilterExtension", "extension");
    populateFilterSelect("shopFilterRarity", "rarity");
    populateFilterSelect("shopFilterCondition", "condition");
  }

  function selectedQuickFilters() {
    return {
      extension: qs("shopFilterExtension")?.value || "",
      rarity: qs("shopFilterRarity")?.value || "",
      condition: qs("shopFilterCondition")?.value || "",
      availability: qs("shopFilterAvailability")?.value || ""
    };
  }

  function entryMatchesQuickFilters(entry, filters) {
    if (filters.extension && entry.fields.extension !== filters.extension) return false;
    if (filters.rarity && entry.fields.rarity !== filters.rarity) return false;
    if (filters.condition && entry.fields.condition !== filters.condition) return false;
    if (filters.availability) {
      const available = Number(entry.product.stock || 0) > 0 && !!entry.product.purchasable;
      if (filters.availability === "available" && !available) return false;
      if (filters.availability === "unavailable" && available) return false;
    }
    return true;
  }

  function hasActiveQuickFilters() {
    const filters = selectedQuickFilters();
    return Boolean(filters.extension || filters.rarity || filters.condition || filters.availability);
  }

  function scoreSearchEntry(entry, terms, fullQuery) {
    if (!terms.length) return 0;
    if (!terms.every((term) => entry.blob.includes(term))) return -1;

    const f = entry.fields;
    let score = 0;
    if (f.name === fullQuery) score += 120;
    if (f.number === fullQuery) score += 90;
    if (f.extension === fullQuery) score += 70;

    for (const term of terms) {
      if (f.name.startsWith(term)) score += 45;
      else if (f.name.includes(term)) score += 30;
      if (f.number === term) score += 40;
      else if (f.number.includes(term)) score += 20;
      if (f.extension.startsWith(term)) score += 22;
      else if (f.extension.includes(term)) score += 14;
      if (f.rarity.includes(term)) score += 12;
      if (f.condition.includes(term)) score += 5;
    }

    if (Number(entry.product.stock || 0) > 0) score += 2;
    if (entry.product.purchasable) score += 2;
    return score;
  }

  function getPokemonProducts() {
    const query = normalizeSearch(qs("search")?.value || "");
    const terms = query ? query.split(/\s+/).filter(Boolean) : [];
    const filters = selectedQuickFilters();

    return searchIndex
      .map((entry, position) => ({
        entry,
        product: entry.product,
        position,
        score: query ? scoreSearchEntry(entry, terms, query) : 0
      }))
      .filter((item) => item.score >= 0 && entryMatchesQuickFilters(item.entry, filters))
      .sort((a, b) => b.score - a.score || a.position - b.position)
      .map((item) => item.product);
  }

  function setSuggestionsOpen(open) {
    const results = qs("shopQuickResults");
    const input = qs("search");
    if (results) results.hidden = !open;
    if (input) input.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) activeSuggestion = -1;
  }

  function updateSuggestionSelection(options) {
    options.forEach((option, index) => {
      const selected = index === activeSuggestion;
      option.setAttribute("aria-selected", selected ? "true" : "false");
      option.classList.toggle("is-active", selected);
      if (selected) option.scrollIntoView({ block: "nearest" });
    });
  }

  function renderQuickSuggestions(matches) {
    const results = qs("shopQuickResults");
    const input = qs("search");
    if (!results || !input) return;

    const query = normalizeSearch(input.value);
    if (!query || document.activeElement !== input) {
      results.replaceChildren();
      setSuggestionsOpen(false);
      return;
    }

    const suggestions = matches.slice(0, 6);
    if (!suggestions.length) {
      results.innerHTML = '<div class="shop-quick-empty">Aucun produit correspondant.</div>';
      setSuggestionsOpen(true);
      return;
    }

    results.innerHTML = suggestions.map((product, index) => {
      const image = product.image || POKEMON_LOGO;
      const meta = [product.extension, product.number ? "#" + product.number : "", product.rarity].filter(Boolean).join(" · ");
      const stock = Math.max(0, Number(product.stock || 0));
      return '<button class="shop-quick-option" type="button" role="option" aria-selected="false" data-quick-product="' + esc(product.id) + '" data-quick-index="' + index + '">' +
        '<img src="' + esc(image) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'' + POKEMON_LOGO + '\'">' +
        '<span class="shop-quick-copy"><strong>' + esc(product.name || "Produit Pokémon") + '</strong><small>' + esc(meta || "Pokémon") + '</small></span>' +
        '<span class="shop-quick-side"><strong>' + (Number(product.price || 0) > 0 ? euro(product.price) : "Prix à définir") + '</strong><small>' + (stock > 0 ? stock + " en stock" : "Indisponible") + '</small></span>' +
      '</button>';
    }).join("");

    activeSuggestion = -1;
    setSuggestionsOpen(true);
  }

  function updateSearchMeta(matches) {
    const count = qs("shopSearchCount");
    const input = qs("search");
    if (!count || !input) return;
    const query = input.value.trim();
    if (!query) {
      count.textContent = matches.length + (matches.length > 1 ? (hasActiveQuickFilters() ? " produits filtrés" : " produits disponibles") : (hasActiveQuickFilters() ? " produit filtré" : " produit disponible"));
      return;
    }
    count.textContent = matches.length + (matches.length > 1 ? " résultats" : " résultat") + ' pour "' + query + '"';
  }

  function renderProducts() {
    const container = qs("products");
    if (!container) return;

    const matches = getPokemonProducts();
    updateSearchMeta(matches);
    renderQuickSuggestions(matches);

    if (!matches.length) {
      container.innerHTML = '<p class="shop-empty">Aucun produit Pokémon ne correspond à votre recherche.</p>';
      return;
    }

    container.innerHTML = matches.map((product) => {
      const image = product.image || POKEMON_LOGO;
      const meta = [product.extension, product.number ? "#" + product.number : "", product.rarity].filter(Boolean).join(" · ");
      const stock = Math.max(0, Number(product.stock || 0));
      const canBuy = !!product.purchasable && stock > 0 && Number(product.price || 0) > 0;
      const availability = product.availability || (stock <= 0 ? "out" : stock <= Number(product.lowStockThreshold || 2) ? "low" : "available");
      const stockLabel = product.availabilityLabel || (availability === "out" ? "Rupture de stock" : availability === "low" ? ("Plus que " + stock + " en stock") : "En stock");
      return '<article class="product" data-product-id="' + esc(product.id) + '" data-preview-product="' + esc(product.id) + '">' +
        '<div class="product-img pokemon-product-visual" data-preview-product="' + esc(product.id) + '" role="button" tabindex="0">' +
          '<img src="' + esc(image) + '" alt="' + esc(product.name || "Produit Pokémon") + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + POKEMON_LOGO + '\'">' +
        '</div>' +
        '<h3 class="product-name">' + esc(product.name) + '</h3>' +
        (meta ? '<p class="product-meta">' + esc(meta) + '</p>' : '') +
        '<div class="product-stock-row"><span class="product-condition">État : ' + esc(product.condition || "Non renseigné") + '</span><span class="product-stock is-' + esc(availability) + '">' + esc(stockLabel) + '</span></div>' +
        '<div class="price">' + (Number(product.price || 0) > 0 ? euro(product.price) : "Prix à définir") + '</div>' +
        '<button class="primary" type="button" data-add-product="' + esc(product.id) + '" ' + (canBuy ? "" : "disabled") + '>' + (canBuy ? "Ajouter au panier" : "Indisponible") + '</button>' +
      '</article>';
    }).join("");
  }

  function scheduleSearchRender() {
    if (searchFrame) cancelAnimationFrame(searchFrame);
    searchFrame = requestAnimationFrame(() => {
      searchFrame = 0;
      renderProducts();
    });
  }

  function selectQuickProduct(id) {
    const product = products.find((item) => String(item.id) === String(id));
    const input = qs("search");
    if (!product || !input) return;

    input.value = product.name || "";
    renderProducts();
    setSuggestionsOpen(false);

    requestAnimationFrame(() => {
      const card = document.querySelector('[data-product-id="' + CSS.escape(String(product.id)) + '"]');
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.classList.add("is-search-target");
      window.setTimeout(() => card?.classList.remove("is-search-target"), 1400);
    });
  }

  function handleSearchKeydown(event) {
    const results = qs("shopQuickResults");
    const options = results ? Array.from(results.querySelectorAll(".shop-quick-option")) : [];

    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      return;
    }

    if (!options.length || results?.hidden) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeSuggestion = (activeSuggestion + 1) % options.length;
      updateSuggestionSelection(options);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeSuggestion = activeSuggestion <= 0 ? options.length - 1 : activeSuggestion - 1;
      updateSuggestionSelection(options);
      return;
    }

    if (event.key === "Enter" && activeSuggestion >= 0) {
      event.preventDefault();
      options[activeSuggestion]?.click();
    }
  }

  async function loadProducts() {
    const response = await fetch(BACKEND_URL + "/api/payments/boutique/products", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.products)) {
      throw new Error(data.error || "Stock Boutique indisponible");
    }

    products = data.products;
    buildSearchIndex();
    buildQuickFilters();

    if (!cart.length) {
      try {
        const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
        if (Array.isArray(saved)) cart = saved;
      } catch {}
    }

    cartNotices = syncCartQuantities();
  }

  function syncCartQuantities() {
    const notices = [];
    const next = [];
    cart.forEach((item) => {
      const product = products.find((candidate) => String(candidate.id) === String(item.id));
      const previousQty = Math.max(1, Number(item.qty || 1));
      if (!product || !product.purchasable || Number(product.stock || 0) <= 0) {
        notices.push((item.name || "Article") + " n’est plus disponible.");
        return;
      }
      const available = Math.max(0, Number(product.stock || 0));
      const qty = Math.min(previousQty, available);
      if (qty < previousQty) {
        notices.push("La quantité disponible pour " + (product.name || item.name || "cet article") + " est maintenant de " + qty + ".");
      }
      next.push({ ...product, qty });
    });
    cart = next;
    saveCart();
    return notices;
  }

  function ensurePreviewModal() {
    if (qs("cardPreviewModal")) return;
    const modal = document.createElement("div");
    modal.id = "cardPreviewModal";
    modal.className = "card-preview-modal";
    modal.hidden = true;
    modal.innerHTML = '<div class="card-preview-dialog" role="dialog" aria-modal="true"><button class="card-preview-close" id="cardPreviewClose" type="button">×</button><div class="card-preview-visual"><img id="cardPreviewImage"></div><div class="card-preview-copy"><h2 id="cardPreviewTitle"></h2><p id="cardPreviewMeta"></p><p id="cardPreviewCondition"></p><p id="cardPreviewPrice"></p></div></div>';
    document.body.appendChild(modal);
    qs("cardPreviewClose")?.addEventListener("click", closeCardPreview);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeCardPreview();
    });
  }

  function openCardPreview(id, trigger) {
    const product = products.find((item) => String(item.id) === String(id));
    if (!product) return;
    ensurePreviewModal();
    const modal = qs("cardPreviewModal");
    qs("cardPreviewImage").src = product.image || POKEMON_LOGO;
    qs("cardPreviewTitle").textContent = product.name || "Produit Pokémon";
    qs("cardPreviewMeta").textContent = [product.extension, product.number ? "#" + product.number : "", product.rarity].filter(Boolean).join(" · ");
    qs("cardPreviewCondition").textContent = "État : " + (product.condition || "Non renseigné");
    qs("cardPreviewPrice").textContent = euro(product.price);
    lastPreviewTrigger = trigger;
    modal.hidden = false;
  }

  function closeCardPreview() {
    const modal = qs("cardPreviewModal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    lastPreviewTrigger?.focus?.();
    lastPreviewTrigger = null;
  }

  function addToCart(id) {
    const product = products.find((item) => String(item.id) === String(id));
    if (!product || !product.purchasable || Number(product.stock || 0) <= 0) return;
    const existing = cart.find((item) => String(item.id) === String(id));
    if (existing) {
      if (existing.qty < Number(product.stock || 0)) existing.qty++;
    } else {
      cart.push({ ...product, qty: 1 });
    }
    saveCart();
    renderCart();
  }

  function renderCart() {
    const container = qs("cart");
    const total = qs("cartTotal");
    if (!container || !total) return;
    const notices = (cartNotices || []).map((text) => '<li class="shop-cart-notice">' + esc(text) + "</li>").join("");
    container.innerHTML = notices + (cart.length
      ? cart.map((item) => '<li>' + item.qty + " × " + esc(item.name) + " — " + euro(item.qty * item.price) + '</li>').join("")
      : "<li>Panier vide</li>");
    total.textContent = euro(cart.reduce((sum, item) => sum + item.qty * item.price, 0));
  }

  function shippingMethod() {
    return document.querySelector('input[name="shopShippingMethod"]:checked')?.value || "colissimo_home";
  }

  function renderRelaySummary() {
    const box = qs("shopRelayBox");
    const summary = qs("shopRelaySummary");
    const relay = shippingMethod() === "mondial_relay";
    if (box) box.hidden = !relay;
    if (!summary) return;
    if (!selectedRelay) {
      summary.textContent = "Aucun Point Relais sélectionné.";
      return;
    }
    summary.textContent = [selectedRelay.name, selectedRelay.id ? "n° " + selectedRelay.id : "", selectedRelay.address, selectedRelay.postalCode, selectedRelay.city].filter(Boolean).join(" — ");
  }

  function closeRelayModal() {
    const modal = qs("shopRelayModal");
    if (modal) modal.hidden = true;
  }

  function pickRelay(point) {
    var carrierServicePointId = String(point.carrierServicePointId || point.id || "").trim();
    var sendcloudServicePointId = String(point.id || "").trim();
    selectedRelay = {
      id: carrierServicePointId,
      carrierServicePointId: carrierServicePointId,
      sendcloudServicePointId: sendcloudServicePointId,
      name: point.name || "",
      address: [point.street, point.houseNumber].filter(Boolean).join(" ") || point.address || "",
      postalCode: point.postalCode || "",
      city: point.city || "",
      countryCode: point.countryCode || "FR",
      carrierCode: "mondial_relay"
    };
    renderRelaySummary();
    closeRelayModal();
  }

  async function chooseRelay() {
    const message = qs("shopPayMsg");
    const postalCode = qs("shopPostalCode")?.value?.trim() || "";
    const city = qs("shopCity")?.value?.trim() || "";
    if (!postalCode && !city) {
      if (message) message.textContent = "Renseignez le code postal ou la ville pour trouver un Point Relais.";
      return;
    }
    try {
      if (message) message.textContent = "Recherche des Points Relais Mondial Relay...";
      const response = await fetch(BACKEND_URL + "/api/sendcloud/service-points?" + new URLSearchParams({
        postalCode,
        city,
        countryCode: "FR",
        limit: "10",
        radius: "15000"
      }), { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || "Recherche Point Relais indisponible.");
      const points = Array.isArray(data.points) ? data.points : [];
      if (!points.length) throw new Error("Aucun Point Relais Mondial Relay trouvé près de cette adresse.");
      const list = qs("shopRelayModalList");
      const status = qs("shopRelayModalStatus");
      const modal = qs("shopRelayModal");
      if (!list || !modal) throw new Error("Fenêtre Point Relais indisponible.");
      list.replaceChildren();
      if (status) status.textContent = points.length + " Point Relais trouvé" + (points.length > 1 ? "s" : "") + ".";
      points.forEach((point) => {
        const card = document.createElement("article");
        card.className = "shop-relay-choice";
        const title = document.createElement("strong");
        title.textContent = point.name || "Point Relais";
        const address = document.createElement("p");
        address.textContent = [point.street, point.houseNumber].filter(Boolean).join(" ");
        const cityLine = document.createElement("p");
        cityLine.textContent = [point.postalCode, point.city, (point.carrierServicePointId||point.id) ? "n° " + (point.carrierServicePointId||point.id) : ""].filter(Boolean).join(" ");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "shop-pay";
        button.textContent = "Choisir ce Point Relais";
        button.addEventListener("click", () => pickRelay(point));
        card.append(title, address, cityLine, button);
        list.appendChild(card);
      });
      modal.hidden = false;
      if (message) message.textContent = "";
    } catch (error) {
      if (message) message.textContent = error.message;
    }
  }

  function customerPayload() {
    const payload = {
      customerName: qs("shopName")?.value?.trim() || "",
      customerEmail: qs("shopEmail")?.value?.trim() || "",
      customerPhone: qs("shopPhone")?.value?.trim() || "",
      address: qs("shopAddress")?.value?.trim() || "",
      postalCode: qs("shopPostalCode")?.value?.trim() || "",
      city: qs("shopCity")?.value?.trim() || "",
      country: qs("shopCountry")?.value?.trim() || "France",
      shippingMethod: shippingMethod()
    };
    if (!payload.customerName || !payload.customerEmail || !payload.customerPhone) {
      throw new Error("Nom, email et téléphone sont obligatoires.");
    }
    if (!/^\S+@\S+\.\S+$/.test(payload.customerEmail)) throw new Error("Adresse email invalide.");
    if (payload.shippingMethod === "mondial_relay") {
      if (!selectedRelay || !selectedRelay.id) throw new Error("Choisissez un Point Relais Mondial Relay.");
      payload.pickupPoint = selectedRelay;
      payload.shipping = "Mondial Relay Point Relais";
      if (!payload.postalCode) payload.postalCode = selectedRelay.postalCode;
      if (!payload.city) payload.city = selectedRelay.city;
    } else {
      if (!payload.address || !payload.postalCode || !payload.city) {
        throw new Error("Nom, email, téléphone et adresse complète sont obligatoires.");
      }
      payload.shipping = "Colissimo domicile";
    }
    return payload;
  }

  async function checkoutBoutique() {
    if (!cart.length) return alert("Panier vide.");
    const button = qs("shopPayButton");
    const message = qs("shopPayMsg");
    try {
      const customer = customerPayload();
      button.disabled = true;
      if (message) message.textContent = "Vérification du stock...";
      await loadProducts();
      renderProducts();
      renderCart();
      if (!cart.length) throw new Error("Les articles du panier ne sont plus disponibles.");

      const items = cart.map((item) => ({ ref: item.id, qty: item.qty }));
      const attribution = window.CardoriaAttribution ? window.CardoriaAttribution.getPayload() : {};
      const token = getToken();
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = "Bearer " + token;

      const response = await fetch(BACKEND_URL + "/api/payments/boutique/checkout", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...customer,
          items,
          provider:"sumup",
          shippingCost: 0,
          shippingMethod: customer.shippingMethod,
          pickupPoint: customer.pickupPoint || null,
          shipping: customer.shipping,
          successUrl: location.origin + "/boutique.html?gamme=pokemon",
          ...attribution
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Paiement SumUp indisponible.");
      if (!data.url) throw new Error("Lien de paiement SumUp non reçu.");

      sessionStorage.setItem("cardoria_sumup_checkout", data.checkoutId || "");
      sessionStorage.setItem("cardoria_sumup_order", data.orderId || "");
      if (message) message.textContent = "Ouverture du paiement SumUp...";
      location.href = data.url;
    } catch (error) {
      if (message) message.textContent = error.message || "Paiement impossible.";
      alert(error.message || "Paiement impossible.");
      try {
        await loadProducts();
        renderProducts();
        renderCart();
      } catch {}
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function confirmReturnedPayment() {
    const params = new URLSearchParams(location.search);
    const order = params.get("order");
    const checkout = sessionStorage.getItem("cardoria_sumup_checkout");
    if (params.get("paid") !== "1" || !order || !checkout) return;

    const message = qs("shopPayMsg");
    try {
      if (message) message.textContent = "Vérification du paiement SumUp...";
      const response = await fetch(BACKEND_URL + "/api/payments/sumup/confirm/" + encodeURIComponent(checkout), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Vérification SumUp impossible.");

      if (data.status === "paid") {
        cart = [];
        saveCart();
        renderCart();
        sessionStorage.removeItem("cardoria_sumup_checkout");
        sessionStorage.removeItem("cardoria_sumup_order");
        if (message) message.textContent = "Paiement SumUp confirmé. Commande " + order + ".";
      } else if (message) {
        message.textContent = data.status === "failed"
          ? "Le paiement SumUp a échoué ou a été annulé."
          : data.status === "refunded"
            ? "Ce paiement SumUp a été remboursé."
            : "Paiement SumUp en cours de confirmation.";
      }
    } catch (error) {
      if (message) message.textContent = error.message || "Vérification du paiement impossible.";
    }
  }

  async function restoreClientProfile() {
    const token = getToken();
    if (!token) return;
    try {
      const response = await fetch(BACKEND_URL + "/api/auth/me", {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok || !data.ok || data.user?.role !== "client") return;

      const user = data.user;
      const map = [
        ["shopName", user.name],
        ["shopEmail", user.email],
        ["shopPhone", user.phone],
        ["shopAddress", user.addressLine1],
        ["shopPostalCode", user.postalCode],
        ["shopCity", user.city],
        ["shopCountry", user.country === "FR" ? "France" : user.country]
      ];
      for (const [id, value] of map) {
        if (qs(id) && value) qs(id).value = value;
      }

      if (user.relay && user.relay.id && user.relay.sendcloudServicePointId) {
        selectedRelay = {
          id: String(user.relay.id),
          carrierServicePointId: user.relay.carrierServicePointId || String(user.relay.id),
          sendcloudServicePointId: String(user.relay.sendcloudServicePointId),
          name: user.relay.name || "",
          address: user.relay.address || "",
          postalCode: user.relay.postalCode || "",
          city: user.relay.city || "",
          countryCode: user.relay.countryCode || "FR",
          carrierCode: "mondial_relay"
        };
        const relayRadio = document.querySelector('input[name="shopShippingMethod"][value="mondial_relay"]');
        if (user.shippingPreference === "mondial_relay" && relayRadio) relayRadio.checked = true;
        renderRelaySummary();
      } else if (user.shippingPreference === "mondial_relay") {
        const relayRadio = document.querySelector('input[name="shopShippingMethod"][value="mondial_relay"]');
        if (relayRadio) relayRadio.checked = true;
        selectedRelay = null;
        renderRelaySummary();
      }
      const account = document.querySelector(".shop-client-account");
      if (account) {
        account.setAttribute("aria-label", "Ouvrir mon espace client");
        const spans = account.querySelectorAll("span");
        if (spans[1]) spans[1].textContent = user.name || "Mon compte";
      }
    } catch {}
  }

  function showRangeOverview() {
    qs("shopRangeView")?.removeAttribute("hidden");
    qs("shopProductView")?.setAttribute("hidden", "");
  }

  async function showPokemonRange() {
    qs("shopRangeView")?.setAttribute("hidden", "");
    qs("shopProductView")?.removeAttribute("hidden");
    try {
      await loadProducts();
      renderProducts();
      renderCart();
    } catch {
      const container = qs("products");
      if (container) container.innerHTML = '<p class="shop-empty">Le stock Boutique est temporairement indisponible.</p>';
    }
  }

  function initQuickSearch() {
    const input = qs("search");
    const clear = qs("shopSearchClear");
    const results = qs("shopQuickResults");
    if (!input || !results) return;

    input.addEventListener("input", scheduleSearchRender);
    input.addEventListener("focus", renderProducts);
    input.addEventListener("keydown", handleSearchKeydown);

    clear?.addEventListener("click", () => {
      input.value = "";
      renderProducts();
      input.focus();
    });

    ["shopFilterExtension", "shopFilterRarity", "shopFilterCondition", "shopFilterAvailability"].forEach((id) => {
      qs(id)?.addEventListener("change", () => {
        setSuggestionsOpen(false);
        renderProducts();
      });
    });

    qs("shopFilterReset")?.addEventListener("click", () => {
      input.value = "";
      ["shopFilterExtension", "shopFilterRarity", "shopFilterCondition", "shopFilterAvailability"].forEach((id) => {
        const select = qs(id);
        if (select) select.value = "";
      });
      setSuggestionsOpen(false);
      renderProducts();
      input.focus();
    });

    results.addEventListener("pointerdown", (event) => {
      const option = event.target.closest("[data-quick-product]");
      if (!option) return;
      event.preventDefault();
      selectQuickProduct(option.dataset.quickProduct);
    });

    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".shop-product-search")) setSuggestionsOpen(false);
    });
  }

  function init() {
    qs("shopMenuButton")?.addEventListener("click", toggleMenu);
    qs("shopPayButton")?.addEventListener("click", checkoutBoutique);
    qs("shopChooseRelay")?.addEventListener("click", chooseRelay);
    qs("shopRelayModalClose")?.addEventListener("click", closeRelayModal);
    qs("shopRelayModal")?.addEventListener("click", (event) => {
      if (event.target === qs("shopRelayModal")) closeRelayModal();
    });
    document.querySelectorAll('input[name="shopShippingMethod"]').forEach((input) => {
      input.addEventListener("change", renderRelaySummary);
    });
    renderRelaySummary();
    qs("products")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-product]");
      if (button) {
        addToCart(button.dataset.addProduct);
        return;
      }
      const preview = event.target.closest("[data-preview-product]");
      if (preview) openCardPreview(preview.dataset.previewProduct, preview);
    });

    ensurePreviewModal();
    initQuickSearch();
    restoreClientProfile();

    if (new URLSearchParams(location.search).get("gamme") === "pokemon") showPokemonRange();
    else showRangeOverview();

    confirmReturnedPayment();
    window.CardoriaAttribution?.trackPageView?.();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
