import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";

const SNAP_IDLE_MS = 110;
const MIN_ANIMATION_MS = 120;
const MAX_ANIMATION_MS = 280;
const MIN_SNAP_DISTANCE = 72;
const MAX_SNAP_DISTANCE = 180;
const SNAP_DISTANCE_RATIO = 0.18;

export type ParagraphSnapOutcome =
  | { kind: "ignored" }
  | { kind: "handled" }
  | { kind: "boundary"; side: "start" | "end" };

function readSnapPoints(el: HTMLDivElement, maxScroll: number): number[] {
  const containerTop = el.getBoundingClientRect().top;
  const cards = Array.from(
    el.querySelectorAll<HTMLElement>("[data-card-index]")
  );
  const interiorCards = cards.length > 2 ? cards.slice(1, -1) : [];
  const cardPoints = interiorCards.map((card) => {
    const top = el.scrollTop + card.getBoundingClientRect().top - containerTop;
    return Math.min(maxScroll, Math.max(0, top));
  });

  return cardPoints
    .sort((a, b) => a - b)
    .filter((point, index, points) => {
      return index === 0 || Math.abs(point - points[index - 1]) > 3;
    });
}

/**
 * 正文滚轮的段落惯性吸附。
 *
 * 滚轮和触控板保持原生滚动，允许一次手势跨过多段。等滚动真正停下后，
 * 只在距离段落起点较近时补一段短缓出，把停稳的位置对齐到段首。
 * 离任何段首都很远时保持原位，避免从长段落中间突然拉回开头。
 * 首段和末段不参与吸附，让章节入口和出口保持原生滚动。
 * 到达首尾后返回 boundary，让 ChapterStream 继续处理原有翻章逻辑。
 */
export function useParagraphSnap(
  scrollRef: RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  const animationFrame = useRef<number | null>(null);
  const snapTimer = useRef<number | null>(null);
  const animating = useRef(false);
  const wheelActive = useRef(false);

  const clearSnapTimer = useCallback(() => {
    if (snapTimer.current !== null) {
      window.clearTimeout(snapTimer.current);
      snapTimer.current = null;
    }
  }, []);

  const stopAnimation = useCallback(() => {
    if (animationFrame.current !== null) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
    animating.current = false;
  }, []);

  const cancel = useCallback(() => {
    clearSnapTimer();
    stopAnimation();
    wheelActive.current = false;
  }, [clearSnapTimer, stopAnimation]);

  useEffect(() => {
    if (!enabled) cancel();
    return cancel;
  }, [cancel, enabled]);

  const animateTo = useCallback(
    (el: HTMLDivElement, nextTop: number) => {
      stopAnimation();
      const from = el.scrollTop;
      const distance = nextTop - from;
      if (Math.abs(distance) < 0.5) return;

      const startedAt = performance.now();
      const duration = Math.min(
        MAX_ANIMATION_MS,
        Math.max(MIN_ANIMATION_MS, Math.abs(distance) * 0.8 + 90)
      );
      animating.current = true;

      const tick = (now: number) => {
        if (!animating.current) return;
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 4);
        el.scrollTop = from + distance * eased;
        if (progress < 1) {
          animationFrame.current = requestAnimationFrame(tick);
        } else {
          animationFrame.current = null;
          animating.current = false;
          el.scrollTop = nextTop;
        }
      };
      animationFrame.current = requestAnimationFrame(tick);
    },
    [stopAnimation]
  );

  const snapToNearest = useCallback(() => {
    const el = scrollRef.current;
    if (!el || animating.current) return;

    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const points = readSnapPoints(el, maxScroll);
    if (!points.length) return;

    let nearest = points[0];
    for (const point of points) {
      if (Math.abs(point - el.scrollTop) < Math.abs(nearest - el.scrollTop)) {
        nearest = point;
      }
    }

    const threshold = Math.min(
      MAX_SNAP_DISTANCE,
      Math.max(MIN_SNAP_DISTANCE, el.clientHeight * SNAP_DISTANCE_RATIO)
    );
    if (Math.abs(nearest - el.scrollTop) <= threshold) {
      animateTo(el, nearest);
    }
  }, [animateTo, scrollRef]);

  const scheduleSnap = useCallback(() => {
    if (!enabled || !wheelActive.current || animating.current) return;
    clearSnapTimer();
    snapTimer.current = window.setTimeout(() => {
      snapTimer.current = null;
      if (!wheelActive.current || animating.current) return;
      wheelActive.current = false;
      snapToNearest();
    }, SNAP_IDLE_MS);
  }, [clearSnapTimer, enabled, snapToNearest]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    /*
     * 原生惯性滚动会持续触发 scroll，不能只按最后一次 wheel 计时，
     * 否则吸附动画会和浏览器自己的动量滚动抢方向。
     */
    const onScroll = () => {
      if (!wheelActive.current || animating.current) return;
      scheduleSnap();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [enabled, scheduleSnap, scrollRef]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>): ParagraphSnapOutcome => {
      if (
        !enabled ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        return { kind: "ignored" };
      }

      const el = scrollRef.current;
      if (!el || event.deltaY === 0) return { kind: "ignored" };

      stopAnimation();
      clearSnapTimer();

      const direction: -1 | 1 = event.deltaY > 0 ? 1 : -1;
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (direction > 0 && el.scrollTop >= maxScroll - 1) {
        wheelActive.current = false;
        return { kind: "boundary", side: "end" };
      }
      if (direction < 0 && el.scrollTop <= 1) {
        wheelActive.current = false;
        return { kind: "boundary", side: "start" };
      }

      wheelActive.current = true;
      scheduleSnap();
      return { kind: "handled" };
    },
    [clearSnapTimer, enabled, scheduleSnap, scrollRef, stopAnimation]
  );

  return { cancel, handleWheel };
}
