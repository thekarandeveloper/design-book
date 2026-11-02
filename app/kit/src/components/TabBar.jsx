export function TabBar({ items = 'Today, Plan, Basket, Me', selected = 'Today' }) {
  const list = String(items).split(',').map(s => s.trim()).filter(Boolean);
  return (
    <nav className="tab-bar">
      {list.map(item => (
        <span key={item} className={item === selected ? 'tab tab--on' : 'tab'}>
          {item === selected ? '●' : '□'}
          <span>{item}</span>
        </span>
      ))}
    </nav>
  );
}
