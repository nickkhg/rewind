import { COLUMN_COLORS, COLUMN_ROLE_COLORS } from "../lib/types";
import type { Column } from "../lib/types";

/**
 * Gives each column its card color. The two role columns keep their own color, and the other
 * columns run through the sticky colors in order. Thus a board keeps its colors when the role
 * columns come and go.
 */
export function columnColors(columns: Column[]): string[] {
  let plain = 0;
  return columns.map((column) => {
    if (column.role) return COLUMN_ROLE_COLORS[column.role];
    return COLUMN_COLORS[plain++ % COLUMN_COLORS.length];
  });
}
