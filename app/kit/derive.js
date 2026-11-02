// Turning a catalog into the three things that are built from it.
//
// The kit ships one catalog and a repo's .designbook/components folder contributes more, so
// deriving has to happen after both are merged. That is why it lives here rather than in
// the kit's own catalog file.

export function buildPuckConfig(catalog) {
  const micro = catalog.filter(c => c.group === 'micro').map(c => c.name);
  const blocks = catalog.filter(c => c.group !== 'micro').map(c => c.name);
  return {
    categories: {
      Components: { title: 'Components', components: blocks },
      Micro: { title: 'Micro components', components: micro }
    },
    components: Object.fromEntries(catalog.map(c => [
      c.name,
      { label: c.name, fields: c.fields || {}, defaultProps: c.defaultProps || {}, render: c.render }
    ]))
  };
}

// What an agent reads instead of the component files. Small on purpose.
export function buildIndex(catalog) {
  return {
    components: catalog.map(c => ({
      name: c.name,
      group: c.group,
      source: c.source || 'kit',
      file: c.file,
      native: c.native,
      note: c.note,
      props: Object.fromEntries(Object.entries(c.fields || {}).map(([k, f]) => [
        k,
        f.type === 'select' || f.type === 'radio' ? (f.options || []).map(o => o.value) : f.type
      ])),
      defaults: c.defaultProps || {}
    }))
  };
}

// A component in .designbook/components exports `meta` beside its default export. Anything
// missing is filled in, so the smallest useful component is a render function and a name.
export function normalise(module, file) {
  const render = module.default;
  if (typeof render !== 'function') return null;
  const meta = module.meta || {};
  const name = meta.name || file.split('/').pop().replace(/\.jsx?$/, '');
  return {
    name,
    group: meta.group === 'micro' ? 'micro' : 'component',
    source: 'canvas',
    file,
    native: meta.native || '',
    note: meta.note || '',
    fields: meta.fields || {},
    defaultProps: meta.defaultProps || {},
    examples: meta.examples || [{}],
    render
  };
}
