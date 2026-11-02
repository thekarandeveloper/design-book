// AppTextField. The error text is part of the field rather than something a screen adds
// underneath, so a field is never shown without room for its message.

export const FIELD_STATES = ['default', 'focus', 'error'];

export function Field({ label = 'Label', placeholder = 'Placeholder', value = '', state = 'default', error = '' }) {
  const stateClass = state === 'default' ? '' : `field-box--${state}`;
  return (
    <label className="field">
      {label ? <span className="field-label">{label}</span> : null}
      <span className={['field-box', stateClass].filter(Boolean).join(' ')}>
        <input placeholder={placeholder} defaultValue={value} />
      </span>
      {state === 'error' && error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}
