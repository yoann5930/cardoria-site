(function () {
  "use strict";

  const BACKEND_URL = window.CARDORIA_BACKEND || "https://cardoria-site-2.onrender.com";
  const POKEMON_LOGO = "https://upload.wikimedia.org/wikipedia/commons/9/98/International_Pok%C3%A9mon_logo.svg";

  let products = [];
  let cart = [];

  function qs(id) {
    return document.getElementById(id);
  }

  function euro(value) {
    return Number(value || 0).toFixed(2).replace(".", ",") + " €";
  }

  function toggleMenu() {
    qs("menu")?.classList.toggle("open");
  }

  async function loadProducts() {
    try {
      const response = await fetch("/products.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Catalogue indisponible");
      products = await response.json();
    } catch (error) {
      products = [];
      const box = qs("products");
      if (box) box.innerHTML = '<p class="shop-empty">Le catalogue Pokémon est momentanément indisponible.</p>';
    }
  }

  function getPokemonProducts() {
    const query = (qs("search")?.value || "").trim().toLowerCase();
    return products.filter((product) => {
      if (product.category !== "pokemon") return false;
      if (!query) return true;
      return String(product.name || "").toLowerCase().includes(query);
    });
  }

  function renderProducts() {
    const box = qs("products");
    if (!box) return;

    const list = getPokemonProducts();
    if (!list.length) {
      box.innerHTML = '<p class="shop-empty">Aucun produit Pokémon disponible pour cette recherche.</p>';
      return;
    }

    box.innerHTML = list.map((product) => `
      <article class="product">
        <div class="product-img pokemon-product-visual">
          <img src="${POKEMON_LOGO}" alt="Pokémon" loading="lazy" decoding="async">
        </div>
        <h3>${product.name}</h3>
        <p>${product.condition} • Stock : ${product.stock}</p>
        <div class="price">${euro(product.price)}</div>
        <button class="primary" type="button" data-add-product="${product.id}" ${product.stock <= 0 ? "disabled" : ""}>Ajouter au panier</button>
      </article>
    `).join("");
  }

  function addToCart(productId) {
    const product = products.find((item) => item.id === productId);
    if (!product || product.stock <= 0) return;

    const existing = cart.find((item) => item.id === productId);
    if (existing) {
      if (existing.qty < product.stock) existing.qty += 1;
    } else {
      cart.push({ ...product, qty: 1 });
    }
    renderCart();
  }

  function renderCart() {
    const box = qs("cart");
    const total = qs("cartTotal");
    if (!box || !total) return;

    if (!cart.length) {
      box.innerHTML = "<li>Panier vide</li>";
    } else {
      box.innerHTML = cart.map((item) => `<li>${item.qty} × ${item.name} — ${euro(item.qty * item.price)}</li>`).join("");
    }

    total.textContent = euro(cart.reduce((sum, item) => sum + item.qty * item.price, 0));
  }

  async function checkoutBoutique() {
    if (!cart.length) {
      alert("Panier vide.");
      return;
    }

    const email = qs("shopEmail")?.value?.trim();
    const name = qs("shopName")?.value?.trim() || "";
    if (!email) {
      alert("Indiquez votre email pour payer.");
      return;
    }

    const items = cart.map((item) => ({ ref: item.id, name: item.name, qty: item.qty, price: item.price }));
    const attribution = window.CardoriaAttribution ? window.CardoriaAttribution.getPayload() : {};

    try {
      const response = await fetch(`${BACKEND_URL}/api/payments/boutique/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerEmail: email,
          customerName: name,
          items,
          shippingCost: 0,
          shipping: "Standard",
          successUrl: `${location.origin}/boutique.html?gamme=pokemon`,
          ...attribution
        })
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        alert(data.error || "Paiement SumUp indisponible.");
        return;
      }

      if (data.url) location.href = data.url;
      else alert("Lien de paiement SumUp non reçu.");
    } catch (error) {
      alert("Erreur : " + error.message);
    }
  }

  function showRangeOverview() {
    qs("shopRangeView")?.removeAttribute("hidden");
    qs("shopProductView")?.setAttribute("hidden", "");
  }

  async function showPokemonRange() {
    qs("shopRangeView")?.setAttribute("hidden", "");
    qs("shopProductView")?.removeAttribute("hidden");
    await loadProducts();
    renderProducts();
    renderCart();
  }

  function init() {
    qs("shopMenuButton")?.addEventListener("click", toggleMenu);
    qs("search")?.addEventListener("input", renderProducts);
    qs("shopPayButton")?.addEventListener("click", checkoutBoutique);
    qs("products")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-product]");
      if (button) addToCart(button.dataset.addProduct);
    });

    const range = new URLSearchParams(location.search).get("gamme");
    if (range === "pokemon") showPokemonRange();
    else showRangeOverview();

    if (window.CardoriaAttribution) {
      window.CardoriaAttribution.trackPageView?.();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
