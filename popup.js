// ============================================================================
// popup.js — Hautomatique v3 (multi-profils + spinner + background CSP)
// Stockage : chrome.storage.local {
//   aiProvider: "gemini" | "openai",
//   geminiApiKey: string,
//   openaiApiKey: string,
//   profils: [{ id:number, name:string, text:string }],
//   activeProfileId: number
// }
// Le texte envoyé au scan = contenu du <textarea> = brouillon du profil actif.
// ============================================================================

const userTextEl = document.getElementById("userText");
const fillBtn = document.getElementById("fillBtn");
const fillLabel = document.getElementById("fillLabel");
const statusEl = document.getElementById("status");
const providerSelect = document.getElementById("providerSelect");
const apiKeyEl = document.getElementById("apiKey");
const apiHint = document.getElementById("apiHint");
const saveKeyBtn = document.getElementById("saveKey");
const errorBox = document.getElementById("errorBox");
const errorIcon = document.getElementById("errorIcon");
const errorTitle = document.getElementById("errorTitle");
const errorDetail = document.getElementById("errorDetail");
const errorAction = document.getElementById("errorAction");
const profileSelect = document.getElementById("profileSelect");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const newProfileBtn = document.getElementById("newProfileBtn");
const deleteProfileBtn = document.getElementById("deleteProfileBtn");
const privacyToggle = document.getElementById("privacyToggle");
const privacyNote = document.getElementById("privacyNote");
const reportBox = document.getElementById("reportBox");

// --- Catalogue d'erreurs (codes du background / content script) ---
const ERROR_CATALOG = {
  API_KEY_INVALID: {
    icon: "🔑", title: "Clé API invalide",
    action: "Ouvrez ⚙ Options, vérifiez le provider sélectionné, puis collez une clé valide.",
  },
  API_FORBIDDEN: {
    icon: "⛔", title: "Accès API refusé (erreur 403)",
    action: "Gemini : activez « Generative Language API » dans Google Cloud. OpenAI : vérifiez les droits / la facturation de la clé.",
  },
  QUOTA_EXCEEDED: {
    icon: "⏳", title: "Quota IA dépassé (erreur 429)",
    action: "Patientez ~1 minute (quota gratuit) ou changez de clé API.",
  },
  EMPTY_TEXT: {
    icon: "📝", title: "Aucun texte à analyser",
    action: "Collez votre CV ou vos coordonnées dans la zone de texte, puis cliquez « Remplir ».",
  },
  NO_FIELDS: {
    icon: "🔍", title: "Aucun formulaire détecté",
    action: "Placez-vous sur une page contenant un formulaire. Pour tester : ouvrez index.html (sandbox QA).",
  },
  NO_MATCH: {
    icon: "🧩", title: "Aucune correspondance trouvée",
    action: "Le texte ne contient rien d'exploitable pour ce formulaire. Enrichissez-le (nom, email, ville…).",
  },
  GEMINI_EMPTY: {
    icon: "🤖", title: "Gemini n'a rien renvoyé",
    action: "Réessayez. Si ça persiste, raccourcissez le texte collé.",
  },
  GEMINI_BAD_JSON: {
    icon: "🤖", title: "Réponse Gemini illisible",
    action: "Réessayez simplement — le modèle renvoie parfois un JSON malformé.",
  },
  OPENAI_EMPTY: {
    icon: "🤖", title: "OpenAI n'a rien renvoyé",
    action: "Réessayez. Si ça persiste, raccourcissez le texte collé.",
  },
  OPENAI_BAD_JSON: {
    icon: "🤖", title: "Réponse OpenAI illisible",
    action: "Réessayez simplement — le modèle renvoie parfois un JSON malformé.",
  },
  NETWORK: {
    icon: "🌐", title: "Problème réseau / Service Worker",
    action: "Vérifiez votre connexion, puis rechargez l'extension dans chrome://extensions.",
  },
  GEMINI_ERROR: { icon: "⚠️", title: "Erreur Gemini", action: "Réessayez dans quelques instants." },
  OPENAI_ERROR: { icon: "⚠️", title: "Erreur OpenAI", action: "Réessayez dans quelques instants." },
  UNKNOWN: { icon: "⚠️", title: "Échec du remplissage", action: "" },
};

