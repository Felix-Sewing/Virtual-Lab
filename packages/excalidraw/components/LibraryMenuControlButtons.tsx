import clsx from "clsx";

import type { ExcalidrawProps, UIAppState } from "../types";

export const LibraryMenuControlButtons = ({
  style,
  children,
  className,
}: {
  libraryReturnUrl?: ExcalidrawProps["libraryReturnUrl"];
  theme?: UIAppState["theme"];
  id?: string;
  style: React.CSSProperties;
  children?: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={clsx("library-menu-control-buttons", className)}
      style={style}
    >
      {children}
    </div>
  );
};
