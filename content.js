// ============================================================================
// content.js — Hautomatique v3 (délégation CSP via background.js)
// Pipeline : 1) scan local → 2) background FETCH_GEMINI → 3) remplissage local
// Le fetch Gemini NE se fait plus ici (CSP des sites stricts le bloquaient).
// Le prompt système vit désormais dans background.js (source de vérité).
// ============================================================================

// --- Erreurs codées : le popup affiche un visuel différent selon e.code ---
function codedError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// --- Écouteurs : FILL (popup / headless) + PING de présence (raccourci / clic droit) ---
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action === "HAUTOMATIQUE_PING") {
    sendResponse({ ok: true, pong: true });
    return false;
  }
  if (msg?.action !== "HAUTOMATIQUE_FILL") return false;
  handleFill(msg.text, msg.apiKey, msg.provider)
    .then(({ filledCount, redactions, report }) => sendResponse({ ok: true, filledCount, redactions, report }))
    .catch((err) => {
      console.error("[Hautomatique]", err);
      sendResponse({ ok: false, error: err.message, code: err.code || "UNKNOWN" });
    });
  return true; // canal async maintenu ouvert
});

// ============================================================================
// ORCHESTRATION
// ============================================================================
async function handleFill(userText, apiKey, provider) {
  if (!userText || !userText.trim()) {
    throw codedError("EMPTY_TEXT", "Aucun texte à analyser : collez votre CV ou vos coordonnées.");
  }
  const aiLabel = provider === "openai" ? "OpenAI" : "Gemini";
  const fields = scanFormFields();
  if (fields.length === 0) {
    throw codedError("NO_FIELDS", "Aucun champ de formulaire détecté sur cette page (ou seuls des champs sensibles exclus : mots de passe, paiement).");
  }
  const { mapping, details, redactions } = await callGemini(fields, userText, apiKey, provider);
  const keys = Object.keys(mapping || {});
  // Rapport Étape 6 même en cas d'échec partiel : champs sans match → manuel
  const matchedIds = new Set([...keys, ...(details || []).map((d) => d.field_id)]);
  const manual = fields.map((f) => f.identifier).filter((id) => !matchedIds.has(id));
  const lowIds = (details || []).filter((d) => d.confidence === "low").map((d) => d.field_id);
  if (keys.length === 0) {
    throw codedError("NO_MATCH", `${aiLabel} n'a extrait aucune donnée exploitable de ce texte (les matchs incertains ont été écartés, voir rapport).`);
  }
  const { filled, uncertain, ignored } = await fillFields(mapping, details || []); // async → frappe humaine
  if (filled.length === 0 && uncertain.length === 0) {
    throw codedError("NO_MATCH", "Aucune correspondance : le texte ne semble lié à aucun champ du formulaire.");
  }
  const report = {
    filled,
    uncertain, // medium → remplis mais à vérifier par l'utilisateur
    ignored: [...new Set([...ignored, ...lowIds])], // low → jamais auto-remplis
    manual, // aucun match → restent vides
  };
  return { filledCount: filled.length + uncertain.length, redactions, report };
}

// ============================================================================
// ÉTAPE 1 — SCAN DES CHAMPS VISIBLES (inchangé v1, + value/label pour radios)
// ============================================================================
function scanFormFields() {
  const nodes = document.querySelectorAll("input, textarea, select");
  const fields = [];
  const usedIdentifiers = new Set();

  nodes.forEach((el, index) => {
    if (!isVisible(el) || el.disabled || el.readOnly) return;
    const type = (el.type || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "file"].includes(type)) return;
    // --- documents/workflow.md §6 + agent.md §3 : champs sensibles exclus par défaut ---
    // Mots de passe, secrets, paiement/CB, IBAN, sécu → jamais scannés ni envoyés à l'IA.
    if (isSensitiveField(el, type)) return;

    let identifier = el.id || el.name || el.placeholder || slugify(getLabelText(el)) || `field_${index}`;
    identifier = slugify(identifier) || `field_${index}`;
    let unique = identifier, n = 2;
    while (usedIdentifiers.has(unique)) unique = `${identifier}_${n++}`;
    usedIdentifiers.add(unique);

    const field = {
      identifier: unique,
      tag: el.tagName.toLowerCase(),
      type,
      id: el.id || "",
      name: el.name || "",
      placeholder: el.placeholder || "",
      label: getLabelText(el),
      autocomplete: el.getAttribute("autocomplete") || "",
    };
    if (el.tagName === "SELECT") {
      // On envoie texte + valeur pour aider Gemini, mais on lui demande le libellé
      field.options = [...el.options]
        .map((o) => ({ text: o.text.trim(), value: o.value }))
        .filter((o) => o.text || o.value);
    }
    if (["checkbox", "radio"].includes(type)) {
      field.value = el.value || "on";
      field.optionLabel = getLabelText(el); // libellé visible du choix ("Homme", "Python"...)
    }
    el.dataset.hautomatiqueId = unique;
    fields.push(field);
  });
  return fields;
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  return true;
}

