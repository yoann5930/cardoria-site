(function () {
  "use strict";
  var token = new URLSearchParams(window.location.search).get("token") || "";
  var message = document.getElementById("clientResetMessage");
  var requestForm = document.getElementById("clientResetRequestForm");
  var confirmForm = document.getElementById("clientResetConfirmForm");
  var requestButton = document.getElementById("clientResetRequestButton");
  var confirmButton = document.getElementById("clientResetConfirmButton");

  if (token) {
    requestForm.hidden = true;
    confirmForm.hidden = false;
  }

  function setMessage(text, type) {
    message.textContent = text || "";
    message.className = "client-auth-message" + (type ? " is-" + type : "");
  }

  async function postJson(path, body) {
    var response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body)
    });
    var data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok || data.ok === false) throw new Error(data.error || "Opération impossible.");
    return data;
  }

  requestForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    var email = document.getElementById("clientResetEmail").value.trim();
    if (!email) {
      setMessage("Indiquez votre adresse e-mail.", "error");
      return;
    }
    requestButton.disabled = true;
    setMessage("Envoi en cours…");
    try {
      var data = await postJson("/api/auth/password/request", { email: email });
      setMessage(data.message || "Si le compte existe, un e-mail a été envoyé.", "success");
    } catch (error) {
      setMessage(error.message || "Envoi impossible.", "error");
    } finally {
      requestButton.disabled = false;
    }
  });

  confirmForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    var password = document.getElementById("clientResetPassword").value;
    var confirmation = document.getElementById("clientResetPasswordConfirm").value;
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setMessage("Utilisez au moins 10 caractères avec une lettre et un chiffre.", "error");
      return;
    }
    if (password !== confirmation) {
      setMessage("Les deux mots de passe ne correspondent pas.", "error");
      return;
    }
    confirmButton.disabled = true;
    setMessage("Mise à jour en cours…");
    try {
      await postJson("/api/auth/password/confirm", { token: token, password: password });
      window.history.replaceState({}, "", window.location.pathname);
      setMessage("Mot de passe mis à jour. Redirection…", "success");
      window.setTimeout(function () { window.location.replace("/client-login.html"); }, 1200);
    } catch (error) {
      setMessage(error.message || "Réinitialisation impossible.", "error");
      confirmButton.disabled = false;
    }
  });
})();
