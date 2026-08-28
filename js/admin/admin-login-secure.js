(function () {
  "use strict";

  const BACKEND = window.CARDORIA_BACKEND || (window.CARDORIA_SEO && window.CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";
  const ADMIN_ROLES = ["super_admin", "admin", "employee"];

  function qs(id) { return document.getElementById(id); }
  function clearMessages() { const err=qs("loginError"),success=qs("loginSuccess"); if(err)err.textContent=""; if(success)success.textContent=""; }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs || 12000) : null;
    try { return await fetch(url, { ...(options || {}), signal: controller ? controller.signal : options?.signal }); }
    finally { if (timer) clearTimeout(timer); }
  }

  function saveSession(data, fallbackEmail) {
    sessionStorage.setItem("cardoria_admin_connected", "yes");
    sessionStorage.setItem("cardoria_session_token", data.token);
    sessionStorage.setItem("cardoria_admin_email", data.user?.email || fallbackEmail || "");
    if (data.csrfToken) sessionStorage.setItem("cardoria_csrf_token", data.csrfToken);
    else sessionStorage.removeItem("cardoria_csrf_token");
    if (data.expiresAt) sessionStorage.setItem("cardoria_session_expires_at", data.expiresAt);
    sessionStorage.removeItem("cardoria_admin_code");
  }

  async function validateExistingSession() {
    const token = sessionStorage.getItem("cardoria_session_token") || "";
    if (!token) return;
    try {
      const response = await fetchWithTimeout(`${BACKEND}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }, 7000);
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      if (data.ok && ADMIN_ROLES.includes(data.user?.role)) location.replace("admin-stock.html");
    } catch (_) {}
  }

  async function loginWithPassword(event) {
    event?.preventDefault(); clearMessages();
    const err=qs("loginError"),email=qs("adminEmail")?.value?.trim(),password=qs("adminPassword")?.value||"",button=qs("adminPasswordLoginForm")?.querySelector("button[type='submit']");
    if(!email||!password){if(err)err.textContent="Indiquez votre e-mail et votre mot de passe.";return;}
    if(button)button.disabled=true;
    try {
      const response=await fetchWithTimeout(`${BACKEND}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})},12000);
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok||!data.token){if(err)err.textContent=data.error||"Connexion impossible.";return;}
      if(!ADMIN_ROLES.includes(data.user?.role)){
        try{await fetch(`${BACKEND}/api/auth/logout`,{method:"POST",headers:{Authorization:`Bearer ${data.token}`}});}catch{}
        if(err)err.textContent="Ce compte n'est pas autorisé à accéder à l'administration.";return;
      }
      saveSession(data,email);
      location.replace("admin-stock.html");
    } catch(error) {
      if(err)err.textContent=error?.name==="AbortError"?"Le serveur Cardoria met trop de temps à répondre. Réessaie dans quelques secondes.":`Serveur Cardoria indisponible : ${error.message}`;
    } finally { if(button)button.disabled=false; }
  }

  async function requestAdminEmailLink(event) {
    event?.preventDefault(); clearMessages();
    const err=qs("loginError"),success=qs("loginSuccess"),email=qs("adminEmail")?.value?.trim();
    if(!email){if(err)err.textContent="Indiquez votre adresse e-mail.";return;}
    const button=qs("adminEmailLoginForm")?.querySelector("button[type='submit']"); if(button)button.disabled=true;
    try {
      const response=await fetchWithTimeout(`${BACKEND}/api/auth/email/request`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})},12000);
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok){if(err)err.textContent=data.error||"Envoi du lien impossible.";return;}
      if(success)success.textContent=data.message||"Lien de connexion envoyé. Consultez votre boîte e-mail.";
    } catch(error) {
      if(err)err.textContent=error?.name==="AbortError"?"Le serveur Cardoria met trop de temps à répondre.":`Serveur Cardoria indisponible : ${error.message}`;
    } finally { if(button)button.disabled=false; }
  }

  document.addEventListener("DOMContentLoaded",()=>{
    validateExistingSession();
    qs("adminPasswordLoginForm")?.addEventListener("submit",loginWithPassword);
    qs("adminEmailLoginForm")?.addEventListener("submit",requestAdminEmailLink);
  });
})();
