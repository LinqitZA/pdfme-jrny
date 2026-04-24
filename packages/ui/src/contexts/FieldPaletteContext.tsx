import { createContext, useContext } from 'react';

/**
 * A single field entry within a field group.
 * Represents an ERP data field that can be dragged onto a template.
 */
export interface FieldEntry {
  /** The data key used for placeholder substitution, e.g. "customer.name" */
  key: string;
  /** Human-readable label shown in the palette, e.g. "Customer Name" */
  label: string;
  /** Optional data type hint, e.g. "string", "number", "date", "currency" */
  type?: string;
  /** Optional example value for preview, e.g. "Acme Corp" */
  example?: string;
}

/**
 * A group of related fields, optionally nested.
 * Used to organize ERP fields into logical sections in the designer sidebar.
 */
export interface FieldGroup {
  /** Unique key for this group, e.g. "customer", "lineItems" */
  key: string;
  /** Human-readable label for the group, e.g. "Customer Details" */
  label: string;
  /** Fields belonging to this group */
  fields: FieldEntry[];
  /** Optional nested sub-groups for hierarchical organization */
  children?: FieldGroup[];
}

/**
 * Shape of the FieldPaletteContext value.
 */
export interface FieldPaletteContextValue {
  fieldGroups: FieldGroup[];
  hasFields: boolean;
}

const defaultValue: FieldPaletteContextValue = {
  fieldGroups: [],
  hasFields: false,
};

/**
 * React context that carries ERP field schema data into the pdfme component tree.
 * Allows LeftSidebar and RightSidebar to access field groups without prop drilling.
 */
export const FieldPaletteContext = createContext<FieldPaletteContextValue>(defaultValue);

/**
 * Hook to access the ERP field palette from within the pdfme component tree.
 *
 * @returns { fieldGroups, hasFields } — the field groups and a convenience boolean
 */
export function useFieldPalette(): FieldPaletteContextValue {
  return useContext(FieldPaletteContext);
}
