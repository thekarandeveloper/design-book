import { Card } from './Card.jsx';
import { ShimmerLines } from '../micro/Shimmer.jsx';

export function LoadingCard({ lines = 3, context = 'system' }) {
  return (
    <Card context={context}>
      <ShimmerLines lines={lines} />
    </Card>
  );
}
