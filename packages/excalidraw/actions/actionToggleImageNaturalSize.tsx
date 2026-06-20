import { CaptureUpdateAction } from "@excalidraw/element";

import { register } from "./register";

export const actionToggleImageNaturalSize = register({
  name: "imageInsertNaturalSize",
  label: "labels.imageInsertNaturalSize",
  viewMode: false,
  trackEvent: {
    category: "canvas",
    predicate: (appState) => !appState.imageInsertNaturalSize,
  },
  perform(elements, appState) {
    return {
      appState: {
        ...appState,
        imageInsertNaturalSize: !this.checked!(appState),
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  },
  checked: (appState) => appState.imageInsertNaturalSize,
});
