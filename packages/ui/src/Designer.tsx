import React from 'react';
import {
  cloneDeep,
  Template,
  DesignerProps,
  checkDesignerProps,
  checkTemplate,
  PDFME_VERSION,
} from '@pdfme/common';
import { BaseUIClass } from './class.js';
import { DESTROYED_ERR_MSG } from './constants.js';
import DesignerComponent from './components/Designer/index.js';
import AppContextProvider from './components/AppContextProvider.js';
import type { FieldGroup } from './contexts/FieldPaletteContext.js';

/** Extended DesignerProps that includes optional ERP field groups */
export type DesignerPropsWithFields = DesignerProps & {
  /** Optional ERP field groups for the field palette sidebar */
  fieldGroups?: FieldGroup[];
};

class Designer extends BaseUIClass {
  private onSaveTemplateCallback?: (template: Template) => void;
  private onChangeTemplateCallback?: (template: Template) => void;
  private onPageChangeCallback?: (pageInfo: { currentPage: number; totalPages: number }) => void;
  private pageCursor: number = 0;
  private fieldGroups?: FieldGroup[];

  constructor(props: DesignerPropsWithFields) {
    // Extract fieldGroups before passing to super/check (Zod strict mode rejects unknown keys)
    const { fieldGroups, ...designerProps } = props;
    super(designerProps);
    checkDesignerProps(designerProps);
    this.fieldGroups = fieldGroups;
  }

  public saveTemplate() {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);
    if (this.onSaveTemplateCallback) {
      this.onSaveTemplateCallback(this.template);
    }
  }

  public updateTemplate(template: Template) {
    checkTemplate(template);
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);
    this.template = cloneDeep(template);
    if (this.onChangeTemplateCallback) {
      this.onChangeTemplateCallback(template);
    }
    this.render();
  }

  /**
   * Update the field groups used by the field binding palette.
   * This avoids destroying and re-creating the entire Designer instance
   * when field groups change (e.g. after async loading or SSE updates).
   */
  public updateFieldGroups(fieldGroups?: FieldGroup[]) {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);
    this.fieldGroups = fieldGroups;
    this.render();
  }

  public onSaveTemplate(cb: (template: Template) => void) {
    this.onSaveTemplateCallback = cb;
  }

  public onChangeTemplate(cb: (template: Template) => void) {
    this.onChangeTemplateCallback = cb;
  }

  public onPageChange(cb: (pageInfo: { currentPage: number; totalPages: number }) => void) {
    this.onPageChangeCallback = cb;
  }

  public getPageCursor() {
    return this.pageCursor;
  }

  public getTotalPages() {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);
    return this.template.schemas.length;
  }

  protected render() {
    if (!this.domContainer || !this.reactRoot) throw Error(DESTROYED_ERR_MSG);
    this.reactRoot.render(
      <AppContextProvider
        lang={this.getLang()}
        font={this.getFont()}
        plugins={this.getPluginsRegistry()}
        options={this.getOptions()}
        fieldGroups={this.fieldGroups}
      >
        <DesignerComponent
          template={this.template}
          onSaveTemplate={(template) => {
            this.template = template;
            this.template.pdfmeVersion = PDFME_VERSION;
            if (this.onSaveTemplateCallback) {
              this.onSaveTemplateCallback(template);
            }
          }}
          onChangeTemplate={(template) => {
            this.template = template;
            this.template.pdfmeVersion = PDFME_VERSION;
            if (this.onChangeTemplateCallback) {
              this.onChangeTemplateCallback(template);
            }
          }}
          onPageCursorChange={(newPageCursor: number, totalPages: number) => {
            this.pageCursor = newPageCursor;
            if (this.onPageChangeCallback) {
              this.onPageChangeCallback({
                currentPage: newPageCursor,
                totalPages: totalPages,
              });
            }
          }}
          size={this.size}
        />
      </AppContextProvider>,
    );
  }
}

export default Designer;
