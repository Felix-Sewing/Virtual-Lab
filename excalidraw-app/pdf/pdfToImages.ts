// excalidraw-app/pdf/pdfToImages.ts
//
// Rasterizes a PDF file into one PNG data URL per page using pdf.js. The result
// feeds the image pipeline (pages become regular files referenced by the PDF
// embeddable element). Export of the PDF itself is intentionally not supported.

import * as pdfjs from "pdfjs-dist";
// Vite resolves this to a bundled URL for the web worker.
import PdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;

// Render scale relative to the PDF's intrinsic (72 DPI) size, i.e. the
// effective DPI is RENDER_SCALE * 72. Higher = crisper when zoomed in, but
// file size grows ~quadratically (more storage + slower load from the server).
//   2   -> 144 DPI (smaller, faster)
//   2.5 -> 180 DPI (current — light quality bump)
//   3   -> 216 DPI (sharp, noticeably larger)
const RENDER_SCALE = 3

export type RasterizedPdf = {
  /** original PDF bytes, stored so the original can be downloaded later */
  originalBytes: Uint8Array;
  /** one PNG data URL per page, in page order */
  pageDataURLs: string[];
  /** intrinsic aspect ratio (width / height) of the first page */
  firstPageAspectRatio: number;
  numPages: number;
};

const renderPageToDataURL = async (
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ dataURL: string; width: number; height: number }> => {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get 2D canvas context for PDF rendering");
  }

  await page.render({ canvasContext: context, viewport }).promise;

  const dataURL = canvas.toDataURL("image/png");

  // free GPU/CPU memory eagerly — multi-page PDFs can be large
  page.cleanup();
  canvas.width = 0;
  canvas.height = 0;

  return { dataURL, width: viewport.width, height: viewport.height };
};

export const rasterizePdf = async (file: File): Promise<RasterizedPdf> => {
  const originalBytes = new Uint8Array(await file.arrayBuffer());

  // pdf.js transfers/consumes the buffer, so hand it a copy and keep our own.
  const pdf = await pdfjs.getDocument({ data: originalBytes.slice() }).promise;

  try {
    const pageDataURLs: string[] = [];
    let firstPageAspectRatio = 1;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const { dataURL, width, height } = await renderPageToDataURL(
        pdf,
        pageNumber,
      );
      pageDataURLs.push(dataURL);
      if (pageNumber === 1 && height > 0) {
        firstPageAspectRatio = width / height;
      }
    }

    return {
      originalBytes,
      pageDataURLs,
      firstPageAspectRatio,
      numPages: pdf.numPages,
    };
  } finally {
    pdf.destroy();
  }
};
