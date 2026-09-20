(function () {
  "use strict";
  const API = window.CARDORIA_BACKEND || window.location.origin;
  const TOKEN_KEY = "cardoria_session_token";
  const LEGACY_TOKEN_KEY = "cardoria_client_session";
  const ACCOUNT_KEY = "cardoria_account";
  const qs = (id) => document.getElementById(id);
  let selectedRelay = null;
  let currentUser = null;

  function migrateToken() {
    const canonical = localStorage.getItem(TOKEN_KEY);
    if (canonical) return canonical;
    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy) {
      localStorage.setItem(TOKEN_KEY, legacy);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      return legacy;
    }
    return "";
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }

  function getToken() { return migrateToken(); }

  function setAccount(user) {
    if (user) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(user));
    else localStorage.removeItem(ACCOUNT_KEY);
  }

  function isClient(user) { return user && user.role === "client"; }
  function euro(v) { return Number(v || 0).toFixed(2).replace(".", ",") + " €"; }
  function safeText(v) { return String(v == null ? "" : v); }

  function setMessage(text, type) {
    const logged = qs("clientAccountCard") && !qs("clientAccountCard").hidden;
    const el = logged ? qs("clientProfileMessage") : qs("clientAuthMessage");
    if (!el) return;
    el.textContent = text || "";
    el.className = "client-auth-message" + (type ? " is-" + type : "");
  }

  function showForm(which) {
    const login = which === "login";
    qs("clientLoginForm").hidden = !login;
    qs("clientRegisterForm").hidden = login;
    qs("clientLoginTab").classList.toggle("is-active", login);
    qs("clientRegisterTab").classList.toggle("is-active", !login);
    qs("clientLoginTab").setAttribute("aria-selected", String(login));
    qs("clientRegisterTab").setAttribute("aria-selected", String(!login));
    setMessage("");
  }

  function fillProfile(user) {
    qs("clientProfileName").value = user.name || "";
    qs("clientProfilePhone").value = user.phone || "";
    qs("clientProfileAddress1").value = user.addressLine1 || "";
    qs("clientProfileAddress2").value = user.addressLine2 || "";
    qs("clientProfilePostalCode").value = user.postalCode || "";
    qs("clientProfileCity").value = user.city || "";
    qs("clientProfileCountry").value = user.country || "FR";
    selectedRelay = user.relay && user.relay.id ? { ...user.relay } : null;
    renderRelay();
    qs("clientStatProfile").textContent = user.profileReady ? "✓" : "!";
    qs("clientStatProfileText").textContent = user.profileReady ? (user.relayReady ? "Adresse + relais prêts" : "Adresse enregistrée") : "À compléter";
  }

  function showAccount(user) {
    currentUser = user;
    setAccount(user);
    qs("clientGuestShell").hidden = true;
    qs("clientAccountCard").hidden = false;
    qs("clientAccountName").textContent = user.name || "Client";
    qs("clientAccountEmail").textContent = user.email || "";
    fillProfile(user);
    loadDashboardData();
  }

  function showLoggedOut() {
    currentUser = null;
    setAccount(null);
    qs("clientGuestShell").hidden = false;
    qs("clientAccountCard").hidden = true;
  }

  async function api(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(API + path, { ...options, headers, cache: options.cache || "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const e = new Error(data.error || (Array.isArray(data.errors) ? data.errors.join(" ") : "Une erreur est survenue."));
      e.status = res.status;
      throw e;
    }
    return data;
  }

  async function restore() {
    const token = getToken();
    if (!token) { showLoggedOut(); return; }
    try {
      const data = await api("/api/auth/me", { method: "GET" });
      if (!isClient(data.user)) throw Object.assign(new Error("Compte client requis."), { status: 403 });
      showAccount(data.user);
    } catch (e) {
      if (e.status === 401 || e.status === 403) setToken("");
      showLoggedOut();
    }
  }

  async function login(event) {
    event.preventDefault();
    setMessage("Connexion en cours...");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: qs("clientLoginEmail").value.trim(), password: qs("clientLoginPassword").value })
      });
      if (!isClient(data.user)) throw new Error("Cet espace est réservé aux comptes clients.");
      setToken(data.token);
      showAccount(data.user);
      setMessage("");
    } catch (e) {
      setToken("");
      setMessage(e.message, "error");
    }
  }

  async function register(event) {
    event.preventDefault();
    setMessage("Création du compte...");
    try {
      const password = qs("clientRegisterPassword").value;
      if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new Error("Le mot de passe doit contenir au moins 10 caractères, avec des lettres et des chiffres.");
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name: qs("clientRegisterName").value.trim(), email: qs("clientRegisterEmail").value.trim(), password })
      });
      if (!isClient(data.user)) throw new Error("Création du compte client impossible.");
      setToken(data.token);
      showAccount(data.user);
      setMessage("");
    } catch (e) {
      setToken("");
      setMessage(e.message, "error");
    }
  }

  function renderRelay() {
    const node = qs("clientRelaySummary");
    if (!selectedRelay || !selectedRelay.id) {
      node.textContent = "Aucun Point Relais préféré.";
      return;
    }
    node.textContent = [selectedRelay.name, selectedRelay.address, selectedRelay.postalCode, selectedRelay.city].filter(Boolean).join(" — ");
  }

  async function chooseRelay() {
    try {
      const postalCode = qs("clientProfilePostalCode").value.trim();
      const city = qs("clientProfileCity").value.trim();
      const countryCode = (qs("clientProfileCountry").value.trim() || "FR").toUpperCase();
      if (!postalCode && !city) throw new Error("Renseignez d’abord votre code postal ou votre ville.");
      const data = await api("/api/sendcloud/service-points?" + new URLSearchParams({ postalCode, city, countryCode, limit: "10", radius: "15000" }), { method: "GET" });
      const points = Array.isArray(data.points) ? data.points : [];
      if (!points.length) throw new Error("Aucun Point Relais Mondial Relay trouvé.");
      const lines = points.map((point, index) => (index + 1) + ". " + point.name + " — " + [point.street, point.houseNumber, point.postalCode, point.city].filter(Boolean).join(" "));
      const answer = window.prompt("Choisissez votre Point Relais :\n\n" + lines.join("\n") + "\n\nNuméro :", "1");
      if (answer === null) return;
      const point = points[Math.trunc(Number(answer)) - 1];
      if (!point) throw new Error("Choix de Point Relais invalide.");
      selectedRelay = {
        id: String(point.id), carrierServicePointId: point.carrierServicePointId || "", name: point.name || "",
        address: [point.street, point.houseNumber].filter(Boolean).join(" "), postalCode: point.postalCode || "",
        city: point.city || "", countryCode: point.countryCode || "FR", carrierCode: point.carrierCode || "mondial_relay"
      };
      renderRelay();
    } catch (e) { setMessage(e.message, "error"); }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setMessage("Enregistrement du profil...");
    try {
      const data = await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: qs("clientProfileName").value.trim(), phone: qs("clientProfilePhone").value.trim(),
          addressLine1: qs("clientProfileAddress1").value.trim(), addressLine2: qs("clientProfileAddress2").value.trim(),
          postalCode: qs("clientProfilePostalCode").value.trim(), city: qs("clientProfileCity").value.trim(),
          country: (qs("clientProfileCountry").value.trim() || "FR").toUpperCase(),
          shippingPreference: "mondial_relay", relay: selectedRelay
        })
      });
      currentUser = data.user;
      setAccount(data.user);
      qs("clientAccountName").textContent = data.user.name || "Client";
      fillProfile(data.user);
      setMessage("Profil de livraison enregistré.", "success");
    } catch (e) { setMessage(e.message, "error"); }
  }

  function combinedRecent(boutique, marketplace) {
    const items = [];
    for (const o of boutique || []) items.push({ type: "Boutique", id: o.id, date: o.createdAt || o.date || "", total: o.total, status: o.status || o.paymentStatus || "" });
    for (const o of marketplace || []) items.push({ type: "Marketplace", id: o.id, date: o.createdAt || o.date || "", total: o.total, status: o.status || o.paymentStatus || "" });
    return items.sort((a,b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
  }

  function renderRecentOrders(boutique, marketplace) {
    const host = qs("clientRecentOrders");
    const items = combinedRecent(boutique, marketplace);
    if (!items.length) {
      host.innerHTML = '<div class="client-recent-order"><div class="client-recent-order-icon">C</div><div><strong>Aucun achat pour le moment</strong><span>Vos prochaines commandes apparaîtront automatiquement ici.</span></div></div>';
      return;
    }
    host.replaceChildren();
    items.forEach((o) => {
      const row = document.createElement("div"); row.className = "client-recent-order";
      const icon = document.createElement("div"); icon.className = "client-recent-order-icon"; icon.textContent = o.type === "Boutique" ? "B" : "M";
      const mid = document.createElement("div"), title = document.createElement("strong"), meta = document.createElement("span");
      title.textContent = o.type + " · " + safeText(o.id);
      meta.textContent = [safeText(o.status), o.date ? new Date(o.date).toLocaleDateString("fr-FR") : ""].filter(Boolean).join(" · ");
      mid.append(title, meta);
      const price = document.createElement("span"); price.className = "client-recent-order-price"; price.textContent = euro(o.total);
      row.append(icon, mid, price); host.appendChild(row);
    });
  }

  function renderLive(items) {
    const host = qs("clientLiveShipments");
    qs("clientStatLive").textContent = String(items.length);
    if (!items.length) { host.innerHTML = '<p class="client-muted">Aucune expédition Live pour le moment.</p>'; return; }
    host.replaceChildren();
    items.slice(0, 6).forEach((s) => {
      const box = document.createElement("div"); box.className = "client-live-item";
      const title = document.createElement("strong"); title.textContent = s.carrier || "Expédition Live";
      const state = document.createElement("p"); state.textContent = "Statut : " + (s.status || "En préparation");
      box.append(title, state);
      let url = null;
      try { const candidate = new URL(s.trackingUrl); if (candidate.protocol === "https:" && !candidate.username && !candidate.password) url = candidate; } catch {}
      const link = document.createElement(url ? "a" : "span");
      link.textContent = s.trackingNumber || (url ? "Suivre le colis" : "Suivi en attente");
      if (url) { link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      box.appendChild(link); host.appendChild(box);
    });
  }

  async function loadDashboardData() {
    if (!getToken()) return;
    const [boutiqueResult, marketplaceResult, liveResult] = await Promise.allSettled([
      api("/api/auth/orders"),
      api("/api/marketplace/v1/orders"),
      api("/api/live/my-shipments")
    ]);
    const boutique = boutiqueResult.status === "fulfilled" && Array.isArray(boutiqueResult.value.orders) ? boutiqueResult.value.orders : [];
    const marketplace = marketplaceResult.status === "fulfilled" && Array.isArray(marketplaceResult.value.orders) ? marketplaceResult.value.orders : [];
    const live = liveResult.status === "fulfilled" && Array.isArray(liveResult.value.shipments) ? liveResult.value.shipments : [];
    qs("clientStatBoutique").textContent = String(boutique.length);
    qs("clientStatMarketplace").textContent = String(marketplace.length);
    renderRecentOrders(boutique, marketplace);
    renderLive(live);
  }

  async function logout() {
    const token = getToken();
    try { if (token) await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
    setToken(""); setAccount(null);
    showLoggedOut(); showForm("login");
    setMessage("Vous êtes déconnecté.", "success");
  }

  function init() {
    migrateToken();
    qs("clientLoginTab")?.addEventListener("click", () => showForm("login"));
    qs("clientRegisterTab")?.addEventListener("click", () => showForm("register"));
    qs("clientLoginForm")?.addEventListener("submit", login);
    qs("clientRegisterForm")?.addEventListener("submit", register);
    qs("clientLogoutButton")?.addEventListener("click", logout);
    qs("clientProfileForm")?.addEventListener("submit", saveProfile);
    qs("clientChooseRelay")?.addEventListener("click", chooseRelay);
    restore();
  }
  document.addEventListener("DOMContentLoaded", init);
})();