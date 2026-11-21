import React, { useEffect, useRef, useState } from 'react';

// The menu that opens where the pointer is.
//
// One of these, shared, because the moodboard and the design system both want the same
// thing from a tile: take its name, or throw it away. Two copies of a menu drift apart,
// and then a right click means one thing in one place and another somewhere else.
//
// It is placed at the pointer and then pulled back inside the window, so a tile at the
// right edge does not open a menu half off the screen.

export function usePointed() {
  const [at, setAt] = useState(null);
  return {
    at,
    close: () => setAt(null),
    // On the element: onContextMenu={pointed.open(itemOfYourOwn)}
    open: item => ev => {
      ev.preventDefault();
      ev.stopPropagation();
      setAt({ x: ev.clientX, y: ev.clientY, item });
    }
  };
}

export function Pointed({ at, onClose, children }) {
  const box = useRef(null);
  const [place, setPlace] = useState({ left: at ? at.x : 0, top: at ? at.y : 0 });

  useEffect(() => {
    if (!at) return;
    const el = box.current;
    const pad = 8;
    const w = el ? el.offsetWidth : 230;
    const h = el ? el.offsetHeight : 80;
    setPlace({
      left: Math.max(pad, Math.min(at.x, window.innerWidth - w - pad)),
      top: Math.max(pad, Math.min(at.y, window.innerHeight - h - pad))
    });
  }, [at]);

  // Anywhere else, or Escape, and it is gone. Captured, so a click that closes the menu
  // does not also land on whatever is underneath it.
  useEffect(() => {
    if (!at) return;
    const away = ev => { if (!box.current || !box.current.contains(ev.target)) onClose(); };
    const key = ev => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [at, onClose]);

  if (!at) return null;
  return (
    <div
      ref={box}
      className="st-menu st-pointed"
      style={{ left: place.left, top: place.top }}
      onContextMenu={ev => ev.preventDefault()}
    >
      {children}
    </div>
  );
}
