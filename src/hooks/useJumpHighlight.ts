import { useCallback, useEffect, useRef, useState } from "react";

const HIGHLIGHT_DURATION = 1_400;
const SCROLL_SETTLE_DELAY = 160;
const SCROLL_SETTLE_FALLBACK = 700;

function scrollContainerOf(target: HTMLElement): HTMLElement | null {
  let current = target.parentElement;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function useJumpHighlight(
  attribute = "data-jump-target",
  duration = HIGHLIGHT_DURATION
) {
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);

  const stopWaitingForScroll = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    scrollCleanupRef.current?.();
    scrollCleanupRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    stopWaitingForScroll();
  }, [stopWaitingForScroll]);

  const jumpTo = useCallback(
    (targetId: string) => {
      if (!targetId) return;
      cancel();
      setHighlightId(null);
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const target = document.querySelector<HTMLElement>(
          `[${attribute}="${CSS.escape(targetId)}"]`
        );
        if (!target) return;
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        const showHighlight = () => {
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            setHighlightId(targetId);
            timerRef.current = window.setTimeout(
              () => setHighlightId(null),
              duration
            );
          });
        };
        const container = scrollContainerOf(target);
        if (!container) {
          target.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: reduceMotion ? "auto" : "smooth",
          });
          settleTimerRef.current = window.setTimeout(
            showHighlight,
            reduceMotion ? 0 : SCROLL_SETTLE_FALLBACK
          );
          return;
        }

        const targetRect = target.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const targetTop =
          container.scrollTop + targetRect.top - containerRect.top;
        const centeredTop =
          targetTop - (container.clientHeight - targetRect.height) / 2;
        const maxTop = Math.max(
          0,
          container.scrollHeight - container.clientHeight
        );
        const nextTop = Math.max(0, Math.min(maxTop, centeredTop));

        const hasBreathingRoom =
          targetRect.top >= containerRect.top + 16 &&
          targetRect.bottom <= containerRect.bottom - 16;
        if (hasBreathingRoom || Math.abs(nextTop - container.scrollTop) < 1) {
          showHighlight();
          return;
        }

        const settle = () => {
          stopWaitingForScroll();
          showHighlight();
        };
        const onScroll = () => {
          if (settleTimerRef.current !== null) {
            window.clearTimeout(settleTimerRef.current);
          }
          settleTimerRef.current = window.setTimeout(
            settle,
            SCROLL_SETTLE_DELAY
          );
        };
        container.addEventListener("scroll", onScroll, { passive: true });
        container.addEventListener("scrollend", settle, { once: true });
        scrollCleanupRef.current = () => {
          container.removeEventListener("scroll", onScroll);
          container.removeEventListener("scrollend", settle);
        };
        settleTimerRef.current = window.setTimeout(
          settle,
          SCROLL_SETTLE_FALLBACK
        );
        container.scrollTo({
          top: nextTop,
          behavior: reduceMotion ? "auto" : "smooth",
        });
        if (reduceMotion) {
          stopWaitingForScroll();
          showHighlight();
        }
      });
    },
    [attribute, cancel, duration, stopWaitingForScroll]
  );

  useEffect(
    () => () => {
      cancel();
    },
    [cancel]
  );

  return { highlightId, jumpTo };
}
