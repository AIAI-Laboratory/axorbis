import { useEffect, useRef } from "react";

/** Close only the topmost app dialog when Escape is pressed. */
export function ModalEscape({ onClose }: { onClose: () => void }) {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const topmost = dialogs.item(dialogs.length - 1);
      if (!topmost?.contains(marker.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return <span ref={marker} hidden />;
}
