export type Confidence = "alta" | "media" | "baja";
export type HallazgoTipo = "queismo" | "dequeismo";

export interface Match {
  id: string;
  inicio: number;
  fin: number;
  textoOriginal: string;
  sugerencias: string[];
  aplicable?: boolean;
  regla: string;
  descripcion: string;
}

export interface Rule {
  id: string;
  nombre: string;
  descripcion: string;
  color: string;
  detectar(texto: string): Match[];
}

export interface Pattern {
  original: string;
  sugerencias: string[];
  dropDeterminer?: boolean;
}

export interface VaguedadPattern {
  original: string;
  precision: string;
}

export interface TituloHonorificoPattern {
  original: string;
  sugerencias?: string[];
  advertencia?: string;
  regex?: string;
  aplicable?: boolean;
}

export interface NlpTermJson {
  text?: string;
  terms?: Array<{
    text?: string;
    tags?: string[];
  }>;
}

export interface NlpTermsResult {
  json(): NlpTermJson[];
  out(format: "array"): string[];
}

export interface NlpSentenceResult {
  out(format: "array"): string[];
}

export interface NlpDocument {
  terms(): NlpTermsResult;
  sentences?: () => NlpSentenceResult;
  fullSentences(): NlpSentenceResult;
}

export type NlpEngine = (text: string) => NlpDocument;

export interface QueismoPattern {
  id?: string;
  type?: string;
  label?: string;
  triggerPattern?: string;
  suggestedPattern?: string;
  exclusions?: string[];
  confidence?: string;
}

export interface QueismoPatterns {
  globalExclusions: string[];
  requiere_de_que: QueismoPattern[];
  nunca_de_que: QueismoPattern[];
}
