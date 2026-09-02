(function () {
  "use strict";

  const BACKEND_URL = window.CARDORIA_BACKEND || window.location.origin;
  const POKEMON_LOGO = "https://upload.wikimedia.org/wikipedia/commons/9/98/International_Pok%C3%A9mon_logo.svg";
  let products = [];
  let cart = [];

  function qs(id) { return document.getElementById(id); }
  function euro(value) { return Number(value || 0).toFixed(2).replace(".", ",") + " €"; }
  function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function toggleMenu() { qs("menu")?.classList.toggle("open"); }

  async function loadProducts() {
    const response = await fetch(`${BACKEND_URL}/api/payments/boutique/products`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.products)) throw new Error(data.error || "Stock Boutique indisponible");
    products = data.products;
    cart = cart.map((item) => {
      const live = products.find((p) => String(p.id) === String(item.id));
      if (!live || !live.purchasable || Number(live.stock || 0) <= 0) return null;
      return { ...live, qty: Math.min(item.qty, Number(live.stock || 0)) };
    }).filter(Boolean);
  }

  function getPokemonProducts() {
    const query = (qs("search")?.value || "").trim().toLowerCase();
    return products.filter((product) => product.category === "pokemon" && (!query || [product.name, product.extension, product.number, product.rarity, product.condition].join(" ").toLowerCase().includes(query)));
  }

  function renderProducts() {
    const box = qs("products");
    if (!box) return;
    const list = getPokemonProducts();
    if (!list.length) { box.innerHTML = '<p class="shop-empty">Aucun produit Pokémon disponible.</p>'; return; }
    box.innerHTML = list.map((product) => {
      const image = product.image || POKEMON_LOGO;
      const meta = [product.extension, product.number ? `#${product.number}` : "", product.rarity].filter(Boolean).join(" · ");
      const canBuy = !!product.purchasable && Number(product.stock || 0) > 0 && Number(product.price || 0) > 0;
      return `<article class="product"><div class="product-img pokemon-product-visual"><img src="${esc(image)}" alt="${esc(product.name || "Produit Pokémon")}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${POKEMON_LOGO}'"></div><h3>${esc(product.name)}</h3>${meta ? `<p>${esc(meta)}</p>` : ""}<p>${esc(product.condition || "Non renseigné")} • Stock disponible : ${Number(product.stock || 0)}</p><div class="price">${Number(product.price || 0) > 0 ? euro(product.price) : "Prix à définir"}</div><button class="primary" type="button" data-add-product="${esc(product.id)}" ${canBuy ? "" : "disabled"}>${canBuy ? "Ajouter au panier" : "Indisponible"}</button></article>`;
    }).join("");
  }

  function addToCart(productId) {
    const product = products.find((item) => String(item.id) === String(productId));
    if (!product || !product.purchasable || Number(product.stock || 0) <= 0) return;
    const existing = cart.find((item) => String(item.id) === String(productId));
    if (existing) { if (existing.qty < Number(product.stock || 0)) existing.qty += 1; }
    else cart.push({ ...product, qty: 1 });
    renderCart();
  }

  function renderCart() {
    const box = qs("cart"), total = qs("cartTotal");
    if (!box || !total) return;
    box.innerHTML = cart.length ? cart.map((item) => `<li>${item.qty} × ${esc(item.name)} — ${euro(item.qty * item.price)}</li>`).join("") : "<li>Panier vide</li>";
    total.textContent = euro(cart.reduce((sum, item) => sum + item.qty * item.price, 0));
  }

  function customerPayload() {
    const payload = {
      customerName: qs("shopName")?.value?.trim() || "",
      customerEmail: qs("shopEmail")?.value?.trim() || "",
      customerPhone: qs("shopPhone")?.value?.trim() || "",
      address: qs("shopAddress")?.value?.trim() || "",
      postalCode: qs("shopPostalCode")?.value?.trim() || "",
      city: qs("shopCity")?.value?.trim() || "",
      country: qs("shopCountry")?.value?.trim() || "France"
    };
    if (!payload.customerName || !payload.customerEmail || !payload.customerPhone || !payload.address || !payload.postalCode || !payload.city) throw new Error("Nom, email, téléphone et adresse complète sont obligatoires.");
    if (!/^\S+@\S+\.\S+$/.test(payload.customerEmail)) throw new Error("Adresse email invalide.");
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
      const response = await fetch(`${BACKEND_URL}/api/payments/boutique/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...customer, items, shipping: "Standard", successUrl: `${location.origin}/boutique.html?gamme=pokemon`, ...attribution })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Paiement Revolut indisponible.");
      if (!data.url) throw new Error("Lien de paiement Revolut non reçu.");
      if (message) message.textContent = data.environment === "sandbox" ? "Ouverture du paiement Revolut Sandbox..." : "Ouverture du paiement Revolut...";
      location.href = data.url;
    } catch (error) {
      if (message) message.textContent = error.message || "Paiement impossible.";
      alert(error.message || "Paiement impossible.");
      try { await loadProducts(); renderProducts(); renderCart(); } catch {}
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function confirmReturnedPayment() {
    const params = new URLSearchParams(location.search);
    const orderId = params.get("order");
    if (params.get("paid") !== "1" || !orderId) return;
    const message = qs("shopPayMsg");
    try {
      if (message) message.textContent = "Vérification du paiement Revolut...";
      const response = await fetch(`${BACKEND_URL}/api/payments/revolut/confirm-order/${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Vérification Revolut impossible.");
      if (data.status === "paid") {
        cart = [];
        renderCart();
        if (message) message.textContent = `Paiement Revolut confirmé. Commande ${orderId}.`;
      } else if (data.status === "failed") {
        if (message) message.textContent = "Le paiement Revolut a échoué ou a été annulé.";
      } else if (data.status === "refunded") {
        if (message) message.textContent = "Ce paiement Revolut a été remboursé.";
      } else {
        if (message) message.textContent = "Paiement Revolut en cours de confirmation.";
      }
    } catch (error) {
      if (message) message.textContent = error.message || "Vérification du paiement impossible.";
    }
  }

  function showRangeOverview() { qs("shopRangeView")?.removeAttribute("hidden"); qs("shopProductView")?.setAttribute("hidden", ""); }
  async function showPokemonRange() {
    qs("shopRangeView")?.setAttribute("hidden", ""); qs("shopProductView")?.removeAttribute("hidden");
    try { await loadProducts(); renderProducts(); renderCart(); } catch { const box = qs("products"); if (box) box.innerHTML = '<p class="shop-empty">Le stock Pokémon est momentanément indisponible.</p>'; }
  }

  function init() {
    qs("shopMenuButton")?.addEventListener("click", toggleMenu);
    qs("search")?.addEventListener("input", renderProducts);
    qs("shopPayButton")?.addEventListener("click", checkoutBoutique);
    qs("products")?.addEventListener("click", (event) => { const button = event.target.closest("[data-add-product]"); if (button) addToCart(button.dataset.addProduct); });
    const range = new URLSearchParams(location.search).get("gamme");
    if (range === "pokemon") showPokemonRange(); else showRangeOverview();
    confirmReturnedPayment();
    if (window.CardoriaAttribution) window.CardoriaAttribution.trackPageView?.();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
