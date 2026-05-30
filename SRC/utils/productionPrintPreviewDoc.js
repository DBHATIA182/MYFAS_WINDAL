import { buildProductionPrintDocumentHtml } from './pdfgenerator';

/** Full HTML document for production print preview (iframe / print window). */
export function buildProductionPrintPreviewDocument(data, metadata) {
  return buildProductionPrintDocumentHtml(data, metadata);
}
