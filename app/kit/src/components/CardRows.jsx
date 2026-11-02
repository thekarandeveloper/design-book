import { Card } from './Card.jsx';
import { Row } from '../micro/Row.jsx';

// The most common block there is: a card holding rows. Rows are given as lines of
// "title | caption | value" so this reads as content rather than as markup.

export function CardRows({ context = 'system', rows = 'Breakfast | Poha, chai | 320\nLunch | Dal, rice | 610\nDinner |  | Add' }) {
  const parsed = String(rows)
    .split('\n')
    .map(line => line.split('|').map(s => s.trim()))
    .filter(parts => parts[0]);
  return (
    <Card context={context} tight>
      {parsed.map((parts, i) => (
        <Row key={i} title={parts[0]} caption={parts[1] || ''} value={parts[2] || ''} />
      ))}
    </Card>
  );
}
