(function () {
  "use strict";

  const BACKEND = window.CARDORIA_BACKEND || (window.CARDORIA_SEO && window.CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";

  function qs(id) {
    return document.getElementById(id);
  }

  async function requestAdminEmailLink(event) {
    event?.preventDefault();
    const err = qs("loginError");
    const success = qs("loginSuccess");
    if (err) err.textContent = "";
    if (success) success.textContent = "";

    const email = qs("adminEmail")?.value?.trim();
    if (!email) {
      if (err) err.textContent = "Indiquez votre adresse e-mail.";
      return;
    }

    const button = qs("adminEmailLoginForm")?.querySelector("button[type='submit']");
    if (button) button.disabled = true;

    try {
      const response = await fetch(`${BACKEND}/api/auth/email/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        throw new Error("Réponse serveur illisible.");
      }

      if (!response.ok || !data.ok) {
        if (err) err.textContent = data.error || "Connexion impossible.";
        return;
      }

      if (success) success.textContent = data.message || "Lien de connexion envoyé. Consultez votre boîte e-mail.";
    } catch (error) {
      if (err) err.textContent = `Serveur Cardoria indisponible : ${error.message}`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    qs("adminEmailLoginForm")?.addEventListener("submit", requestAdminEmailLink);
  });
})();
