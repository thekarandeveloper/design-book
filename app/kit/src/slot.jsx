import React from 'react';

// A slot prop arrives in two different shapes and both are legitimate.
//
// Puck hands a slot to a component as a COMPONENT, so it can draw its own drop zone
// around it. Everywhere else (the galleries, a test, a component composed by hand) the
// same prop is ordinary React children. Accepting both means a component does not have
// to know whether it is being rendered by the editor or not.

export function Slot({ value }) {
  if (!value) return null;
  if (typeof value === 'function') {
    const Rendered = value;
    return <Rendered />;
  }
  return <>{value}</>;
}
