import { useEffect, useState } from 'react';

// A hash router, by hand. One studio per repo, so a route is just which surface is open.
//
//   #/pages        the board of screens
//   #/system       the project's tokens
//   #/components   the project's components
//   #/moodboard    references
//   #/edit/<page>  the editor for a screen the canvas owns

export function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/pages');
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || '/pages');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function parseRoute(hash) {
  const parts = hash.split('/').filter(Boolean);
  if (!parts.length) return { view: 'pages' };
  if (parts[0] === 'edit') return { view: 'edit', page: decodeURIComponent(parts[1] || '') };
  return { view: parts[0] };
}

export const go = route => { window.location.hash = route; };
