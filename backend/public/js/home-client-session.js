(function () {
  "use strict";

  var TOKEN_KEY = "cardoria_session_token";
  var LEGACY_TOKEN_KEY = "cardoria_client_session";
  var ACCOUNT_KEY = "cardoria_account";
  var API = window.CARDORIA_BACKEND || window.location.origin;

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

  function setClientLinks(loggedIn, account) {
    document.querySelectorAll("[data-home-client-link]").forEach(function (link) {
      link.href = "/client-login.html";
      link.textContent = loggedIn ? "Mon compte" : "Connexion";
      link.setAttribute("aria-label", loggedIn
        ? "Ouvrir mon espace client Cardoria"
        : "Se connecter à son espace client Cardoria");
      link.classList.toggle("is-authenticated", Boolean(loggedIn));
      if (loggedIn && account && account.name) {
        link.title = "Compte : " + String(account.name);
      } else {
        link.removeAttribute("title");
      }
    });
  }

  async function refreshClientState() {
    var token = getToken();
    if (!token) {
      setClientLinks(false, null);
      return;
    }

    var cached = getCachedAccount();
    if (cached) setClientLinks(true, cached);

    try {
      var response = await fetch(API + "/api/auth/me", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + token
        },
        credentials: "same-origin"
      });

      if (response.status === 401 || response.status === 403) {
        clearExpiredSession();
        setClientLinks(false, null);
        return;
      }

      if (!response.ok) return;

      var data = await response.json();
      var account = data && data.user && data.user.role === "client" ? data.user : null;
      if (!account) return;
      saveAccount(account);
      setClientLinks(true, account);
    } catch (_) {
      // A temporary network failure must never log out a client.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshClientState, { once: true });
  } else {
    refreshClientState();
  }

  window.addEventListener("storage", function (event) {
    if ([TOKEN_KEY, LEGACY_TOKEN_KEY, ACCOUNT_KEY].includes(event.key)) refreshClientState();
  });
})();