// Profils par défaut au premier lancement (le 3e reprend l'ancien lastText si présent)
function defaultProfiles(migratedText = "") {
  return [
    { id: 1, name: "💻 Mon CV Tech", text: migratedText },
    { id: 2, name: "📊 Mon CV Management", text: "" },
    { id: 3, name: "🏠 Infos Persos", text: "" },
  ];
}

// --- Lecteur .env minimal (popup : fichier empaqueté, ignoré par git) ---
// Retourne { gemini, openai }. Clés reconnues : GEMINI_API_KEY (+legacy
// DEFAULT_GEMINI_API_KEY), OPENAI_API_KEY (+legacy DEFAULT_OPENAI_API_KEY).
async function loadEnvKeys() {
  const out = { gemini: "", openai: "" };
  try {
    const res = await fetch("./.env");
    if (!res.ok) return out;
    for (const line of (await res.text()).split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      v = v.trim();
      if (!v) continue;
      if (m[1] === "GEMINI_API_KEY" || m[1] === "DEFAULT_GEMINI_API_KEY") out.gemini = out.gemini || v;
      if (m[1] === "OPENAI_API_KEY" || m[1] === "DEFAULT_OPENAI_API_KEY") out.openai = out.openai || v;
    }
  } catch { /* .env absent : repli config.js / saisie manuelle */ }
  return out;
}

// --- Descriptions par provider (placeholder, lien clé, repli config.js) ---
const PROVIDERS = {
  gemini: {
    label: "Gemini",
    placeholder: "AIza... votre clé Gemini",
    keyHint: "Obtenez une clé gratuite sur",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyName: "Google AI Studio",
    storageKey: "geminiApiKey",
    configKey: "DEFAULT_GEMINI_API_KEY",
  },
  openai: {
    label: "OpenAI",
    placeholder: "sk-... votre clé OpenAI",
    keyHint: "Obtenez une clé sur",
    keyUrl: "https://platform.openai.com/api-keys",
    keyName: "OpenAI Platform",
    storageKey: "openaiApiKey",
    configKey: "DEFAULT_OPENAI_API_KEY",
  },
};
function currentProvider() {
  return providerSelect?.value === "openai" ? "openai" : "gemini";
}
function refreshProviderUI() {
  const p = PROVIDERS[currentProvider()];
  apiKeyEl.placeholder = p.placeholder;
  if (apiHint) {
    apiHint.innerHTML = "";
    apiHint.append(
      document.createTextNode(p.keyHint + " "),
      Object.assign(document.createElement("a"), { href: p.keyUrl, target: "_blank", textContent: p.keyName }),
      document.createTextNode(". Elle est stockée uniquement dans votre navigateur (chrome.storage.local).")
    );
  }
}

