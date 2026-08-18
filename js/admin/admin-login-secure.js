(function () {
  "use strict";

  const BACKEND = window.CARDORIA_BACKEND || window.location.origin;

  function qs(id) {
    return document.getElementById(id);
  }

  window.adminLogin = async function adminLoginSecure() {
    const err = qs("loginError");
    if (err) err.textContent = "";

    const email = qs("adminEmail")?.value?.trim();
    const password = qs("adminPassword")?.value || "";
    const totpCode = qs("adminTotp")?.value?.trim() || "";

    if (!email || !password) {
      if (err) err.textContent = "Indiquez votre email et votre mot de passe.";
      return;
    }

    try {
      const response = await fetch(`${BACKEND}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, totpCode })
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        throw new Error("Réponse serveur illisible.");
      }

      if (data.requires2fa && !totpCode) {
        const row = qs("adminTotpRow");
        if (row) row.style.display = "block";
        if (err) err.textContent = "Code 2FA requis.";
        return;
      }

      if (!response.ok || !data.ok || !data.token) {
        if (err) err.textContent = data.error || "Connexion impossible.";
        return;
      }

      sessionStorage.setItem("cardoria_admin_connected", "yes");
      sessionStorage.setItem("cardoria_session_token", data.token);
      if (data.csrfToken) sessionStorage.setItem("cardoria_csrf_token", data.csrfToken);
      if (data.user?.email) sessionStorage.setItem("cardoria_admin_email", data.user.email);
      location.href = "admin.html";
    } catch (error) {
      if (err) err.textContent = `Serveur Cardoria indisponible : ${error.message}`;
    }
  };
})();
