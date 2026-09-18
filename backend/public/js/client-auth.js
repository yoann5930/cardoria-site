(function () {
  "use strict";
  const API = window.CARDORIA_BACKEND || window.location.origin;
  const TOKEN_KEY = "cardoria_client_session";
  const qs = (id) => document.getElementById(id);
  let selectedRelay = null;
  let currentUser = null;

  function setMessage(text, type) {
    const el = qs("clientAuthMessage");
    if (!el) return;
    el.textContent = text || "";
    el.className = "client-auth-message" + (type ? ` is-${type}` : "");
  }

  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function isClient(user) {
    return user && user.role === "client";
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

  function showAccount(user) {
    currentUser = user;
    qs("clientAuthCard").hidden = true;
    qs("clientAccountCard").hidden = false;
    qs("clientAccountName").textContent = user.name || "Mon compte";
    qs("clientAccountEmail").textContent = user.email || "";
    if (qs("clientProfileName")) qs("clientProfileName").value = user.name || "";
    if (qs("clientProfilePhone")) qs("clientProfilePhone").value = user.phone || "";
    if (qs("clientProfileAddress1")) qs("clientProfileAddress1").value = user.addressLine1 || "";
    if (qs("clientProfileAddress2")) qs("clientProfileAddress2").value = user.addressLine2 || "";
    if (qs("clientProfilePostalCode")) qs("clientProfilePostalCode").value = user.postalCode || "";
    if (qs("clientProfileCity")) qs("clientProfileCity").value = user.city || "";
    if (qs("clientProfileCountry")) qs("clientProfileCountry").value = user.country || "FR";
    selectedRelay = user.relay && user.relay.id ? { ...user.relay } : null;
    renderRelay();
    loadLiveShipments();
  }

  function showLoggedOut() {
    qs("clientAuthCard").hidden = false;
    qs("clientAccountCard").hidden = true;
  }

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, { ...options, headers });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || (Array.isArray(data.errors) ? data.errors.join(" ") : "Une erreur est survenue."));
    }
    return data;
  }

  async function restore() {
    const token = getToken();
    if (!token) return;
    try {
      const data = await api("/api/auth/me", { method: "GET", headers: {} });
      if (!isClient(data.user)) {
        setToken("");
        showLoggedOut();
        return;
      }
      showAccount(data.user);
    } catch {
      setToken("");
      showLoggedOut();
    }
  }

  async function login(event) {
    event.preventDefault();
    setMessage("Connexion en cours...");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: qs("clientLoginEmail").value.trim(),
          password: qs("clientLoginPassword").value
        })
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
      if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        throw new Error("Le mot de passe doit contenir au moins 10 caractères, avec des lettres et des chiffres.");
      }
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: qs("clientRegisterName").value.trim(),
          email: qs("clientRegisterEmail").value.trim(),
          password
        })
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
    if (!node) return;
    if (!selectedRelay || !selectedRelay.id) {
      node.textContent = "Aucun Point Relais préféré.";
      return;
    }
    node.textContent = "Point Relais préféré : " + (selectedRelay.name || "") + " — " + (selectedRelay.postalCode || "") + " " + (selectedRelay.city || "");
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
        id: String(point.id),
        carrierServicePointId: point.carrierServicePointId || "",
        name: point.name || "",
        address: [point.street, point.houseNumber].filter(Boolean).join(" "),
        postalCode: point.postalCode || "",
        city: point.city || "",
        countryCode: point.countryCode || "FR",
        carrierCode: point.carrierCode || "mondial_relay"
      };
      renderRelay();
    } catch (e) {
      setMessage(e.message, "error");
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setMessage("Enregistrement du profil...");
    try {
      const data = await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: qs("clientProfileName").value.trim(),
          phone: qs("clientProfilePhone").value.trim(),
          addressLine1: qs("clientProfileAddress1").value.trim(),
          addressLine2: qs("clientProfileAddress2").value.trim(),
          postalCode: qs("clientProfilePostalCode").value.trim(),
          city: qs("clientProfileCity").value.trim(),
          country: (qs("clientProfileCountry").value.trim() || "FR").toUpperCase(),
          shippingPreference: "mondial_relay",
          relay: selectedRelay
        })
      });
      currentUser = data.user;
      showAccount(data.user);
      setMessage("Adresse et Point Relais enregistrés.", "success");
    } catch (e) {
      setMessage(e.message, "error");
    }
  }

  async function loadLiveShipments() {
    const host = qs("clientLiveShipments");
    if (!host || !getToken()) return;
    try {
      const data = await api("/api/live/my-shipments", { method: "GET" });
      const items = Array.isArray(data.shipments) ? data.shipments : [];
      if (!items.length) {
        host.innerHTML = "<p>Aucune expédition Live.</p>";
        return;
      }
      host.innerHTML = items.map((s) => {
        const tracking = s.trackingUrl
          ? "<a target='_blank' rel='noopener' href='" + String(s.trackingUrl).replace(/"/g, "&quot;") + "'>" + (s.trackingNumber || "Suivre le colis") + "</a>"
          : (s.trackingNumber || "Suivi en attente");
        return "<div style='border:1px solid rgba(212,175,55,.25);padding:10px;margin:8px 0;border-radius:8px'><strong>" +
          (s.carrier || "Expédition Live") + "</strong><br>Statut : " + (s.status || "En préparation") +
          "<br>Suivi : " + tracking + "</div>";
      }).join("");
    } catch (e) {
      host.textContent = "Suivi Live indisponible : " + e.message;
    }
  }

  async function logout() {
    try {
      if (getToken()) await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {}
    setToken("");
    showLoggedOut();
    showForm("login");
    setMessage("Vous êtes déconnecté.", "success");
  }

  function init() {
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