// --- Chargement initial : provider + clés + profils (avec migration lastText v2) + toggle privacy ---
document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get(["aiProvider", "geminiApiKey", "openaiApiKey", "profils", "activeProfileId", "lastText", "privacyMask"]);
  const provider = stored.aiProvider === "openai" ? "openai" : "gemini";
  providerSelect.value = provider;
  refreshProviderUI();
  // Ordre de priorité : clé stockée → .env → config.js (repli vide)
  // (typeof garde-fou : les const de config.js peuvent être absentes)
  const env = await loadEnvKeys();
  const geminiCfg = (typeof DEFAULT_GEMINI_API_KEY !== "undefined" && DEFAULT_GEMINI_API_KEY) || "";
  const openaiCfg = (typeof DEFAULT_OPENAI_API_KEY !== "undefined" && DEFAULT_OPENAI_API_KEY) || "";
  const resolved = {
    gemini: stored.geminiApiKey || env.gemini || geminiCfg,
    openai: stored.openaiApiKey || env.openai || openaiCfg,
  };
  if (resolved.gemini && !stored.geminiApiKey) await chrome.storage.local.set({ geminiApiKey: resolved.gemini });
  if (resolved.openai && !stored.openaiApiKey) await chrome.storage.local.set({ openaiApiKey: resolved.openai });
  apiKeyEl.value = resolved[provider] || "";
  if (apiKeyEl.value) setStatus(`Clé ${PROVIDERS[provider].label} chargée ✔`, "success");
  if (privacyToggle) privacyToggle.checked = stored.privacyMask !== false; // activé par défaut

  let profils = stored.profils;
  if (!Array.isArray(profils) || profils.length === 0) {
    profils = defaultProfiles(stored.lastText || "");
    await chrome.storage.local.set({
      profils,
      activeProfileId: profils[0].id,
      lastText: "", // migration consommée
    });
  }
  const activeId = stored.activeProfileId ?? profils[0].id;
  renderProfileSelect(profils, activeId);
  const active = profils.find((p) => p.id === activeId) || profils[0];
  userTextEl.value = active.text || "";
});

// --- Rendu du <select> de profils ---
function renderProfileSelect(profils, activeId) {
  profileSelect.innerHTML = "";
  for (const p of profils) {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = p.name;
    if (p.id === activeId) opt.selected = true;
    profileSelect.appendChild(opt);
  }
}

async function getStore() {
  const s = await chrome.storage.local.get(["profils", "activeProfileId"]);
  return { profils: s.profils || [], activeProfileId: s.activeProfileId };
}

// --- Bascule de provider IA : recharge la clé correspondante dans le champ ---
providerSelect.addEventListener("change", async () => {
  const provider = currentProvider();
  await chrome.storage.local.set({ aiProvider: provider });
  const keys = await chrome.storage.local.get(["geminiApiKey", "openaiApiKey"]);
  const p = PROVIDERS[provider];
  apiKeyEl.value = keys[p.storageKey] || "";
  refreshProviderUI();
  hideError();
  setStatus(`Provider « ${p.label} » sélectionné.`, "");
});

// --- Bascule de profil : charge son texte dans le textarea ---
profileSelect.addEventListener("change", async () => {
  const { profils } = await getStore();
  const id = Number(profileSelect.value);
  await chrome.storage.local.set({ activeProfileId: id });
  const active = profils.find((p) => p.id === id);
  userTextEl.value = active?.text || "";
  hideError();
  setStatus(`Profil « ${active?.name || ""} » chargé.`, "");
});

// --- Sauvegarder : écrase le profil actif avec le contenu du textarea ---
saveProfileBtn.addEventListener("click", async () => {
  const { profils, activeProfileId } = await getStore();
  const idx = profils.findIndex((p) => p.id === activeProfileId);
  if (idx === -1) return;
  profils[idx].text = userTextEl.value;
  await chrome.storage.local.set({ profils });
  setStatus(`Profil « ${profils[idx].name} » sauvegardé ✔`, "success");
});

// --- Nouveau : crée un profil vide (nom via prompt natif du popup) ---
newProfileBtn.addEventListener("click", async () => {
  const name = (prompt("Nom du nouveau profil :", "Mon CV ...") || "").trim();
  if (!name) return; // annulé ou vide → on ne crée rien
  const { profils } = await getStore();
  const id = Date.now(); // id unique sans compteur
  profils.push({ id, name, text: userTextEl.value });
  await chrome.storage.local.set({ profils, activeProfileId: id });
  renderProfileSelect(profils, id);
  setStatus(`Profil « ${name} » créé ✔`, "success");
});

