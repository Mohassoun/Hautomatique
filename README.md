<p align="center">
  <img src="icons/icon128.png" alt="Logo Hautomatique" width="96" />
</p>

<h1 align="center">Hautomatique</h1>

<p align="center">
  <strong>Autofill intelligent propulsé par l'IA</strong><br/>
  Collez un texte brut (CV, bio, coordonnées) et laissez Gemini ou OpenAI remplir le formulaire de la page active.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?logo=googlechrome" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/IA-Gemini%20%7C%20OpenAI-8E8E93" alt="Gemini / OpenAI" />
  <img src="https://img.shields.io/badge/langage-JavaScript-F7DF1E?logo=javascript" alt="JavaScript" />
</p>

---

## 🎯 Présentation

**Hautomatique** est une extension Chrome (Manifest V3) qui automatise le remplissage des formulaires en ligne. L'utilisateur fournit ses informations **une seule fois** (sous forme de texte libre), puis l'extension analyse les champs de la page, les interprète grâce à un modèle d'IA et associe chaque champ à la donnée correspondante.

Fini les copier-coller interminables sur les formulaires de candidature, d'inscription ou de contact : vérifiez, puis soumettez.

## ✨ Fonctionnalités

- **🤖 IA à la demande** — Support de **Gemini** (`gemini-2.5-flash`) et **OpenAI** (`gpt-4o-mini`), commutables depuis le popup.
- **📄 Texte libre → formulaire** — Collez un CV, une bio ou n'importe quel bloc de texte : l'IA s'occupe de l'association champ ↔ donnée.
- **👥 Profils multiples** — Créez, sauvegardez, changez ou supprimez des profils, stockés localement (`chrome.storage.local`).
- **🧠 Détection large** — Champs `input` (texte, email, tel, date…), `textarea`, `select`, cases à cocher et boutons radio, y compris les libellés associés.
- **⌨️ Compatible React** — Remplissage « à la main » (frappe simulée + setters natifs + événements) pour déclencher correctement les frameworks modernes.
- **🛡️ Champs sensibles ignorés** — Les mots de passe et champs bancaires ne sont jamais remplis automatiquement.
- **✅ Rapport de vérification** — Récapitulatif des champs remplis, champs manuels restants et avertissements sur les correspondances peu fiables.
- **🎭 Masque confidentialité** — Option de masquage des données dans le rapport.
- **⚡ Remplissage sans popup** — Raccourci clavier ou menu contextuel, avec retour visuel sur l'icône (✓ vert / ! rouge).

## 🚀 Installation

1. **Cloner** le dépôt :

   ```bash
   git clone https://github.com/Mohassoun/Hautomatique.git
   cd Hautomatique
   ```

2. **Configurer votre clé API** (voir section suivante).

3. Ouvrir `chrome://extensions/` dans Chrome, activer le **Mode développeur** (en haut à droite).

4. Cliquer sur **« Charger l'expansion non empaquetée »** et sélectionner le dossier `Hautomatique`.

5. 🎉 L'icône Hautomatique apparaît dans la barre d'outils.

## 🔑 Configuration des clés API

L'extension a besoin d'une clé API pour un des deux providers (au minimum).

**Option 1 — Fichier `.env` (recommandé, pour le développement) :**

```env
GEMINI_API_KEY=AIza...   # https://aistudio.google.com/app/apikey
OPENAI_API_KEY=sk-...    # https://platform.openai.com/api-keys (optionnelle)
```

**Option 2 — `config.js` :**

```bash
cp config.example.js config.js
# puis renseigner DEFAULT_GEMINI_API_KEY / DEFAULT_OPENAI_API_KEY
```

**Option 3 — Directement dans le popup :** menu **⚙️ Réglages → Clé API → Sauver**.

> ⚠️ **`config.js` et `.env` ne doivent jamais être commités** (ils sont listés dans `.gitignore`). En usage normal, la clé saisie dans le popup est stockée localement dans `chrome.storage.local`.

## 🕹️ Utilisation

1. Ouvrir le popup et **coller son texte** (coordonnées, expérience, formations…) dans la zone *Contenu du profil*.
2. Cliquer sur **💾 Sauvegarder** pour réutiliser ce profil plus tard.
3. Se rendre sur un formulaire, rouvrir le popup et cliquer sur **✨ Remplir le formulaire**.
4. **Vérifier** les champs remplis via le rapport, puis soumettre soi-même le formulaire.

### Raccourcis et raccourci contextuel

| Action | Raccourci |
| --- | --- |
| Ouvrir le popup Hautomatique | `Ctrl+Shift+H` (macOS : `⌘+Shift+H`) |
| Remplir avec le profil actif (sans popup) | `Ctrl+Shift+K` (macOS : `⌘+Shift+K`) |
| Menu contextuel | Clic droit → *Hautomatique → Remplir avec le profil actif* |

> Les raccourcis sont modifiables dans `chrome://extensions/shortcuts`.

## 🧪 Sandbox QA

Le fichier `index.html` est une **page de test locale** (formulaire synthétique varié) permettant de valider le remplissage sans aller sur un vrai site :

```bash
# Depuis le dossier du projet, servez-la simplement :
npx serve .
# puis ouvrir http://localhost:3000/index.html
```

## 📁 Structure du projet

```
Hautomatique/
├── manifest.json        # Déclaration Manifest V3 (permissions, raccourcis…)
├── background.js        # Service worker : appels IA (Gemini/OpenAI), menu contextuel, badge
├── content.js           # Scan des champs, correspondance IA, remplissage « humain »
├── popup.html / popup.js# Interface du popup (profils, réglages, rapports)
├── storage.js           # Couche de stockage (chrome.storage.local)
├── config.example.js    # Modèle de configuration des clés API
├── index.html           # Sandbox QA (formulaire de test)
├── icons/               # Icônes de l'extension
└── documents/           # Ressources du projet
```

## 🔒 Vie privée et sécurité

- Toutes les données (profils, clés) restent **locales** : `chrome.storage.local`, rien n'est stocké sur un serveur.
- Seul le **texte du profil actif et les champs de la page** sont envoyés au provider IA choisi lors d'un remplissage.
- Permissions minimales : `activeTab`, `scripting`, `storage`, `contextMenus`.
- Les mots de passe et données bancaires sont **exclus** du remplissage automatique.
- Aucun formulaire n'est soumis automatiquement : la validation reste entre vos mains.

## 🤝 Contribuer

1. Fourcher le dépôt (`fork`)
2. Créer une branche : `git checkout -b feature/ma-fonctionnalite`
3. Committer : `git commit -m "Ajout de …"`
4. Pousser : `git push origin feature/ma-fonctionnalite`
5. Ouvrir une *Pull Request*

## 📄 Licence

Aucune licence formelle n'est encore spécifiée pour ce projet. N'hésitez pas à contacter le propriétaire avant toute réutilisation.
