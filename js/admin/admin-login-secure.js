(function () {
  "use strict";

  const BACKEND = window.CARDORIA_BACKEND || (window.CARDORIA_SEO && window.CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";
  const ADMIN_ROLES = ["super_admin", "admin", "employee"];
  let challengeToken = "";
  let challengeMode = "";

  function qs(id) { return document.getElementById(id); }

  function clearMessages() {
    if (qs("loginError")) qs("loginError").textContent = "";
    if (qs("loginSuccess")) qs("loginSuccess").textContent = "";
  }

  function reset2fa(options) {
    const preserveCredentials = !!options?.preserveCredentials;
    challengeToken = "";
    challengeMode = "";
    qs("admin2faBox")?.classList.remove("is-visible");
    if (qs("admin2faSetup")) qs("admin2faSetup").style.display = "none";
    if (qs("adminTotpCode")) qs("adminTotpCode").value = "";
    if (!preserveCredentials && qs("adminPassword")) qs("adminPassword").value = "";
    qs("adminPasswordLoginForm")?.querySelectorAll("input,button").forEach(function (el) { el.disabled = false; });
  }

  function finalizeSession(data, fallbackEmail) {
    if (!data?.ok || !data?.token || !ADMIN_ROLES.includes(data.user?.role)) throw new Error("Session administrateur invalide.");
    sessionStorage.setItem("cardoria_admin_connected", "yes");
    sessionStorage.setItem("cardoria_session_token", data.token);
    sessionStorage.setItem("cardoria_admin_email", data.user.email || fallbackEmail || "");
    if (data.csrfToken) sessionStorage.setItem("cardoria_csrf_token", data.csrfToken);
    sessionStorage.removeItem("cardoria_admin_code");
    sessionStorage.removeItem("cardoria_2fa_challenge");
    location.href = "admin.html";
  }

  function show2fa(data) {
    challengeToken = String(data.challengeToken || "");
    challengeMode = String(data.mode || "login");
    if (!challengeToken) throw new Error("Challenge 2FA manquant.");
    sessionStorage.setItem("cardoria_2fa_challenge", challengeToken);
    qs("adminPasswordLoginForm")?.querySelectorAll("input,button").forEach(function (el) { el.disabled = true; });
    const box = qs("admin2faBox");
    box?.classList.add("is-visible");
    const setup = qs("admin2faSetup");
    if (challengeMode === "setup") {
      if (qs("admin2faTitle")) qs("admin2faTitle").textContent = "Activer la double authentification";
      if (setup) setup.style.display = "block";
      if (qs("admin2faSecret")) qs("admin2faSecret").textContent = data.setup?.secret || "";
      if (qs("admin2faUri")) qs("admin2faUri").href = data.setup?.uri || "#";
      if (qs("loginSuccess")) qs("loginSuccess").textContent = "Ajoutez la clé dans votre application Authenticator puis entrez le code à 6 chiffres.";
    } else {
      if (qs("admin2faTitle")) qs("admin2faTitle").textContent = "Vérification 2FA obligatoire";
      if (setup) setup.style.display = "none";
      if (qs("loginSuccess")) qs("loginSuccess").textContent = "Mot de passe validé. Saisissez maintenant votre code Authenticator.";
    }
    qs("adminTotpCode")?.focus();
  }

  async function loginWithPassword(event) {
    event?.preventDefault();
    clearMessages();
    const err = qs("loginError");
    const email = qs("adminEmail")?.value?.trim();
    const password = qs("adminPassword")?.value || "";
    if (!email || !password) { if (err) err.textContent = "Indiquez votre e-mail et votre mot de passe."; return; }
    reset2fa({ preserveCredentials: true });
    const button = qs("adminPasswordLoginForm")?.querySelector("button[type='submit']");
    if (button) button.disabled = true;
    try {
      const response = await fetch(`${BACKEND}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Connexion impossible.");
      if (!ADMIN_ROLES.includes(data.user?.role)) throw new Error("Ce compte n'est pas autorisé à accéder à l'administration.");
      if (data.requires2fa) return show2fa(data);
      throw new Error("La double authentification Admin n'a pas été demandée par le serveur.");
    } catch (error) {
      reset2fa({ preserveCredentials: true });
      if (err) err.textContent = error.message || "Connexion impossible.";
    } finally {
      if (button && !challengeToken) button.disabled = false;
    }
  }

  async function verify2fa(event) {
    event?.preventDefault();
    clearMessages();
    const err = qs("loginError");
    const code = String(qs("adminTotpCode")?.value || "").replace(/\s/g, "");
    const button = qs("admin2faForm")?.querySelector("button[type='submit']");
    if (!/^\d{6}$/.test(code)) { if (err) err.textContent = "Saisissez le code à 6 chiffres de votre application Authenticator."; return; }
    if (!challengeToken) { if (err) err.textContent = "Challenge 2FA expiré. Recommencez la connexion."; return; }
    if (button) button.disabled = true;
    try {
      const response = await fetch(`${BACKEND}/api/auth/2fa/login/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken, totpCode: code }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.token) throw new Error(data.error || "Code 2FA invalide.");
      finalizeSession(data, qs("adminEmail")?.value?.trim());
    } catch (error) {
      if (err) err.textContent = error.message || "Validation 2FA impossible.";
      if (qs("adminTotpCode")) { qs("adminTotpCode").value = ""; qs("adminTotpCode").focus(); }
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
    if (!email) { if (err) err.textContent = "Indiquez votre adresse e-mail."; return; }
    const button = qs("adminEmailLoginForm")?.querySelector("button[type='submit']");
    if (button) button.disabled = true;
    try {
      const response = await fetch(`${BACKEND}/api/auth/email/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Envoi du lien impossible.");
      if (success) success.textContent = data.message || "Lien de connexion envoyé. La 2FA restera obligatoire après ouverture du lien.";
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
    qs("admin2faForm")?.addEventListener("submit", verify2fa);
    qs("admin2faCancel")?.addEventListener("click", function () { clearMessages(); reset2fa(); });
    qs("adminEmailLoginForm")?.addEventListener("submit", requestAdminEmailLink);
  });
})();