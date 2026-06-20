// excalidraw-app/pdf/pdfData.ts
//
// Shared shape + helpers for the "PDF embeddable" element.
//
// A dropped PDF becomes a single embeddable element. Its rendered content
// (the current page) is drawn by `PdfCard` via the host's `renderEmbeddable`
// prop. All PDF state lives in `element.customData.pdf` so that it is
// serialized and broadcast to collaborators like any other element field —
// which is what makes the "synced page" feature work for free.

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

export const PDF_CUSTOM_DATA_KEY = "pdf";

// Marker stored in `element.link`. Embeddables only render their overlay when
// the link passes `validateEmbeddable` (we pass `validateEmbeddable={true}` in
// the app, so any non-empty link validates). We never navigate to it.
export const PDF_LINK_PREFIX = "pdf://";

export type PdfCustomData = {
  /**
   * "loading" while the PDF is still being rasterized (card shows a spinner),
   * "ready" once pages are available, "error" if conversion failed.
   */
  status: "loading" | "ready" | "error";
  /** file id of the original, unmodified PDF (for "download original") */
  originalPdfFileId: FileId | null;
  /** one rasterized PNG file id per page, in page order */
  pageFileIds: FileId[];
  /** total number of pages (== pageFileIds.length, kept for clarity) */
  numPages: number;
  /** currently displayed page (0-based) — the field synced across clients */
  currentPage: number;
  /** original file name, shown in the card and used for the download */
  fileName: string;
};

/** A PDF embeddable is an embeddable element carrying our customData payload. */
export const isPdfEmbeddableElement = (
  element: ExcalidrawElement,
): element is ExcalidrawElement & {
  customData: { [PDF_CUSTOM_DATA_KEY]: PdfCustomData };
} =>
  element.type === "embeddable" &&
  !!element.customData?.[PDF_CUSTOM_DATA_KEY]?.status;

export const getPdfData = (
  element: ExcalidrawElement,
): PdfCustomData | null =>
  isPdfEmbeddableElement(element)
    ? element.customData[PDF_CUSTOM_DATA_KEY]
    : null;

/**
 * Collect every file id referenced by PDF embeddables in the scene. Excalidraw
 * core only persists/loads files referenced by image elements' `fileId`, so the
 * app- and collab-level file sync must be widened with these ids to actually
 * upload and re-fetch PDF pages (and the original) across clients/reloads.
 */
export const collectPdfFileIds = (
  elements: readonly ExcalidrawElement[],
): FileId[] => {
  const ids: FileId[] = [];
  for (const element of elements) {
    const pdf = getPdfData(element);
    if (pdf) {
      if (pdf.originalPdfFileId) {
        ids.push(pdf.originalPdfFileId);
      }
      ids.push(...pdf.pageFileIds);
    }
  }
  return ids;
};
