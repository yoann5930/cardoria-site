(function () {
  "use strict";

  var token = new URLSearchParams(window.location.search).get("token") || "";
  var message = document.getElementById("resetMsg");
  var requestButton = document.getElementById("requestReset");
  var confirmButton = document.getElementById("confirmReset");

  if (token) {
    document.getElementById("requestBlock").style.display = "none";
    document.getElementById("confirmBlock").style.display = "block";
  }

  async function readJson(response) {
    var type = String(response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("application/json")) throw new Error("Réponse serveur invalide.");
    return response.json();
  }

  async function postJson(path, body) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 15000);
    var response;

    try {
      response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("Le serveur met trop de temps à répondre. Réessayez.");
      }
      throw new Error("Connexion au serveur Cardoria impossible. Rechargez la page puis réessayez.");
    } finally {
      window.clearTimeout(timeout);
    }

    var data = await readJson(response);
    if (!response.ok || !data.ok) throw new Error(data.error || "Opération impossible.");
    return data;
  }

  requestButton.addEventListener("click", async function () {
    var email = document.getElementById("resetEmail").value.trim();
    if (!email) {
      message.textContent = "Indiquez votre adresse e-mail.";
      return;
    }

    requestButton.disabled = true;
    message.textContent = "Envoi en cours…";
    try {
      var data = await postJson("/api/auth/password/request", { email: email });
      message.textContent = data.message || "Consultez votre boîte e-mail.";
    } catch (error) {
      message.textContent = error.message || "Envoi impossible.";
    } finally {
      requestButton.disabled = false;
    }
  });

  confirmButton.addEventListener("click", async function () {
    var password = document.getElementById("newPassword").value;
    var confirmation = document.getElementById("confirmPassword").value;

    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      message.textContent = "Utilisez au moins 10 caractères avec une lettre et un chiffre.";
      return;
    }
    if (password !== confirmation) {
      message.textContent = "Les deux mots de passe ne correspondent pas.";
      return;
    }

    confirmButton.disabled = true;
    message.textContent = "Mise à jour en cours…";
    try {
      await postJson("/api/auth/password/confirm", { token: token, password: password });
      window.history.replaceState({}, "", window.location.pathname);
      message.textContent = "Mot de passe mis à jour. Redirection…";
      window.setTimeout(function () { window.location.replace("/admin-login.html"); }, 1200);
    } catch (error) {
      message.textContent = error.message || "Réinitialisation impossible.";
      confirmButton.disabled = false;
    }
  });
})();

