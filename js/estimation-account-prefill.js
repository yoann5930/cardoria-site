(function () {
  "use strict";

  var TOKEN_KEY = "cardoria_session_token";
  var LEGACY_TOKEN_KEY = "cardoria_client_session";
  var ACCOUNT_KEY = "cardoria_account";
  var API = window.CARDORIA_BACKEND || window.location.origin;

  function qs(id) {
    return document.getElementById(id);
  }

  function getToken() {
    try {
      var token = localStorage.getItem(TOKEN_KEY) || "";
      if (token) return token;
      var legacy = localStorage.getItem(LEGACY_TOKEN_KEY) || "";
      if (legacy) {
        localStorage.setItem(TOKEN_KEY, legacy);
        localStorage.removeItem(LEGACY_TOKEN_KEY);
        return legacy;
      }
    } catch (_) {}
    return "";
  }

  function getCachedAccount() {
    try {
      var raw = localStorage.getItem(ACCOUNT_KEY);
      var account = raw ? JSON.parse(raw) : null;
      return account && account.role === "client" ? account : null;
    } catch (_) {
      return null;
    }
  }

  function saveAccount(account) {
    try {
      if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
      else localStorage.removeItem(ACCOUNT_KEY);
    } catch (_) {}
  }

  function clearExpiredSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(ACCOUNT_KEY);
    } catch (_) {}
  }

  function accountName(account) {
    if (!account) return "";
    var fullName = [account.firstName, account.lastName]
      .map(function (value) { return String(value || "").trim(); })
      .filter(Boolean)
      .join(" ");
    return fullName || String(account.name || "").trim();
  }

  function fillInput(input, value) {
    if (!input || !value) return;
    if (input.value && input.dataset.cardoriaPrefilled !== "true") return;
    input.value = value;
    input.dataset.cardoriaPrefilled = "true";
  }

  function applyAccount(account) {
    if (!account || account.role !== "client") return;
    fillInput(qs("customerName"), accountName(account));
    fillInput(qs("customerEmail"), String(account.email || "").trim());
  }

  function clearPrefilledFields() {
    ["customerName", "customerEmail"].forEach(function (id) {
      var input = qs(id);
      if (!input || input.dataset.cardoriaPrefilled !== "true") return;
      input.value = "";
      delete input.dataset.cardoriaPrefilled;
    });
  }

  async function prefillFromClientAccount() {
    if (!qs("customerName") || !qs("customerEmail")) return;

    var token = getToken();
    if (!token) return;

    var cached = getCachedAccount();
    if (cached) applyAccount(cached);

    try {
      var response = await fetch(API + "/api/auth/me", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + token
        },
        credentials: "same-origin",
        cache: "no-store"
      });

      if (response.status === 401 || response.status === 403) {
        clearExpiredSession();
        clearPrefilledFields();
        return;
      }

      if (!response.ok) return;

      var data = await response.json();
      var account = data && data.user && data.user.role === "client" ? data.user : null;
      if (!account) return;

      saveAccount(account);
      applyAccount(account);
    } catch (_) {
      // Le cache du compte reste utilisable si le réseau est momentanément indisponible.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", prefillFromClientAccount, { once: true });
  } else {
    prefillFromClientAccount();
  }

  window.addEventListener("storage", function (event) {
    if ([TOKEN_KEY, LEGACY_TOKEN_KEY, ACCOUNT_KEY].includes(event.key)) {
      prefillFromClientAccount();
    }
  });
})();
