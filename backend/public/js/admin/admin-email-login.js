(async function () {
  "use strict";

  const status = document.getElementById("magicLoginStatus");
  const error = document.getElementById("magicLoginError");
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const BACKEND = window.CARDORIA_BACKEND || (window.CARDORIA_SEO && window.CARDORIA_SEO.backendUrl) || "https://www.cardoriashop.fr";
  const ADMIN_ROLES = ["super_admin", "admin", "employee"];
  let challengeToken = "";

  function finalizeSession(data) {
    if (!data?.ok || !data?.token || !ADMIN_ROLES.includes(data.user?.role)) throw new Error("Session administrateur invalide.");
    sessionStorage.setItem("cardoria_admin_connected", "yes");
    sessionStorage.setItem("cardoria_session_token", data.token);
    if (data.csrfToken) sessionStorage.setItem("cardoria_csrf_token", data.csrfToken);
    if (data.user?.email) sessionStorage.setItem("cardoria_admin_email", data.user.email);
    sessionStorage.removeItem("cardoria_admin_code");
    sessionStorage.removeItem("cardoria_2fa_challenge");
    history.replaceState({}, "", window.location.pathname);
    if (status) status.textContent = "Connexion validée. Redirection...";
    window.location.replace("admin.html");
  }

  function show2fa(data) {
    challengeToken = String(data.challengeToken || "");
    if (!challengeToken) throw new Error("Challenge 2FA manquant.");
    sessionStorage.setItem("cardoria_2fa_challenge", challengeToken);
    const box = document.getElementById("magic2fa");
    box?.classList.add("is-visible");
    const setup = document.getElementById("magic2faSetup");
    if (data.mode === "setup") {
      if (setup) setup.style.display = "block";
      if (document.getElementById("magic2faSecret")) document.getElementById("magic2faSecret").textContent = data.setup?.secret || "";
      if (document.getElementById("magic2faUri")) document.getElementById("magic2faUri").href = data.setup?.uri || "#";
      if (status) status.textContent = "Lien validé. Activez maintenant la double authentification puis entrez le code à 6 chiffres.";
    } else {
      if (setup) setup.style.display = "none";
      if (status) status.textContent = "Lien validé. Saisissez votre code Authenticator pour terminer la connexion.";
    }
    document.getElementById("magicTotpCode")?.focus();
  }

  async function verify2fa(event) {
    event?.preventDefault();
    if (error) error.textContent = "";
    const code = String(document.getElementById("magicTotpCode")?.value || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) { if (error) error.textContent = "Saisissez un code à 6 chiffres."; return; }
    const button = document.getElementById("magic2faForm")?.querySelector("button[type='submit']");
    if (button) button.disabled = true;
    try {
      const response = await fetch(`${BACKEND}/api/auth/2fa/login/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken, totpCode: code }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.token) throw new Error(data.error || "Code 2FA invalide.");
      finalizeSession(data);
    } catch (e) {
      if (error) error.textContent = e.message || "Validation 2FA impossible.";
      if (document.getElementById("magicTotpCode")) document.getElementById("magicTotpCode").value = "";
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.getElementById("magic2faForm")?.addEventListener("submit", verify2fa);
  sessionStorage.removeItem("cardoria_admin_code");
  sessionStorage.removeItem("cardoria_2fa_challenge");

  if (!token) {
    if (status) status.textContent = "";
    if (error) error.textContent = "Lien de connexion invalide.";
    return;
  }

  try {
    const response = await fetch(`${BACKEND}/api/auth/email/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "Lien de connexion invalide ou expiré.");
    if (!ADMIN_ROLES.includes(data.user?.role)) throw new Error("Compte non autorisé pour l'administration.");
    if (data.token) return finalizeSession(data);
    if (!data.requires2fa) throw new Error("La double authentification Admin n'a pas été demandée par le serveur.");
    show2fa(data);
  } catch (e) {
    if (status) status.textContent = "";
    if (error) error.textContent = `Connexion impossible : ${e.message}`;
  }
})();
