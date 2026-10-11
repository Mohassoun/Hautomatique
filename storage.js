// ============================================================================
// storage.js — Hautomatique : petit fichier storage centralisé
// Rôle : toutes les infos utilisateur vivent ici (chrome.storage.local).
//   {
//     aiProvider: "gemini" | "openai",
//     geminiApiKey: string, openaiApiKey: string,
//     profils: [{ id:number, name:string, text:string }],
//     activeProfileId: number,
//     privacyMask: boolean (défaut true)
//   }
// Usage popup  : <script src="storage.js"></script> puis HautomatiqueStorage.loadState()
// Usage worker : importScripts("storage.js") — ne pas utiliser window/document ici.
// Rétro-compat : migre l'ancien "lastText" v2 vers le 1er profil si présent.
// ============================================================================
/* global chrome */

const HAUTO_DEFAULTS = {
  aiProvider: "gemini",
  geminiApiKey: "",
  openaiApiKey: "",
  profils: [],
  activeProfileId: 0,
  privacyMask: true,
};

function haotoDefaultProfiles(migratedText = "") {
  return [
    { id: 1, name: "💻 Mon CV Tech", text: migratedText || "" },
    { id: 2, name: "📊 Mon CV Management", text: "" },
    { id: 3, name: "🏠 Infos Persos", text: "" },
  ];
}

const HautomatiqueStorage = {
  defaults: HAUTO_DEFAULTS,

  /** Charge tout l'état + migre lastText si besoin. Retourne l'état complet. */
  async loadState() {
    const stored = await chrome.storage.local.get([
      "aiProvider", "geminiApiKey", "openaiApiKey",
      "profils", "activeProfileId", "lastText", "privacyMask",
    ]);

    let profils = stored.profils;
    if (!Array.isArray(profils) || profils.length === 0) {
      profils = haotoDefaultProfiles(stored.lastText || "");
      const patch = { profils, activeProfileId: profils[0].id, lastText: "" };
      await chrome.storage.local.set(patch);
      stored.activeProfileId = patch.activeProfileId;
    }
    // Garde-fou : activeProfileId doit exister
    if (!profils.some((p) => p.id === stored.activeProfileId)) {
      stored.activeProfileId = profils[0].id;
      await chrome.storage.local.set({ activeProfileId: stored.activeProfileId });
    }

    return {
      aiProvider: stored.aiProvider === "openai" ? "openai" : "gemini",
      geminiApiKey: stored.geminiApiKey || "",
      openaiApiKey: stored.openaiApiKey || "",
      profils,
      activeProfileId: stored.activeProfileId ?? profils[0].id,
      privacyMask: stored.privacyMask !== false,
    };
  },

  /** Sauvegarde partielle : ex saveState({ activeProfileId: 123 }) */
  async saveState(patch) {
    await chrome.storage.local.set(patch || {});
  },

  /** Profil actif + liste — ce que le popup / headless utilisent le plus. */
  async getActiveProfile() {
    const { profils, activeProfileId } = await this.loadState();
    const active = profils.find((p) => p.id === activeProfileId) || profils[0];
    return { profils, active, activeProfileId: active.id };
  },

  /** Écrase le texte du profil actif (brouillon du textarea). */
  async saveActiveText(text) {
    const { profils, activeProfileId } = await this.getActiveProfile();
    const idx = profils.findIndex((p) => p.id === activeProfileId);
    if (idx === -1) return null;
    profils[idx].text = text ?? "";
    await chrome.storage.local.set({ profils });
    return profils[idx];
  },

  /** Crée un profil (texte initial = brouillon courant). Retourne le profil créé. */
  async createProfile(name, text = "") {
    const clean = String(name || "").trim();
    if (!clean) return null;
    const { profils } = await this.getActiveProfile();
    const created = { id: Date.now(), name: clean, text: text || "" };
    profils.push(created);
    await chrome.storage.local.set({ profils, activeProfileId: created.id });
    return created;
  },

  /** Supprime le profil actif (min 1 profil). Retourne le nouveau profil actif. */
  async deleteActiveProfile() {
    const { profils, activeProfileId } = await this.getActiveProfile();
    if (profils.length <= 1) throw new Error("Conservez au moins un profil.");
    const remaining = profils.filter((p) => p.id !== activeProfileId);
    await chrome.storage.local.set({ profils: remaining, activeProfileId: remaining[0].id });
    return remaining[0];
  },

  async setActiveProfile(id) {
    await chrome.storage.local.set({ activeProfileId: Number(id) });
  },

  // --- Provider + clés API ---
  async getProvider() {
    const { aiProvider } = await chrome.storage.local.get("aiProvider");
    return aiProvider === "openai" ? "openai" : "gemini";
  },
  async setProvider(provider) {
    const clean = provider === "openai" ? "openai" : "gemini";
    await chrome.storage.local.set({ aiProvider: clean });
    return clean;
  },
  async getApiKey(provider) {
    const p = provider === "openai" ? "openai" : "gemini";
    const keys = await chrome.storage.local.get(["geminiApiKey", "openaiApiKey"]);
    return p === "openai" ? (keys.openaiApiKey || "") : (keys.geminiApiKey || "");
  },
  async setApiKey(provider, key) {
    const p = provider === "openai" ? "openai" : "gemini";
    const clean = String(key || "").trim();
    if (p === "openai") await chrome.storage.local.set({ openaiApiKey: clean, aiProvider: "openai" });
    else await chrome.storage.local.set({ geminiApiKey: clean, aiProvider: "gemini" });
    return clean;
  },

  // --- Vie privée ---
  async getPrivacyMask() {
    const { privacyMask } = await chrome.storage.local.get("privacyMask");
    return privacyMask !== false;
  },
  async setPrivacyMask(on) {
    await chrome.storage.local.set({ privacyMask: !!on });
  },
};

// Expose global pour popup (window) + worker (globalThis via importScripts)
try {
  if (typeof globalThis !== "undefined") {
    globalThis.HautomatiqueStorage = HautomatiqueStorage;
    globalThis.HAUTO_DEFAULTS = HAUTO_DEFAULTS;
  }
} catch { /* contexte non standard : ignorer */ }
