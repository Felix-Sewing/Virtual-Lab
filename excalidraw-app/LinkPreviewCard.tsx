// excalidraw-app/LinkPreviewCard.tsx
//
// Diese Datei enthält die Vorschau-Karte, die auf dem Canvas erscheint.
// Sie bekommt das Element (mit der URL drin) und holt sich die Metadaten
// der Website über die kostenlose API von microlink.io.

import { useEffect, useState } from "react";

import type {
  NonDeleted,
  ExcalidrawEmbeddableElement,
} from "@excalidraw/element/types";

// --- Hilfsfunktionen ---

// Extrahiert den Domainnamen aus einer URL, z.B. "https://github.com/..." → "github.com"
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// --- Typen für die API-Antwort ---

interface LinkMeta {
  title?: string;
  description?: string;
  image?: { url: string };
}

// --- Die eigentliche Karten-Komponente ---
//
// "Props" sind die Eingaben, die eine React-Komponente bekommt.
// Hier bekommt sie das Excalidraw-Element, das die URL enthält.

interface Props {
  element: NonDeleted<ExcalidrawEmbeddableElement>;
}

export function LinkPreviewCard({ element }: Props) {
  const url = element.link ?? "";

  // useState: speichert Werte, die sich ändern können (Metadaten, Ladestatus)
  const [meta, setMeta] = useState<LinkMeta | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  // useEffect: wird ausgeführt, wenn sich `url` ändert (also wenn eine neue Karte geladen wird)
  useEffect(() => {
    if (!url) {
      return;
    }
    let cancelled = false; // verhindert State-Updates nach dem Unmount

    fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) {
          return;
        }
        if (data.status === "success") {
          setMeta(data.data);
          setStatus("ok");
        } else {
          setStatus("error");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });

    // Cleanup-Funktion: wird aufgerufen, wenn die Komponente verschwindet
    return () => {
      cancelled = true;
    };
  }, [url]);

  const domain = getDomain(url);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#fff",
        borderRadius: 10,
        border: "5px solid #000",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
        // boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
        boxSizing: "border-box",
      }}
    >
      {/* Vorschau-Bild (nur anzeigen, wenn vorhanden) */}
      {meta?.image?.url && (
        <img
          src={meta.image.url}
          alt=""
          style={{
            width: "100%",
            height: 210,
            objectFit: "cover",
            flexShrink: 0,
            borderBottom: "2px solid #f1f5f9",
          }}
        />
      )}

      {/* Textbereich */}
      <div
        style={{
          padding: "10px 12px",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflow: "hidden",
        }}
      >
        {status === "loading" && (
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Lade Vorschau …
          </span>
        )}

        {status === "ok" && (
          <>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#0f172a",
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                lineHeight: 1.4,
              }}
            >
              {meta?.title ?? domain}
            </div>

            {meta?.description && (
              <div
                style={{
                  fontSize: 11.5,
                  color: "#64748b",
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  lineHeight: 1.5,
                }}
              >
                {meta.description}
              </div>
            )}
          </>
        )}

        {status === "error" && (
          <div
            style={{ fontSize: 12, color: "#64748b", wordBreak: "break-all" }}
          >
            {url}
          </div>
        )}

        {/* Footer: Domain + Favicon */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 6,
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: "#94a3b8",
            borderTop: "1px solid #f1f5f9",
          }}
        >
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
            width={13}
            height={13}
            alt=""
            style={{ borderRadius: 2 }}
          />
          {domain}
        </div>
      </div>
    </div>
  );
}
