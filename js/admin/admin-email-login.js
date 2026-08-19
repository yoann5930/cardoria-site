(async function () {
  "use strict";

  const status = document.getElementById("magicLoginStatus");
  const error = document.getElementById("magicLoginError");
  const token = new URLSearchParams(window.location.search).get("token") || "";

  if (!token) {
    if (status) status.textContent = "";
    if (error) error.textContent = "Lien de connexion invalide.";
    return;
  }

  try {
    const response = await fetch(`${window.location.origin}/api/auth/email/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      throw new Error("Réponse serveur illisible.");
    }

    if (!response.ok || !data.ok || !data.token) {
      if (status) status.textContent = "";
      if (error) error.textContent = data.error || "Lien de connexion invalide ou expiré.";
      return;
    }

    sessionStorage.setItem("cardoria_admin_connected", "yes");
    sessionStorage.setItem("cardoria_session_token", data.token);
    if (data.csrfToken) sessionStorage.setItem("cardoria_csrf_token", data.csrfToken);
    if (data.user?.email) sessionStorage.setItem("cardoria_admin_email", data.user.email);

    history.replaceState({}, "", "/admin-email-login.html");
    if (status) status.textContent = "Connexion validée. Redirection...";
    window.location.replace("/admin.html");
  } catch (e) {
    if (status) status.textContent = "";
    if (error) error.textContent = `Connexion impossible : ${e.message}`;
  }
})();
