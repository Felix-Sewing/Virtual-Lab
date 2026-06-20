// excalidraw-app/pdf/PdfCard.tsx
//
// On-canvas card for a PDF embeddable. Shows the current page, lets the user
// flip pages and download the original PDF. The page index lives in the
// element's customData, so flipping a page updates the scene — which broadcasts
// to every collaborator and keeps everyone on the same page.

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith } from "@excalidraw/element";
import { useCallback, useEffect, useState } from "react";

import type {
  ExcalidrawEmbeddableElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { PDF_CUSTOM_DATA_KEY, getPdfData } from "./pdfData";

// inject the spinner keyframes once
const SPINNER_STYLE_ID = "pdf-card-spinner-style";
if (
  typeof document !== "undefined" &&
  !document.getElementById(SPINNER_STYLE_ID)
) {
  const style = document.createElement("style");
  style.id = SPINNER_STYLE_ID;
  style.textContent = "@keyframes pdfCardSpin { to { transform: rotate(360deg); } }";
  document.head.appendChild(style);
}

const Spinner = () => (
  <div
    style={{
      width: 28,
      height: 28,
      border: "3px solid #e2e8f0",
      borderTopColor: "#0f172a",
      borderRadius: "50%",
      animation: "pdfCardSpin 0.8s linear infinite",
    }}
  />
);

/** Outer card frame shared by the loading / error / ready states. */
const CardShell = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "#fff",
      border: "3px solid #000",
      borderRadius: 8,
      overflow: "hidden",
      boxSizing: "border-box",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}
  >
    {children}
  </div>
);

interface Props {
  element: NonDeleted<ExcalidrawEmbeddableElement>;
  excalidrawAPI: ExcalidrawImperativeAPI;
}

export function PdfCard({ element, excalidrawAPI }: Props) {
  const pdf = getPdfData(element);

  // page index is read straight from the (synced) element; component re-renders
  // when collab updates customData.
  const currentPage = pdf?.currentPage ?? 0;
  const pageFileId = pdf?.pageFileIds[currentPage];

  const [pageSrc, setPageSrc] = useState<string | null>(null);

  // Resolve the current page's image from the file store. On remote clients the
  // file may still be downloading, so retry until it lands.
  useEffect(() => {
    if (!pageFileId) {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;

    const resolve = () => {
      const file = excalidrawAPI.getFiles()[pageFileId];
      if (file?.dataURL) {
        if (!cancelled) {
          setPageSrc(file.dataURL);
        }
        return;
      }
      timer = window.setTimeout(resolve, 500);
    };
    resolve();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [pageFileId, excalidrawAPI]);

  const goToPage = useCallback(
    (next: number) => {
      if (!pdf) {
        return;
      }
      const clamped = Math.max(0, Math.min(pdf.numPages - 1, next));
      if (clamped === pdf.currentPage) {
        return;
      }

      // Mutating the element creates a new object reference. Excalidraw tracks
      // the "interactive" embeddable by reference (activeEmbeddable.element ===
      // el), so we must re-point it at the updated element — otherwise the card
      // drops out of interactive mode and the user has to click "interact"
      // again before every page flip.
      let updatedElement: NonDeleted<ExcalidrawEmbeddableElement> | undefined;
      const elements = excalidrawAPI
        .getSceneElementsIncludingDeleted()
        .map((el) => {
          if (el.id !== element.id) {
            return el;
          }
          updatedElement = newElementWith(el, {
            customData: {
              ...el.customData,
              [PDF_CUSTOM_DATA_KEY]: { ...pdf, currentPage: clamped },
            },
          }) as NonDeleted<ExcalidrawEmbeddableElement>;
          return updatedElement;
        });

      excalidrawAPI.updateScene({
        elements,
        appState: updatedElement
          ? { activeEmbeddable: { element: updatedElement, state: "active" } }
          : undefined,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [pdf, element.id, excalidrawAPI],
  );

  const downloadOriginal = useCallback(() => {
    if (!pdf) {
      return;
    }
    if (!pdf.originalPdfFileId) {
      return;
    }
    const file = excalidrawAPI.getFiles()[pdf.originalPdfFileId];
    if (!file?.dataURL) {
      return;
    }
    const link = document.createElement("a");
    link.href = file.dataURL;
    link.download = pdf.fileName || "document.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [pdf, excalidrawAPI]);

  if (!pdf) {
    return null;
  }

  // still rasterizing — show a spinner so the user knows work is happening
  if (pdf.status === "loading") {
    return (
      <CardShell>
        <div style={centeredFill}>
          <Spinner />
          <span style={{ color: "#475569", fontSize: 13 }}>
            Konvertiere PDF …
          </span>
          <span
            title={pdf.fileName}
            style={{
              maxWidth: "85%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "#94a3b8",
              fontSize: 11,
            }}
          >
            {pdf.fileName}
          </span>
        </div>
      </CardShell>
    );
  }

  if (pdf.status === "error") {
    return (
      <CardShell>
        <div style={centeredFill}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <span style={{ color: "#475569", fontSize: 13 }}>
            PDF konnte nicht geladen werden.
          </span>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      {/* page image */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          overflow: "hidden",
        }}
      >
        {pageSrc ? (
          <img
            src={pageSrc}
            alt={`${pdf.fileName} — Seite ${currentPage + 1}`}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            draggable={false}
          />
        ) : (
          <span style={{ color: "#94a3b8", fontSize: 13 }}>Lade Seite …</span>
        )}
      </div>

      {/* controls */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderTop: "1px solid #e2e8f0",
          fontSize: 12,
          color: "#0f172a",
        }}
      >
        <button
          type="button"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 0}
          style={btnStyle(currentPage <= 0)}
        >
          ‹
        </button>
        <span style={{ minWidth: 64, textAlign: "center" }}>
          {currentPage + 1} / {pdf.numPages}
        </span>
        <button
          type="button"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= pdf.numPages - 1}
          style={btnStyle(currentPage >= pdf.numPages - 1)}
        >
          ›
        </button>

        <span
          title={pdf.fileName}
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "#64748b",
          }}
        >
          {pdf.fileName}
        </span>

        <button
          type="button"
          onClick={downloadOriginal}
          style={{ ...btnStyle(false), width: "auto", padding: "2px 10px" }}
        >
          PDF ↓
        </button>
      </div>
    </CardShell>
  );
}

const centeredFill: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: 12,
  textAlign: "center",
};

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  width: 26,
  height: 24,
  border: "1px solid #cbd5e1",
  borderRadius: 5,
  background: disabled ? "#f1f5f9" : "#fff",
  color: disabled ? "#cbd5e1" : "#0f172a",
  cursor: disabled ? "default" : "pointer",
  fontSize: 14,
  lineHeight: 1,
});