// --- Filtre sécurité (documents/workflow.md §6, agent.md §3) ---
// Exclut par défaut : passwords, secrets/token, cartes (cc-*), CVC, IBAN, sécu.
// L'agent ne doit jamais recevoir ces données sauf fonctionnalité dédiée autorisée.
function isSensitiveField(el, type) {
  if (type === "password") return true;
  const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
  // Tokens d'autocomplete sensibles : current/new-password, cc-*, etc.
  if (/(password|cc-number|cc-exp|cc-csc|cc-cvv|cc-name|card|cvv|cvc)/.test(auto)) return true;
  const hay = `${el.id || ""} ${el.name || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
  if (/(motdepasse|mot-de-passe|password|passwd|pwd|secret|token|api-?key|cvv|cvc|cardnumber|carte-?bancaire|num-?carte|iban|s[eé]cu|nir|cryptogramme)/.test(hay)) return true;
  return false;
}

// --- Normalisation date (workflow Étape 5 : conversion vers le format attendu) ---
// <input type="date"> exige AAAA-MM-JJ. Convertit JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA, etc.
function normalizeDateForInput(value) {
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // déjà OK
  let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:\D.*)?$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = s.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return s; // format libre (ex: "15 avril 1992") : laisser tel quel, l'utilisateur vérifiera
}

function getLabelText(el) {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.innerText.trim()) return label.innerText.trim().slice(0, 120);
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel) {
    const clone = wrappingLabel.cloneNode(true);
    clone.querySelectorAll("input,select,textarea").forEach((n) => n.remove());
    if (clone.innerText.trim()) return clone.innerText.trim().slice(0, 120);
  }
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim().slice(0, 120);
  const parentText = el.parentElement?.innerText?.trim().split("\n")[0];
  if (parentText && parentText.length < 80 && parentText.length > 1) return parentText.slice(0, 120);
  return "";
}

function slugify(s) {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

// ============================================================================
// ÉTAPE 2 — DÉLÉGATION AU BACKGROUND (contournement CSP)
// Le content script ne fait plus de fetch direct : il transmet le scan via
// chrome.runtime.sendMessage({action:"FETCH_GEMINI", ...}). Le Service Worker
// (contexte extension, insensible à la CSP du site) appelle l'IA (Gemini/OpenAI)
// puis renvoie { ok:true, mapping } ou { ok:false, error, code }.
// ============================================================================
async function callGemini(fields, userText, apiKey, provider) {
  let res;
  try {
    res = await chrome.runtime.sendMessage({
      action: "FETCH_GEMINI",
      fields,
      text: userText,
      apiKey,
      provider: provider === "openai" ? "openai" : "gemini",
    });
  } catch (e) {
    // Service Worker endormi / extension rechargée : message sans réponse
    throw codedError("NETWORK", "Service Worker injoignable. Rechargez l'extension dans chrome://extensions.");
  }
  if (!res) {
    throw codedError("NETWORK", "Aucune réponse du Service Worker. Rechargez l'extension.");
  }
  if (!res.ok) {
    // Propage le code métier du background (400, 401, 429...) tel quel au popup
    throw codedError(res.code || "GEMINI_ERROR", res.error || "Erreur IA inconnue.");
  }
  // Transmet aussi les masquages vie privée + les détails de confiance (agent.md §6-7)
  return { mapping: res.mapping, details: res.details || [], redactions: res.redactions || [] };
}

// ============================================================================
// ÉTAPE 3 — REMPLISSAGE (async : frappe humaine pour textes, sémantique select/radio)
// ============================================================================
async function fillFields(mapping, details = []) {
  // Drapeau de remplissage : les pages (ex: sandbox QA) peuvent détecter
  // une injection asynchrone en cours via document.documentElement.dataset.hautomatiqueBusy
  // et différer leur lecture synchrone (submit) le temps que la frappe se termine.
  document.documentElement.dataset.hautomatiqueBusy = "true";
  const confById = new Map(details.map((d) => [d.field_id, d.confidence || "medium"]));
  const filled = [], uncertain = [], ignored = [];
  try {
  for (const [identifier, value] of Object.entries(mapping)) {
    const el = document.querySelector(`[data-hautomatique-id="${CSS.escape(identifier)}"]`);
    if (!el || value === null || value === undefined || value === "") { ignored.push(identifier); continue; }
    // Sécurité : low déjà filtré côté background, mais on refuse ici aussi par principe
    if (confById.get(identifier) === "low") { ignored.push(identifier); continue; }
    try {
      const tag = el.tagName.toLowerCase();
      const type = (el.type || "").toLowerCase();
      let ok = false;

      if (tag === "select") {
        ok = selectBestOption(el, value);
      } else if (type === "radio") {
        ok = checkBestRadio(el, value);
      } else if (type === "checkbox") {
        ok = applyCheckbox(el, identifier, value);
      } else if (type === "date") {
        // Workflow Étape 5 : conversion vers AAAA-MM-JJ avant insertion
        await typeLikeHuman(el, normalizeDateForInput(value));
        ok = true;
        flashField(el);
      } else {
        // Texte : frappe humaine simulée (await → séquentiel, plus crédible anti-bot)
        await typeLikeHuman(el, String(value));
        ok = true;
        flashField(el);
      }
      if (!ok) { ignored.push(identifier); continue; }
      if (confById.get(identifier) === "medium") uncertain.push(identifier);
      else filled.push(identifier);
    } catch (e) {
      console.warn(`[Hautomatique] champ "${identifier}" ignoré :`, e);
      ignored.push(identifier);
    }
  }
  } finally {
    delete document.documentElement.dataset.hautomatiqueBusy;
  }
  return { filled, uncertain, ignored };
}

// Normalisation agressive : "France (FR - 01)" → "france fr 01"
function norm(s) {
  return (s ?? "")
    .toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

// Dictionnaire d'équivalences métier (étendable). Clé = forme canonique normalisée.
const ALIASES = {
  // Pays
  "france": ["fr", "fra", "france 01", "french", "republique francaise"],
  "belgique": ["be", "bel", "belgium"],
  "etats unis d amerique": ["us", "usa", "etats unis", "america", "united states"],
  "canada": ["ca", "can"],
  "allemagne": ["de", "deutschland", "germany", "ger"],
  // Genre
  "homme": ["h", "m", "male", "man", "masculin", "monsieur", "mr"],
  "femme": ["f", "female", "woman", "feminin", "madame", "mme", "ms"],
  "autre": ["x", "autre", "ne se prononce pas", "non binaire", "other"],
  // Études
  "baccalaureat": ["bac"],
  "bac 2 bts dut": ["bac2", "bac 2", "bts", "dut"],
  "bac 3 licence": ["bac3", "bac 3", "licence"],
  "bac 5 master ingenieur": ["bac5", "bac 5", "master", "ingenieur", "bac 8"],
  "doctorat phd": ["phd", "doctorat", "doc"],
  // Contrat
  "cdi temps plein": ["cdi", "temps plein", "full time"],
  "cdd": ["cdd", "fixed term"],
  "freelance independant": ["freelance", "independant", "independent", "contractor"],
  "stage": ["stage", "internship", "intern"],
};

// Toutes les formes canoniques + variantes connues pour une valeur
function expandForms(s) {
  const n = norm(s);
  const out = new Set([n]);
  for (const [canon, variants] of Object.entries(ALIASES)) {
    if (n === canon || variants.includes(n)) {
      out.add(canon);
      variants.forEach((v) => out.add(v));
    }
  }
  return [...out];
}

// Distance de Levenshtein → similarité 0..1 (tolère fautes de frappe)
function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > Math.max(m, n) * 0.5) {
    // Trop éloignés en longueur → teste quand même l'inclusion
    return a.includes(b) || b.includes(a) ? 0.65 : 0;
  }
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

// Score 0..100 entre la valeur voulue et un candidat (texte ou value d'option)
function scoreCandidate(wanted, candidate) {
  const wForms = expandForms(wanted);
  const cForms = expandForms(candidate);
  let best = 0;
  for (const w of wForms) {
    for (const c of cForms) {
      if (w === c) return 100;                       // égalité (ou via alias)
      if (w && c && (c.includes(w) || w.includes(c))) best = Math.max(best, 78);
      const sim = similarity(w, c);
      if (sim >= 0.72) best = Math.max(best, Math.round(sim * 80)); // flou
      // Chevauchement de tokens ("france fr" vs "france") : Jaccard
      const wt = new Set(w.split(" ")), ct = new Set(c.split(" "));
      const inter = [...wt].filter((t) => ct.has(t)).length;
      const union = new Set([...wt, ...ct]).size;
      if (union && inter / union >= 0.5) best = Math.max(best, 70);
    }
  }
  return best;
}

// --- <select> : choisit la meilleure option (texte OU valeur), seuil 55/100 ---
function selectBestOption(selectEl, wanted) {
  const target = Array.isArray(wanted) ? wanted[0] : wanted;
  let bestOpt = null, bestScore = 0;
  for (const opt of selectEl.options) {
    const s = Math.max(scoreCandidate(target, opt.text), scoreCandidate(target, opt.value));
    if (s > bestScore) { bestScore = s; bestOpt = opt; }
  }
  if (bestOpt && bestScore >= 55) {
    selectEl.value = bestOpt.value;
    selectEl.dispatchEvent(new Event("input", { bubbles: true }));
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    flashField(selectEl);
    return true;
  }
  return false;
}

// --- Radios : coche le meilleur bouton du GROUPE (même name), seuil 55/100 ---
function checkBestRadio(el, wanted) {
  const target = Array.isArray(wanted) ? wanted[0] : wanted;
  // Groupe = tous les radios partageant le même name (sinon l'élément seul)
  const group = el.name
    ? [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)]
    : [el];
  let best = null, bestScore = 0;
  for (const r of group) {
    // Indices : value, label visible, aria-label, id/name
    const signals = [r.value, getLabelText(r), r.getAttribute("aria-label") || "", r.id];
    const s = Math.max(...signals.map((sig) => scoreCandidate(target, sig || "")));
    if (s > bestScore) { bestScore = s; best = r; }
  }
  if (best && bestScore >= 55) {
    best.checked = true;
    best.dispatchEvent(new Event("input", { bubbles: true }));
    best.dispatchEvent(new Event("change", { bubbles: true }));
    best.dispatchEvent(new MouseEvent("click", { bubbles: true })); // certains validateurs écoutent click
    flashField(best);
    return true;
  }
  return false;
}

// --- Checkbox : gère valeur unique OU tableau (ex: skills: ["Python","SQL"]) ---
function applyCheckbox(el, identifier, value) {
  const values = Array.isArray(value) ? value : String(value).split(/[,;|]/);
  // Groupe de checkboxes partageant le même name (ex: name="skills")
  const group = el.name
    ? [...document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name)}"]`)]
    : [el];
  let hit = false;

  if (group.length > 1) {
    // Multi-choix : coche chaque case dont le score dépasse le seuil pour l'une des valeurs
    for (const box of group) {
      const signals = [box.value, getLabelText(box)];
      const s = Math.max(...values.flatMap((v) =>
        signals.map((sig) => scoreCandidate(v, sig || ""))));
      // Booléen simple ("true") + une seule case → coche directement
      const boolTrue = values.length === 1 && ["true", "on", "yes", "oui", "1"]
        .includes(norm(values[0])) && box.dataset.hautomatiqueId === identifier;
      if (s >= 55 || boolTrue) {
        box.checked = true;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
        flashField(box);
        hit = true;
      }
    }
    return hit;
  }
  // Case isolée (ex: "J'accepte les CGU")
  const truthy = ["true", "on", "yes", "oui", "1", el.value.toLowerCase()];
  el.checked = truthy.includes(norm(values[0])) || scoreCandidate(values[0], el.value) >= 55
    || scoreCandidate(values[0], getLabelText(el)) >= 55;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  flashField(el);
  return true;
}

