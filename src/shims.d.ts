// The pre-bundled browser build of mammoth ships without typings; its API matches the main package.
declare module 'mammoth/mammoth.browser.min.js' {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
  const mammoth: { extractRawText: typeof extractRawText };
  export default mammoth;
}

// Vite "?url" asset imports (the pdf.js worker file).
declare module '*?url' {
  const url: string;
  export default url;
}
