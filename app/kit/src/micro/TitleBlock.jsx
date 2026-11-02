// Title to subtitle is 8, and whatever follows sits 24 below. Those two gaps are a
// composition decision, which is why they are tokens and not guesses.

export function TitleBlock({ title = 'Today', subtitle = 'What this screen is for, in one line.' }) {
  return (
    <div className="title-block">
      <h1 className="t-screen-title">{title}</h1>
      {subtitle ? <p className="t-body secondary">{subtitle}</p> : null}
    </div>
  );
}
