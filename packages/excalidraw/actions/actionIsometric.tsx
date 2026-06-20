import { CaptureUpdateAction, newElementWith } from "@excalidraw/element";

import { t } from "../i18n";

import { changeProperty, getFormValue } from "./actionProperties";
import { register } from "./register";

// Isometric skew presets (skewX, skewY) in degrees
// Angles (degrees) such that the renderer produces correct isometric unit-vector axes.
// Canvas transform: X axis → (cos(skewY), sin(skewY)), Y axis → (sin(skewX), cos(skewX))
// left/right: skewX=0 so Y stays vertical; X tilted ±30° and compressed to unit length.
// top: X→(0.866,-0.5) right-upward, Y→(-0.866,-0.5) left-upward (skewX=-120°, skewY=-30°).
const ISOMETRIC_PRESETS = {
  none:  { skewX:    0, skewY:   0 },
  top:   { skewX: -120, skewY: -30 },
  left:  { skewX:    0, skewY:  30 },
  right: { skewX:    0, skewY: -30 },
} as const;

type IsometricFace = keyof typeof ISOMETRIC_PRESETS;

const getFaceFromSkew = (skewX: number, skewY: number): IsometricFace => {
  for (const [face, preset] of Object.entries(ISOMETRIC_PRESETS) as [
    IsometricFace,
    { skewX: number; skewY: number },
  ][]) {
    if (preset.skewX === skewX && preset.skewY === skewY) {
      return face;
    }
  }
  return "none";
};

// Inline SVG icons for the three isometric faces
const IsometricTopIcon = (
  <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor">
    <polygon points="10,2 18,7 10,12 2,7" />
  </svg>
);

const IsometricLeftIcon = (
  <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor">
    <polygon points="2,7 10,12 10,18 2,13" />
  </svg>
);

const IsometricRightIcon = (
  <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor">
    <polygon points="10,12 18,7 18,13 10,18" />
  </svg>
);

export const actionChangeIsometricFace = register<IsometricFace>({
  name: "changeIsometricFace",
  label: "labels.isometricFace",
  trackEvent: false,
  perform: (elements, appState, value) => {
    const preset = (value ? ISOMETRIC_PRESETS[value] : null) ?? ISOMETRIC_PRESETS.none;
    return {
      elements: changeProperty(
        elements,
        appState,
        (el) => newElementWith(el, { skewX: preset.skewX, skewY: preset.skewY }),
        true,
      ),
      appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, updateData, app }) => {
    const currentFace = getFormValue(
      elements,
      app,
      (el) => getFaceFromSkew(el.skewX ?? 0, el.skewY ?? 0),
      true,
      "none" as IsometricFace,
    );

    const btn = (face: IsometricFace, icon: React.ReactNode, label: string) => (
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={currentFace === face}
        className={`zoomButton${currentFace === face ? " active" : ""}`}
        style={{ padding: "4px 8px", opacity: currentFace === face ? 1 : 0.6 }}
        onClick={() => updateData(face === currentFace ? "none" : face)}
      >
        {icon}
      </button>
    );

    return (
      <fieldset>
        <legend>{t("labels.isometricFace")}</legend>
        <div className="buttonList" style={{ gap: "4px" }}>
          {btn("top",   IsometricTopIcon,   t("labels.isometricTop"))}
          {btn("left",  IsometricLeftIcon,  t("labels.isometricLeft"))}
          {btn("right", IsometricRightIcon, t("labels.isometricRight"))}
        </div>
      </fieldset>
    );
  },
});
