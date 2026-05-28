import React, { useLayoutEffect, useRef } from 'react';

/** Shrinks font size so amount text fits on one line inside its container. */
export default function FlexAmount({ value, className = '', prefix = '₹' }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      let size = 16;
      el.style.fontSize = `${size}px`;
      while (el.scrollWidth > el.clientWidth && size > 9) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };

    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el.parentElement || el);
    window.addEventListener('resize', fit);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [value]);

  return (
    <div ref={ref} className={className}>
      {prefix}
      {value}
    </div>
  );
}
