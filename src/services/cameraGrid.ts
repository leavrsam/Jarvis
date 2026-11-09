// Layout for several camera feeds: the number of columns that makes each feed as large as
// possible in the space available, given the feeds' shape. Wide feeds in a wide-ish panel end up
// stacked one above the other; many feeds or a very wide panel spread into columns.

export function bestColumns(count: number, width: number, height: number, aspect = 16 / 9, gap = 8): number {
  if (count <= 1 || width <= 0 || height <= 0) return 1;
  let best = 1;
  let bestArea = -1;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (width - gap * (cols - 1)) / cols;
    const cellH = (height - gap * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    // The feed fits inside its cell at its own shape
    const feedW = Math.min(cellW, cellH * aspect);
    const area = feedW * (feedW / aspect);
    // Prefer fewer columns on ties (stacked reads better than side by side)
    if (area > bestArea * 1.02) {
      best = cols;
      bestArea = area;
    }
  }
  return best;
}
