import type { NlpEngine } from "./types.js";

declare global {
  interface Window {
    esCompromise?: NlpEngine;
    nlp?: NlpEngine;
  }

  const chrome: {
    runtime: {
      getURL(resourcePath: string): string;
    };
  };
}

export {};
