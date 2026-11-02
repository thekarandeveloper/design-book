// Loading looks like the content that is coming, not like a spinner. It stops under
// prefers-reduced-motion.

export function Shimmer({ height = 16, width = '60%' }) {
  return <div className="shimmer" style={{ height: Number(height), width }} />;
}

export function ShimmerLines({ lines = 3 }) {
  const widths = ['60%', '85%', '40%', '70%', '50%'];
  return (
    <div className="cards">
      {Array.from({ length: Number(lines) }, (_, i) => (
        <Shimmer key={i} height={16} width={widths[i % widths.length]} />
      ))}
    </div>
  );
}
