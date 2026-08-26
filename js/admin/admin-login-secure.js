(function () {
  "use strict";

  const BACKEND = window.CARDORIA_BACKEND || (window.CARDORIA_SEO && window.CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";
  const ADMIN_ROLES = ["super_admin", "admin", "employee"];

  function qs(id) {
    return document.getElementById(id);
  }

  function clearMessages() {
    const err = qs("loginError");
    const success = qs("loginSuccess");
    if (err) err.textContent = "";
    if (success) success.textContent = "";
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
      if (!response.ok || !data.ok || !data.token) {
        if (err) err.textContent = data.error || "Connexion impossible.";
        return;
      }
      if (!ADMIN_ROLES.includes(data.user?.role)) {
        try {
          await fetch(`${BACKEND}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${data.token}` } });
        } catch {}
        if (err) err.textContent = "Ce compte n'est pas autorisé à accéder à l'administration.";
        return;
      }

      sessionStorage.setItem("cardoria_admin_connected", "yes");
      sessionStorage.setItem("cardoria_session_token", data.token);
      sessionStorage.setItem("cardoria_admin_email", data.user.email || email);
      if (data.csrfToken) sessionStorage.setItem("cardoria_csrf_token", data.csrfToken);
      sessionStorage.removeItem("cardoria_admin_code");
      location.href = "admin.html";
    } catch (error) {
      if (err) err.textContent = `Serveur Cardoria indisponible : ${error.message}`;
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
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        if (err) err.textContent = data.error || "Envoi du lien impossible.";
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
    qs("adminPasswordLoginForm")?.addEventListener("submit", loginWithPassword);
    qs("adminEmailLoginForm")?.addEventListener("submit", requestAdminEmailLink);
  });
})();
