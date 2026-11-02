export function Chip({ label = 'All', on = false }) {
  return <span className={on ? 'chip chip--on' : 'chip'}>{label}</span>;
}

export function Chips({ items = 'All, Breakfast, Lunch, Dinner', selected = 'All' }) {
  const list = String(items).split(',').map(s => s.trim()).filter(Boolean);
  return (
    <div className="chips">
      {list.map(item => <Chip key={item} label={item} on={item === selected} />)}
    </div>
  );
}