// --- Supprimer le profil actif (garde-fou : minimum 1 profil) ---
deleteProfileBtn.addEventListener("click", async () => {
  const { profils, activeProfileId } = await getStore();
  if (profils.length <= 1) {
    showError("UNKNOWN", "Impossible : conservez au moins un profil (videz son texte plutôt).");
    return;
  }
  const remaining = profils.filter((p) => p.id !== activeProfileId);
  await chrome.storage.local.set({ profils: remaining, activeProfileId: remaining[0].id });
  renderProfileSelect(remaining, remaining[0].id);
  userTextEl.value = remaining[0].text || "";
  setStatus("Profil supprimé.", "");
});

// --- Toggle vie privée (retiré du HTML épuré : protection toujours active par défaut) ---
if (privacyToggle) privacyToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ privacyMask: privacyToggle.checked });
  setStatus(privacyToggle.checked ? "Protection des données sensibles activée 🛡️" : "Protection désactivée : texte envoyé tel quel.", "");
});

// --- Clé API (sauvegardée pour le provider actif) ---
saveKeyBtn.addEventListener("click", async () => {
  const p = PROVIDERS[currentProvider()];
  const key = apiKeyEl.value.trim();
  if (!key) {
    showError("API_KEY_INVALID", `Collez d'abord votre clé ${p.label} (format ${currentProvider() === "openai" ? "sk-…" : "AIza…"}).`);
    return;
  }
  await chrome.storage.local.set({ [p.storageKey]: key, aiProvider: currentProvider() });
  hideError();
  setStatus(`Clé ${p.label} enregistrée ✔`, "success");
});

// --- Remplissage : envoie le texte du profil actif, avec spinner ---
fillBtn.addEventListener("click", async () => {
  hideError();
  hideReport();
  privacyNote.className = "";
  privacyNote.textContent = "";
  const text = userTextEl.value.trim();
  const provider = currentProvider();
  const p = PROVIDERS[provider];
  const storedKeys = await chrome.storage.local.get(["geminiApiKey", "openaiApiKey"]);
  let apiKey = storedKeys[p.storageKey];
  // Repli .env puis clé de dev si le storage est vide (ex: premier lancement sans ouvrir Options)
  if (!apiKey) apiKey = (await loadEnvKeys())[provider];
  if (!apiKey) {
    const cfgVal = provider === "openai"
      ? ((typeof DEFAULT_OPENAI_API_KEY !== "undefined" && DEFAULT_OPENAI_API_KEY) || "")
      : ((typeof DEFAULT_GEMINI_API_KEY !== "undefined" && DEFAULT_GEMINI_API_KEY) || "");
    if (cfgVal) apiKey = cfgVal;
  }

  if (!apiKey) {
    showError("API_KEY_INVALID", `Aucune clé ${p.label} enregistrée.`, "Ajoutez-la ci-dessous dans ⚙ Options.");
    document.getElementById("options").open = true;
    return;
  }
  if (!text) {
    showError("EMPTY_TEXT", "La zone de texte est vide.");
    userTextEl.focus();
    return;
  }
  if (text.length < 10) {
    showError("NO_MATCH", `"${text}" est trop court pour être exploité.`);
    return;
  }

  // Persistance silencieuse : le brouillon devient le contenu du profil actif
  const { profils, activeProfileId } = await getStore();
  const idx = profils.findIndex((p) => p.id === activeProfileId);
  if (idx !== -1 && profils[idx].text !== userTextEl.value) {
    profils[idx].text = userTextEl.value;
    await chrome.storage.local.set({ profils });
  }

  // verrouille + spinner (l'IA + la frappe humaine prennent plusieurs secondes)
  setLoading(true, "IA en cours de réflexion…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw Object.assign(new Error("Aucun onglet actif."), { code: "UNKNOWN" });
    if (/^(chrome|edge|about):/.test(tab.url || "")) {
      throw Object.assign(new Error("Page système protégée."), { code: "NO_FIELDS" });
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        action: "HAUTOMATIQUE_FILL",
        text,
        apiKey,
        provider,
      });
    } catch {
      // Content script absent (page chargée avant install) → injection puis réessai
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      setLoading(true, "Injection du scanner…");
      response = await chrome.tabs.sendMessage(tab.id, {
        action: "HAUTOMATIQUE_FILL",
        text,
        apiKey,
        provider,
      });
    }

    if (response?.ok) {
      setStatus(
        `Formulaire rempli ✔ (${response.filledCount} champ${response.filledCount > 1 ? "s" : ""}) — vérifiez avant d'envoyer, l'extension ne soumet jamais le formulaire.`,
        "success"
      );
      // Alerte vie privée : le background a masqué des données avant l'envoi
      showPrivacyNote(response.redactions, p.label);
      // Rapport Étape 6 : remplis / à vérifier / ignorés / manuel
      showReport(response.report);
    } else {
      showError(response?.code || "UNKNOWN", response?.error || "Échec du remplissage.");
    }
  } catch (e) {
    console.error("[Hautomatique] popup:", e);
    showError(e.code || "UNKNOWN", e.message);
  } finally {
    setLoading(false);
  }
});

