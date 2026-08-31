(function () {
  "use strict";

  const BACKEND = window.CARDORIA_BACKEND || (window.CARDORIA_SEO && window.CARDORIA_SEO.backendUrl) || "https://cardoria-site-f2cy.onrender.com";
  const ADMIN_ROLES = ["super_admin", "admin", "employee"];

  function qs(id) { return document.getElementById(id); }

  function clearMessages() {
    if (qs("loginError")) qs("loginError").textContent = "";
    if (qs("loginSuccess")) qs("loginSuccess").textContent = "";
  }

  function finalizeSession(data, fallbackEmail) {
    if (!data?.ok || !data?.token || !ADMIN_ROLES.includes(data.user?.role)) {
      throw new Error("Session administrateur invalide.");
    }

    sessionStorage.setItem("cardoria_admin_connected", "yes");
    sessionStorage.setItem("cardoria_session_token", data.token);
    sessionStorage.setItem("cardoria_admin_email", data.user.email || fallbackEmail || "");
    if (data.csrfToken) sessionStorage.setItem("cardoria_csrf_token", data.csrfToken);
    sessionStorage.removeItem("cardoria_admin_code");
    sessionStorage.removeItem("cardoria_2fa_challenge");
    location.href = "/admin.html";
  }

  async function loginWithPassword(event) {
    event?.preventDefault();
    clearMessages();

    const err = qs("loginError");
    const email = qs("adminEmail")?.value?.trim();
    const password = qs("adminPassword")?.value || "";
    const button = qs("adminPasswordLoginForm")?.querySelector("button[type='submit']");

    if (!email || !password) {
      if (err) err.textContent = "Indiquez votre e-mail et votre mot de passe.";
      return;
    }

    if (button) button.disabled = true;

    try {
      const response = await fetch(`${BACKEND}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Connexion impossible.");
      }
      if (!ADMIN_ROLES.includes(data.user?.role)) {
        throw new Error("Ce compte n'est pas autorisé à accéder à l'administration.");
      }

      // Le serveur crée désormais directement la session Admin après validation du mot de passe.
      if (data.token) {
        finalizeSession(data, email);
        return;
      }

      // Compatibilité temporaire si une ancienne instance répond encore avec un challenge 2FA.
      if (data.requires2fa) {
        throw new Error("Une ancienne version de l'authentification est encore active. Rechargez la page dans quelques instants.");
      }

      throw new Error("Session administrateur non créée par le serveur.");
    } catch (error) {
      if (err) err.textContent = error.message || "Connexion impossible.";
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function requestAdminEmailLink(event) {
    event?.preventDefault();
    clearMessages();

    const err = qs("loginError");
    const success = qs("loginSuccess");
    const email = qs("adminEmail")?.value?.trim();
    const button = qs("adminEmailLoginForm")?.querySelector("button[type='submit']");

    if (!email) {
      if (err) err.textContent = "Indiquez votre adresse e-mail.";
      return;
    }

    if (button) button.disabled = true;

    try {
      const response = await fetch(`${BACKEND}/api/auth/email/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Envoi du lien impossible.");
      if (success) success.textContent = data.message || "Lien de connexion envoyé.";
    } catch (error) {
      if (err) err.textContent = error.message || "Envoi du lien impossible.";
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    sessionStorage.removeItem("cardoria_admin_code");
    sessionStorage.removeItem("cardoria_2fa_challenge");
    qs("adminPasswordLoginForm")?.addEventListener("submit", loginWithPassword);
    qs("adminEmailLoginForm")?.addEventListener("submit", requestAdminEmailLink);
  });
})();
