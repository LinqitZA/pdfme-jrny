import { createContext, useContext } from 'react';

/** Grid size in mm. 0 means grid is hidden. */
export type GridSizeMm = 0 | 2.5 | 5 | 10;

/** Default grid spacing — 5mm, matching the previous hardcoded value */
export const DEFAULT_GRID_SIZE_MM: GridSizeMm = 5;

/**
 * Shape of the GridContext value.
 */
export interface GridContextValue {
  /** Grid spacing in mm; 0 = no grid */
  gridSizeMm: GridSizeMm;
}

const defaultValue: GridContextValue = {
  gridSizeMm: DEFAULT_GRID_SIZE_MM,
};

/**
 * React context that carries grid spacing configuration into the pdfme component tree.
 * Consumed by Paper.tsx to compute grid dot spacing, and by CtlBar for the selector.
 */
export const GridContext = createContext<GridContextValue>(defaultValue);

/**
 * Hook to access the current grid size from within the pdfme component tree.
 *
 * @returns { gridSizeMm } — the grid spacing in mm (0 = hidden)
 */
export function useGridSize(): GridContextValue {
  return useContext(GridContext);
}
