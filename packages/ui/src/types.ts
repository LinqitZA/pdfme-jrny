import type { SchemaForUI, Size, ChangeSchemas, BasePdf } from '@pdfme/common';

export type SidebarProps = {
  height: number;
  hoveringSchemaId: string | null;
  onChangeHoveringSchemaId: (id: string | null) => void;
  size: Size;
  pageSize: Size;
  basePdf: BasePdf;
  activeElements: HTMLElement[];
  schemas: SchemaForUI[];
  schemasList: SchemaForUI[][];
  onSortEnd: (sortedSchemas: SchemaForUI[]) => void;
  onEdit: (id: string) => void;
  onEditEnd: () => void;
  changeSchemas: ChangeSchemas;
  deselectSchema: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (sidebarOpen: boolean) => void;
  /** Callback when page size changes (only for blank PDF templates) */
  onPageSizeChange?: (width: number, height: number) => void;
  /** Callback when page padding changes (only for blank PDF templates) */
  onPaddingChange?: (padding: [number, number, number, number]) => void;
};
