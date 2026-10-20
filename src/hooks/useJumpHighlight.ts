import { useCallback, useEffect, useRef, useState } from "react";

export function useJumpHighlight(
  attribute = "data-jump-target",
  duration = 900
) {
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const jumpTo = useCallback(
    (targetId: string) => {
      if (!targetId) return;
      cancel();
      setHighlightId(null);
      frameRef.current = window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(
          `[${attribute}="${CSS.escape(targetId)}"]`
        );
        if (!target) return;
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        target.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: reduceMotion ? "auto" : "smooth",
        });
        frameRef.current = window.requestAnimationFrame(() => {
          setHighlightId(targetId);
          timerRef.current = window.setTimeout(
            () => setHighlightId(null),
            duration
          );
        });
      });
    },
    [attribute, cancel, duration]
  );

  useEffect(
    () => () => {
      cancel();
    },
    [cancel]
  );

  return { highlightId, jumpTo };
}