// --- Loading : spinner + bouton verrouillé + libellé d'étape ---
function setLoading(on, label) {
  fillBtn.disabled = on;
  fillBtn.classList.toggle("loading", on);
  if (on) {
    fillLabel.textContent = label || "Traitement en cours…";
    setStatus("Ne fermez pas le popup : remplissage en cours…", "");
  } else {
    fillLabel.textContent = "✨ Remplir le formulaire";
  }
}

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || "";
}

function showError(code, detail, actionOverride) {
  const entry = ERROR_CATALOG[code] || ERROR_CATALOG.UNKNOWN;
  setStatus("", "");
  errorIcon.textContent = entry.icon;
  errorTitle.textContent = entry.title;
  errorDetail.textContent = detail ? ` ${detail}` : "";
  errorAction.textContent = actionOverride || entry.action || "";
  errorBox.className = "show err-" + code.toLowerCase();
}

function hideError() {
  errorBox.className = "";
}

// --- Rapport de vérification (workflow Étape 6 : remplis / incertains / ignorés / manuel) ---
function hideReport() {
  if (!reportBox) return;
  reportBox.className = "";
  reportBox.innerHTML = "";
}

function showReport(report) {
  if (!reportBox || !report) return;
  const { filled = [], uncertain = [], ignored = [], manual = [] } = report;
  if (!filled.length && !uncertain.length && !ignored.length && !manual.length) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const li = (arr) => arr.length ? `<ul>${arr.map((x) => `<li><code>${esc(x)}</code></li>`).join("")}</ul>` : "";
  reportBox.innerHTML =
    `<h3>🔍 Vérification — contrôlez puis soumettez vous-même</h3>` +
    (filled.length ? `✅ Remplis (confiance haute) : ${li(filled)}` : "") +
    (uncertain.length ? `<span class="warn">⚠️ À vérifier (confiance moyenne) : ${li(uncertain)}</span>` : "") +
    (ignored.length ? `<span class="muted">🚫 Ignorés (incertains, jamais forcés) : ${li(ignored)}</span>` : "") +
    (manual.length ? `<span class="muted">✍️ À compléter manuellement (aucune donnée) : ${li(manual)}</span>` : "");
  reportBox.className = "show";
}

// --- Note vie privée : récapitule les masquages effectués par le background ---
function showPrivacyNote(redactions, aiLabel = "l'IA") {
  if (!Array.isArray(redactions) || redactions.length === 0) {
    privacyNote.className = "";
    privacyNote.textContent = "";
    return;
  }
  const parts = redactions.map((r) => `${r.count}× ${r.type.toLowerCase()}`);
  privacyNote.textContent = `🛡️ Vie privée : ${parts.join(", ")} masqué(s) localement avant l'envoi à ${aiLabel}. Les formulaires ont reçu des masques, pas vos vrais numéros.`;
  privacyNote.className = "show";
}
