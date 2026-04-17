# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Lenguaje claro** is a Chrome extension for Google Docs that detects and suggests improvements for writing issues in Spanish. It analyzes documents for archaisms, passive voice, and consecutive "que" patterns (queísmo), highlighting issues with color-coded underlines and providing suggestions in a floating panel.

## Development Setup

- **Node.js version**: 22 (specified in `.nvmrc`)
- **Build step**: `npm run build` genera `dist/` con bundles + assets para cargar la extensión
- **Manifest Version**: 3 (Chrome's current standard)

To load the extension for development:
1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode"
3. Run `npm run build` or keep `npm run watch` running
4. Click "Load unpacked" and select the `dist/` directory
4. The extension auto-initializes when you open a Google Docs document

### OAuth Configuration

The extension uses Google OAuth to access the Google Docs API. The OAuth client ID should be managed via `.env`, and the generated manifest is built from `manifest.template.json`:

1. Copy `.env.example` to `.env` (if not already done)
2. Update the `CHROME_OAUTH_CLIENT_ID` value in `.env` with your OAuth client ID from [Google Cloud Console](https://console.cloud.google.com)
3. Run `npm run build` to generate `dist/manifest.json`
4. The `.env` file and generated `dist/` directory are git-ignored (see `.gitignore`)

## Architecture

The extension follows a modular design with four main layers:

### 1. **Core Orchestration** (`content/content.js`)
- `DocsReviewer` object: Main entry point that initializes the extension
- Runs all rules against document text and aggregates matches
- Enriches matches with UI metadata (`color`, `reglaNombre`, `rects`, active state)
- Coordinates synchronization between the reader, highlighter, and panel

### 2. **Text Extraction** (`content/reader.js`)
- `DocsReader` object: Reads full text from Google Docs through the background service worker and OAuth
- `leerTextoCompleto()` is the source of truth for rule offsets
- `esperarDocumentoListo()` only verifies that the URL belongs to a Google Doc

### 3. **Visual Highlighting** (`content/highlighter.js`)
- `DocsHighlighter` object: Creates fixed-position overlay markers over the visible Google Docs text layer
- Builds a normalized visible-text model from the accessibility layer (`docos-stream-view` / related roles)
- Reconciles issue text against the visible layer in reading order and converts matches into `Range#getClientRects()`
- Renders inline markers plus a contextual popup with hover/click interactions

### 4. **Rule System** (`rules/`)
Each rule file exports a rule object, and `rules/index.js` aggregates the exported rules:
```javascript
export const ruleObject = {
  id: 'unique-id',           // Used in logs and element attributes
  nombre: 'Display Name',     // Shown to users
  descripcion: 'What it does',
  color: '#hexcolor',         // For highlighting

  detectar(texto) {           // Analyzes full document text
    return [{
      id: 'unique-match-id',
      inicio: charPosition,   // 0-indexed start in full text
      fin: charPosition,      // 0-indexed end (exclusive)
      textoOriginal: 'matched text',
      sugerencia: 'suggested replacement',
      regla: 'rule-id',
      descripcion: 'what to fix'
    }];
  }
};

export default ruleObject;
```

`rules/index.js` is the source of truth for registration order. Both regex patterns use case-insensitive matching with word boundaries (`\b`) by default.

### 5. **UI Panel** (`content/panel.js`, `panel/`)
- `DocsPanel` object: Manages the floating sidebar
- Injects HTML from `panel/panel.html` and CSS from `panel/panel.css`
- Displays issue list, counts by rule, and shares active-state sync with the inline overlay
- Clicking panel items attempts to focus the corresponding inline marker and popup

## Data Flow

1. **Initialization**: `content.js` verifies the page is a Google Doc, injects panel, initializes highlighter, and starts analysis
2. **Analysis**: Reads full text → runs each rule's `detectar()` method → enriches matches with UI metadata → sorts by position
3. **Visualization**: Highlighter builds a normalized text model from the visible accessibility layer and maps issues to viewport rects
4. **Interaction**: Panel hover/click and inline hover/click keep a shared active issue state
5. **Updates**: Overlay positions are recalculated on scroll, resize, and DOM mutations in the visible text layer

## Adding New Rules

1. Create `rules/new-rule.js` in the rules directory
2. Define the rule object (see Rule System section above)
3. Export it from the file
4. Import it in `rules/index.js` and append it to the exported `rules` array

**Example**: To detect repeated words:
- Use `regex.exec()` in a loop to find all matches with their positions
- Return array of match objects with correct `inicio`/`fin` relative to full document text
- Test by adding text to a Google Doc and checking the console for logs

## Key Implementation Details

### Text Position Tracking
- `leerTextoCompleto()` from the Docs API remains the source of truth for issue offsets
- The overlay does not trust raw DOM positions directly; it normalizes visible text and maps issue text back into `Range` rects
- **Bug zone**: If the accessibility layer diverges from the API text, some issues may stay panel-only until the mapper is adjusted

### MutationObserver Strategy
- The highlighter observes the visible text root to recalculate inline rects
- Analysis is still triggered explicitly; the observer is for overlay repositioning, not rule execution
- Scroll and resize also trigger rect recalculation because the overlay is viewport-relative

### Current Limitations
- Manual match application (copy/paste, no auto-replace)
- Passive voice suggestions are generic
- Regex-based detection (no NLP)

## Debugging

- Console logs are prefixed with `[Docs Reviewer]`
- Browser DevTools (F12) shows script errors and rule execution logs
- If extension doesn't load: check that you're on `docs.google.com` and reload the page
- If highlights don't appear: verify the rule is exported in `rules/index.js` and positions are correct

## Manifest Structure

- **Manifest Version**: 3
- **Content Scripts**: Injected into `https://docs.google.com/*`
- **Run At**: `document_idle`
- **Build Output**: Chrome loads the generated files from `dist/`
- **Permissions**: `storage`, `identity`