// ---------------------------------------------------------------------------
// 3B. FRAPPE HUMAINE SIMULÉE (anti-bot : Workday, Greenhouse, Lever...)
// Frappe caractère par caractère avec délais aléatoires + vrais key events,
// au lieu d'un el.value = "..." d'un coup (détecté comme bot).
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function setNativeValue(el, value) {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function fireKey(el, type, key) {
  el.dispatchEvent(new KeyboardEvent(type, {
    key, bubbles: true, cancelable: true,
    charCode: key.charCodeAt(0) || 0, keyCode: key.charCodeAt(0) || 0,
  }));
}

async function typeLikeHuman(el, text) {
  el.scrollIntoView({ block: "nearest", behavior: "instant" });
  el.focus();
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));

  // Vide le champ comme un humain (Ctrl+A + Backspace)
  setNativeValue(el, "");
  el.dispatchEvent(new Event("input", { bubbles: true }));

  let current = "";
  for (const char of text) {
    fireKey(el, "keydown", char);
    // Saisie via execCommand (traverse les handlers React) avec repli natif
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, char);
    } catch { /* execCommand déprécié mais encore supporté */ }
    if (!inserted) {
      current += char;
      setNativeValue(el, current);
    }
    // keypress (caractères imprimables) + input + keyup, comme un vrai clavier
    if (char !== "\n") {
      el.dispatchEvent(new Event("keypress", { bubbles: true }));
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }));
    fireKey(el, "keyup", char);
    // Délai humain ultra-rapide : 6–24 ms/char (~50–150 cps) + pause mot occasionnelle
    await sleep(char === " " && Math.random() < 0.15 ? rand(40, 90) : rand(6, 24));
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

// --- Surbrillance verte éphémère pour montrer ce qui a été rempli ---
function flashField(el) {
  try {
    const prev = el.style.boxShadow;
    el.style.boxShadow = "0 0 0 3px rgba(5,150,105,.45)";
    el.style.transition = "box-shadow .4s ease";
    setTimeout(() => { el.style.boxShadow = prev; }, 1200);
  } catch { /* champ sans style (SVG...) */ }
}
