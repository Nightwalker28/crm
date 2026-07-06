type ViewTransition = {
  ready: Promise<void>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

function requireBrowserDownloadTarget() {
  if (
    typeof window === "undefined" ||
    typeof window.URL?.createObjectURL !== "function" ||
    typeof window.URL?.revokeObjectURL !== "function" ||
    typeof window.document?.createElement !== "function" ||
    !window.document.body
  ) {
    throw new Error("Downloads require a browser window.");
  }

  return {
    document: window.document,
    urlApi: window.URL,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const { document, urlApi } = requireBrowserDownloadTarget();
  const url = urlApi.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    urlApi.revokeObjectURL(url);
  }
}

export function openBlobInNewTab(blob: Blob, fallbackFilename: string, revokeAfterMs = 60_000) {
  const { urlApi } = requireBrowserDownloadTarget();
  const url = urlApi.createObjectURL(blob);
  const opened = typeof window.open === "function" ? window.open(url, "_blank", "noopener,noreferrer") : null;
  if (!opened) {
    urlApi.revokeObjectURL(url);
    downloadBlob(blob, fallbackFilename);
    return false;
  }

  window.setTimeout(() => urlApi.revokeObjectURL(url), revokeAfterMs);
  return true;
}

export async function runViewTransition(callback: () => void) {
  if (typeof document === "undefined") {
    callback();
    return false;
  }

  const transitionDocument = document as ViewTransitionDocument;
  if (typeof transitionDocument.startViewTransition !== "function") {
    callback();
    return false;
  }

  await transitionDocument.startViewTransition(callback).ready;
  return true;
}
