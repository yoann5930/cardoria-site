(function () {
  "use strict";

  var ESTIMATED = [
    { name: "Dracaufeu Holo", game: "Pokémon", extension: "Base Set", value: 89.9, emoji: "🔥", state: "Good" },
    { name: "Luffy Rare", game: "One Piece", extension: "Romance Dawn", value: 24.9, emoji: "🏴‍☠️", state: "Near Mint" },
    { name: "Dragon Blanc aux Yeux Bleus", game: "Yu-Gi-Oh!", extension: "LOB", value: 14.9, emoji: "🐉", state: "Played" },
    { name: "Pikachu Promo", game: "Pokémon", extension: "Évolutions", value: 19.9, emoji: "⚡", state: "Excellent" },
    { name: "Elsa — Reine des Neiges", game: "Lorcana", extension: "Chapitre 1", value: 18.9, emoji: "❄️", state: "Near Mint" },
    { name: "Goku Super Rare", game: "Dragon Ball", extension: "FB-01", value: 31.5, emoji: "🥋", state: "Excellent" },
    { name: "Force de la Volonté", game: "Magic", extension: "Modern Horizons", value: 34.0, emoji: "🔮", state: "Near Mint" },
    { name: "Mickey Mouse — Enchanté", game: "Disney", extension: "Lorcana Ch.1", value: 22.0, emoji: "🏰", state: "Excellent" }
  ];

  var SOLD = [
    { name: "Pikachu Promo", game: "Pokémon", extension: "Évolutions", price: 19.9, emoji: "⚡", date: "28 juin 2026" },
    { name: "Dracaufeu Holo", game: "Pokémon", extension: "Base Set", price: 89.9, emoji: "🔥", date: "27 juin 2026" },
    { name: "Luffy Rare", game: "One Piece", extension: "Romance Dawn", price: 24.9, emoji: "🏴‍☠️", date: "26 juin 2026" },
    { name: "Dragon Blanc aux Yeux Bleus", game: "Yu-Gi-Oh!", extension: "LOB", price: 14.9, emoji: "🐉", date: "25 juin 2026" },
    { name: "Elsa — Reine des Neiges", game: "Lorcana", extension: "Chapitre 1", price: 18.9, emoji: "❄️", date: "24 juin 2026" },
    { name: "Mew ex", game: "Pokémon", extension: "151", price: 42.5, emoji: "💎", date: "23 juin 2026" },
    { name: "Goku Super Rare", game: "Dragon Ball", extension: "FB-01", price: 31.5, emoji: "🥋", date: "22 juin 2026" },
    { name: "Force de la Volonté", game: "Magic", extension: "Modern Horizons", price: 34.0, emoji: "🔮", date: "21 juin 2026" }
  ];

  function euro(n) {
    return Number(n || 0).toFixed(2).replace(".", ",") + " €";
  }

  function estimatedHtml(item) {
    return (
      '<article class="card-item card-item--estimate" itemscope itemtype="https://schema.org/Product">' +
      '<div class="card-item-img" aria-hidden="true">' + item.emoji + "</div>" +
      '<div class="card-item-body">' +
      '<h3 itemprop="name">' + item.name + "</h3>" +
      '<p class="card-item-ext"><span itemprop="category">' + item.game + "</span> • " + item.extension + "</p>" +
      '<p class="card-item-meta">État : ' + item.state + "</p>" +
      '<p class="card-item-price">Estimation <strong itemprop="offers" itemscope itemtype="https://schema.org/Offer">' +
      '<span itemprop="price" content="' + item.value + '">' + euro(item.value) + "</span>" +
      '<meta itemprop="priceCurrency" content="EUR"></strong></p>' +
      '<a class="btn btn-primary btn-sm" href="pages/estimation/">Demander une estimation</a>' +
      "</div></article>"
    );
  }

  function soldHtml(item) {
    return (
      '<article class="card-item card-item--sold" itemscope itemtype="https://schema.org/Product">' +
      '<span class="card-sold-badge">Vendu</span>' +
      '<div class="card-item-img" aria-hidden="true">' + item.emoji + "</div>" +
      '<div class="card-item-body">' +
      '<h3 itemprop="name">' + item.name + "</h3>" +
      '<p class="card-item-ext">' + item.game + " • " + item.extension + "</p>" +
      '<p class="card-item-meta">Vendu le ' + item.date + "</p>" +
      '<p class="card-item-price">Prix de vente <strong itemprop="offers" itemscope itemtype="https://schema.org/Offer">' +
      '<span itemprop="price" content="' + item.price + '">' + euro(item.price) + "</span>" +
      '<meta itemprop="priceCurrency" content="EUR"></strong></p>' +
      '<a class="btn btn-secondary btn-sm" href="pages/boutique/">Voir la boutique</a>' +
      "</div></article>"
    );
  }

  function renderCards() {
    var estimatedBox = document.getElementById("estimatedCards");
    var soldBox = document.getElementById("soldCards");
    if (estimatedBox) estimatedBox.innerHTML = ESTIMATED.map(estimatedHtml).join("");
    if (soldBox) soldBox.innerHTML = SOLD.map(soldHtml).join("");
  }

  function initFaq() {
    document.querySelectorAll(".faq-question").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = btn.closest(".faq-item");
        var open = item.classList.contains("is-open");
        document.querySelectorAll(".faq-item.is-open").forEach(function (el) {
          el.classList.remove("is-open");
          el.querySelector(".faq-question").setAttribute("aria-expanded", "false");
        });
        if (!open) {
          item.classList.add("is-open");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    });
  }

  function initReveal() {
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".reveal").forEach(function (el) {
        el.classList.add("is-visible");
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    document.querySelectorAll(".reveal").forEach(function (el) {
      observer.observe(el);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderCards();
    initFaq();
    initReveal();
  });
})();
