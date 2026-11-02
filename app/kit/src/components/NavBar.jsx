import { NavButton } from '../micro/NavButton.jsx';

// DSNavigationBar. The title is centred by a padding that balances the left button, so it
// stays centred whether or not there is a button.

export function NavBar({ title = 'Title', leading = 'close' }) {
  return (
    <nav className="nav">
      {leading === 'none' ? null : <NavButton kind={leading} />}
      <span className="nav-title">{title}</span>
    </nav>
  );
}
