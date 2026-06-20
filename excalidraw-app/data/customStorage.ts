import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES, toBrandedType } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { hashElementsVersion } from "@excalidraw/element";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";

const STORAGE_SERVER_URL = (
  import.meta.env.VITE_APP_STORAGE_SERVER_URL || "http://localhost:3003"
).replace(/\/$/, "");

// Stored scene format — binary fields transmitted as base64 strings
type StoredScene = {
  sceneVersion: number;
  iv: string;
  ciphertext: string;
};

// -----------------------------------------------------------------------------
// Binary ↔ base64 helpers

const uint8ToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToUint8 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

// -----------------------------------------------------------------------------
// Encryption helpers (same logic as firebase.ts)

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);
  return { ciphertext: encryptedBuffer, iv };
};

const decryptElements = async (
  data: StoredScene,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  const ciphertext = base64ToUint8(data.ciphertext) as Uint8Array<ArrayBuffer>;
  const iv = base64ToUint8(data.iv) as Uint8Array<ArrayBuffer>;
  const decrypted = await decryptData(iv, ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

// -----------------------------------------------------------------------------
// Scene version cache — tracks the last-saved version per socket so we can
// skip redundant saves (identical to the cache in firebase.ts)

class StorageSceneVersionCache {
  private static cache = new WeakMap<Socket, number>();

  static get = (socket: Socket) => StorageSceneVersionCache.cache.get(socket);

  static set = (
    socket: Socket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    StorageSceneVersionCache.cache.set(socket, hashElementsVersion(elements));
  };
}

export const isSavedToFirebase = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    return (
      StorageSceneVersionCache.get(portal.socket) === hashElementsVersion(elements)
    );
  }
  return true;
};

// -----------------------------------------------------------------------------

export const saveToFirebase = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (!roomId || !roomKey || !socket || isSavedToFirebase(portal, elements)) {
    return null;
  }

  // Read existing scene, reconcile, then write back
  const existingRes = await fetch(`${STORAGE_SERVER_URL}/scenes/${roomId}`);

  let reconciledElements: readonly SyncableExcalidrawElement[];

  if (existingRes.ok) {
    const stored: StoredScene = await existingRes.json();
    const prevElements = getSyncableElements(
      restoreElements(await decryptElements(stored, roomKey), null),
    );
    reconciledElements = getSyncableElements(
      reconcileElements(
        elements,
        prevElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
        appState,
      ),
    );
  } else {
    reconciledElements = elements;
  }

  const sceneVersion = hashElementsVersion(reconciledElements);
  const { ciphertext, iv } = await encryptElements(roomKey, reconciledElements);

  const body: StoredScene = {
    sceneVersion,
    iv: uint8ToBase64(iv),
    ciphertext: uint8ToBase64(new Uint8Array(ciphertext)),
  };

  await fetch(`${STORAGE_SERVER_URL}/scenes/${roomId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const storedElements = getSyncableElements(
    restoreElements(await decryptElements(body, roomKey), null),
  );

  StorageSceneVersionCache.set(socket, storedElements);

  return toBrandedType<RemoteExcalidrawElement[]>(storedElements);
};

export const loadFromFirebase = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  const res = await fetch(`${STORAGE_SERVER_URL}/scenes/${roomId}`);
  if (!res.ok) {
    return null;
  }

  const stored: StoredScene = await res.json();
  const elements = getSyncableElements(
    restoreElements(await decryptElements(stored, roomKey), null, {
      deleteInvisibleElements: true,
    }),
  );

  if (socket) {
    StorageSceneVersionCache.set(socket, elements);
  }

  return elements;
};

export const saveFilesToFirebase = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const savedFiles: FileId[] = [];
  const erroredFiles: FileId[] = [];

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const cleanPrefix = prefix.replace(/^\//, "");
        await fetch(`${STORAGE_SERVER_URL}/files/${cleanPrefix}/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: buffer.buffer as ArrayBuffer,
        });
        savedFiles.push(id);
      } catch {
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

export const loadFilesFromFirebase = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const cleanPrefix = prefix.replace(/^\//, "");
        const res = await fetch(
          `${STORAGE_SERVER_URL}/files/${cleanPrefix}/${id}`,
        );
        if (!res.ok) {
          erroredFiles.set(id, true);
          return;
        }

        const arrayBuffer = await res.arrayBuffer();
        const { data, metadata } = await decompressData<BinaryFileMetadata>(
          new Uint8Array(arrayBuffer),
          { decryptionKey },
        );

        const dataURL = new TextDecoder().decode(data) as DataURL;
        loadedFiles.push({
          mimeType: metadata.mimeType || MIME_TYPES.binary,
          id,
          dataURL,
          created: metadata?.created || Date.now(),
          lastRetrieved: metadata?.created || Date.now(),
        });
      } catch {
        erroredFiles.set(id, true);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};

// Kept for interface compatibility with ExportToExcalidrawPlus which still
// uses firebase.ts directly (that feature is intentionally Excalidraw Plus-only)
export const loadFirebaseStorage = async () => null;
