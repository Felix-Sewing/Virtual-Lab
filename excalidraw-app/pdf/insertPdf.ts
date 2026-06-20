// excalidraw-app/pdf/insertPdf.ts
//
// Turns a dropped PDF file into a single embeddable element backed by one
// rasterized image file per page plus the original PDF bytes. The card UI is
// rendered separately via the host's `renderEmbeddable` prop (see PdfCard).
//
// A placeholder element is inserted immediately (status "loading") so the user
// gets instant feedback; it is then filled in once rasterization completes.

import { randomId, MIME_TYPES } from "@excalidraw/common";
import { newEmbeddableElement, newElementWith } from "@excalidraw/element";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type { FileId } from "@excalidraw/element/types";
import type {
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { rasterizePdf } from "./pdfToImages";
import { PDF_CUSTOM_DATA_KEY, PDF_LINK_PREFIX } from "./pdfData";

import type { PdfCustomData } from "./pdfData";

// On-canvas width of the inserted PDF, in scene units. Height follows the
// first page's aspect ratio (defaults to A4 portrait until it's known).
const DEFAULT_PDF_WIDTH = 420;
const A4_PORTRAIT_ASPECT_RATIO = 1 / Math.SQRT2; // ~0.707 (width / height)

const heightForAspect = (aspectRatio: number) =>
  Math.round(DEFAULT_PDF_WIDTH / (aspectRatio > 0 ? aspectRatio : 1));

const bytesToPdfDataURL = (bytes: Uint8Array): DataURL => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:application/pdf;base64,${btoa(binary)}` as DataURL;
};

/** Replace the customData (and optionally size) of one PDF element by id. */
const patchPdfElement = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  elementId: string,
  pdfData: PdfCustomData,
  size?: { width: number; height: number },
) => {
  excalidrawAPI.updateScene({
    elements: excalidrawAPI.getSceneElementsIncludingDeleted().map((el) =>
      el.id === elementId
        ? newElementWith(el, {
            customData: { ...el.customData, [PDF_CUSTOM_DATA_KEY]: pdfData },
            ...(size ?? {}),
          })
        : el,
    ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

export const insertPdfFromFile = async (
  file: File,
  {
    excalidrawAPI,
    sceneX,
    sceneY,
  }: {
    excalidrawAPI: ExcalidrawImperativeAPI;
    sceneX: number;
    sceneY: number;
  },
): Promise<void> => {
  // 1. Insert a loading placeholder right away for instant feedback.
  const loadingData: PdfCustomData = {
    status: "loading",
    originalPdfFileId: null,
    pageFileIds: [],
    numPages: 0,
    currentPage: 0,
    fileName: file.name,
  };

  const element = newEmbeddableElement({
    type: "embeddable",
    x: sceneX,
    y: sceneY,
    width: DEFAULT_PDF_WIDTH,
    height: heightForAspect(A4_PORTRAIT_ASPECT_RATIO),
    strokeColor: "transparent",
    backgroundColor: "transparent",
    // sentinel link so the embeddable passes validateEmbeddable and renders
    // its overlay; never navigated to.
    link: `${PDF_LINK_PREFIX}${encodeURIComponent(file.name)}`,
    customData: { [PDF_CUSTOM_DATA_KEY]: loadingData },
    locked: false,
  });

  excalidrawAPI.updateScene({
    elements: [...excalidrawAPI.getSceneElementsIncludingDeleted(), element],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  excalidrawAPI.setActiveTool({ type: "selection" });

  // 2. Rasterize (the slow part) while the placeholder spins.
  try {
    const { originalBytes, pageDataURLs, firstPageAspectRatio, numPages } =
      await rasterizePdf(file);

    const now = Date.now();
    const originalPdfFileId = randomId() as FileId;
    const pageFileIds = pageDataURLs.map(() => randomId() as FileId);

    const binaryFiles: BinaryFileData[] = [
      {
        id: originalPdfFileId,
        // BinaryFileData only types image mimes + binary; the dataURL itself
        // carries the real application/pdf type for download.
        mimeType: MIME_TYPES.binary,
        dataURL: bytesToPdfDataURL(originalBytes),
        created: now,
        lastRetrieved: now,
      },
      ...pageDataURLs.map(
        (dataURL, index): BinaryFileData => ({
          id: pageFileIds[index],
          mimeType: MIME_TYPES.png,
          dataURL: dataURL as DataURL,
          created: now,
          lastRetrieved: now,
        }),
      ),
    ];

    excalidrawAPI.addFiles(binaryFiles);

    // 3. Fill in the placeholder and resize it to the real aspect ratio.
    patchPdfElement(
      excalidrawAPI,
      element.id,
      {
        status: "ready",
        originalPdfFileId,
        pageFileIds,
        numPages,
        currentPage: 0,
        fileName: file.name,
      },
      { width: DEFAULT_PDF_WIDTH, height: heightForAspect(firstPageAspectRatio) },
    );
  } catch (error) {
    // mark the placeholder as errored so the card can show a message
    patchPdfElement(excalidrawAPI, element.id, {
      ...loadingData,
      status: "error",
    });
    throw error;
  }
};
