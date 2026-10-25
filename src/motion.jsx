import { useEffect, useRef } from "react";

// Motion helpers for the marketing surfaces. Every effect is opt-in, cancels
// its frame/observer on unmount, and collapses to a static final state when the
// user prefers reduced motion — no animation loop is left running off-screen.

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Count a number up when it first scrolls into view. The text is written
// straight to the node (textContent), so 60 frames cost zero React renders.
export function useCountUp(target, { duration = 1100, suffix = "" } = {}) {
  const ref = useRef(null);
  const value = Number(target) || 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      el.textContent = `${value}${suffix}`;
      return;
    }

    el.textContent = `0${suffix}`;
    let raf = 0;
    let started = 0;
    let finished = false;

    const step = (ts) => {
      if (!started) started = ts;
      const p = Math.min(1, (ts - started) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = `${Math.round(value * eased)}${suffix}`;
      if (p < 1) raf = requestAnimationFrame(step);
      else finished = true;
    };

    // Delay the loop until the stat is actually on screen. The observer is
    // disconnected the moment it fires; nothing polls afterwards.
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || finished) return;
        io.disconnect();
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 }
    );
    io.observe(el);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration, suffix]);

  return ref;
}

// Subtle pointer parallax for the hero poster: the card tilts toward the
// cursor and its inner layers shift a few pixels. Desktop pointers only.
export function usePointerTilt(maxTilt = 5, maxShift = 12) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches) return;

    let frame = 0;
    let lastX = 0;
    let lastY = 0;
    let inside = false;

    const paint = () => {
      frame = 0;
      el.style.setProperty("--tilt-x", `${(-lastY * maxTilt).toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${(lastX * maxTilt).toFixed(2)}deg`);
      el.style.setProperty("--shift-x", `${(lastX * maxShift).toFixed(1)}px`);
      el.style.setProperty("--shift-y", `${(lastY * maxShift).toFixed(1)}px`);
    };

    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      lastX = (e.clientX - r.left) / r.width - 0.5;
      lastY = (e.clientY - r.top) / r.height - 0.5;
      inside = true;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onLeave = () => {
      inside = false;
      cancelAnimationFrame(frame);
      frame = 0;
      el.style.setProperty("--tilt-x", "0deg");
      el.style.setProperty("--tilt-y", "0deg");
      el.style.setProperty("--shift-x", "0px");
      el.style.setProperty("--shift-y", "0px");
    };

    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);

    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
      if (inside) el.style.setProperty("--shift-x", "0px");
    };
  }, [maxTilt, maxShift]);

  return ref;
}
