# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Lenguaje claro** is a Chrome extension for Google Docs that detects and suggests improvements for writing issues in Spanish. It analyzes documents for archaisms, passive voice, and consecutive "que" patterns (queísmo), highlighting issues with color-coded underlines and providing suggestions in a floating panel.

## Development Setup

- **Node.js version**: 22 (specified in `.nvmrc`)
- **No build process**: The extension runs directly from source files without bundling or compilation
- **Manifest Version**: 3 (Chrome's current standard)

To load the extension for development:
1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select the project directory
4. The extension auto-initializes when you open a Google Docs document

## Architecture

The extension follows a modular design with four main layers:

### 1. **Core Orchestration** (`content/content.js`)
- `DocsReviewer` object: Main entry point that initializes the extension
- Runs all rules against document text and aggregates matches
- Sets up a `MutationObserver` to re-analyze when the document changes (with 500ms debounce)
- Coordinates between the reader, highlighter, and panel

### 2. **Text Extraction** (`content/reader.js`)
- `DocsReader` object: Provides methods to read text from Google Docs
- Selects paragraphs using `.kix-paragraphrenderer` (Google Docs' internal class)
- Key methods:
  - `leerTextoCompleto()`: Returns entire document as concatenated text with `\n` separators
  - `leerParagrafos()`: Returns array of paragraph objects with position data
  - `esperarDocumentoListo()`: Waits up to 5 seconds for Google Docs DOM to be ready
  - `buscarParrafo(textoPartial)`: Finds a specific paragraph by partial text match

**Important**: Position calculations depend on consistent `\n` joining. The highlighter tracks cumulative character positions across paragraphs.

### 3. **Visual Highlighting** (`content/highlighter.js`)
- `DocsHighlighter` object: Creates visual underlines over detected issues
- Uses a `NodeIterator` to traverse text nodes and wrap matches in `<span>` elements
- Color-coded by rule (red for archaisms, orange for passive voice, yellow for queísmo)
- Applies `border-bottom: 3px wavy [color]` for the visual effect
- Updates whenever `DocsReviewer.analizarDocumento()` is called

### 4. **Rule System** (`rules/`)
Each rule file exports an object to `window.docsReviewerRules[]` with this structure:
```javascript
const ruleObject = {
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
```

**Order matters**: Rules load in `manifest.json`'s script order. Both regex patterns use case-insensitive matching with word boundaries (`\b`) by default.

### 5. **UI Panel** (`content/panel.js`, `panel/`)
- `DocsPanel` object: Manages the floating sidebar
- Injects HTML from `panel/panel.html` and CSS from `panel/panel.css`
- Displays issue list, counts by rule, and handles panel interactions

## Data Flow

1. **Initialization**: `content.js` waits for `.kix-appview` and at least one `.kix-paragraphrenderer`
2. **Analysis**: Reads full text → runs each rule's `detectar()` method → collects all matches → sorts by position
3. **Visualization**: For each match, finds the containing paragraph, wraps the matched text in a styled `<span>`
4. **Updates**: `MutationObserver` watches `.kix-appview` (debounced 500ms) and re-runs the full analysis

Position tracking is critical: `leerTextoCompleto()` joins paragraphs with `\n`, so rules' `inicio`/`fin` values must align with this format.

## Adding New Rules

1. Create `rules/new-rule.js` in the rules directory
2. Define the rule object (see Rule System section above)
3. Register it to `window.docsReviewerRules` (the template handles this automatically)
4. Add the script to `manifest.json` in `content_scripts[0].js` (order: before `content.js`)

**Example**: To detect repeated words:
- Use `regex.exec()` in a loop to find all matches with their positions
- Return array of match objects with correct `inicio`/`fin` relative to full document text
- Test by adding text to a Google Doc and checking the console for logs

## Key Implementation Details

### Text Position Tracking
- `leerTextoCompleto()` joins paragraphs with literal `\n` characters
- Highlighter tracks cumulative position: `textoAcumulado += textoParrafo.length + 1` (the `+1` is the newline)
- **Bug zone**: If paragraph extraction or joining logic changes, position tracking breaks silently

### MutationObserver Strategy
- Observes `.kix-appview` for `childList`, `subtree`, and `characterData` changes
- Debounced to 500ms to avoid re-analyzing on every keystroke
- Called on every change (no filtering), so document size can impact responsiveness

### Current Limitations
- Manual match application (copy/paste, no auto-replace)
- Passive voice suggestions are generic
- Regex-based detection (no NLP)

## Debugging

- Console logs are prefixed with `[Docs Reviewer]`
- Browser DevTools (F12) shows script errors and rule execution logs
- If extension doesn't load: check that you're on `docs.google.com` and reload the page
- If highlights don't appear: verify rule is in `window.docsReviewerRules` and positions are correct

## Manifest Structure

- **Manifest Version**: 3
- **Content Scripts**: Injected into `https://docs.google.com/*`
- **Run At**: `document_start` (earliest possible)
- **Script Load Order**: Rules first, then readers/highlighters/panel, then orchestration (`content.js`)
- **Permissions**: Only `storage` (not actively used yet)
