import React, { useEffect, useRef, useState } from 'react';
import { Puck } from '@puckeditor/core';
import { puckConfig } from 'virtual:studio-catalog';
import { getPage, putPage } from './api.js';

// The page editor. Drag components in, reorder them, change their props. What is saved is
// the page's JSON, so a screen stays a small file that both a person and an agent can
// read, and the components themselves are never rewritten by the editor.

export function Editor({ page, onSaved }) {
  const [doc, setDoc] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    getPage(page).then(d => { if (alive) setDoc(d); }, () => setDoc(null));
    return () => { alive = false; };
  }, [page]);

  if (!doc) return <div className="st-doc"><p className="st-note-line">Loading {page}...</p></div>;

  const save = (data, immediate) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      putPage(page, { data }).then(() => onSaved && onSaved()).catch(() => {});
    }, immediate ? 0 : 700);
  };

  return (
    <div className="st-editor">
      <Puck
        config={puckConfig}
        data={doc.data}
        iframe={{ enabled: false }}
        onChange={data => save(data, false)}
        onPublish={data => save(data, true)}
      />
    </div>
  );
}
