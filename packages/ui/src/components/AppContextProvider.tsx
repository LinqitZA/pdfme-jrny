import React, { useMemo } from 'react';
import { ConfigProvider as ThemeConfigProvider } from 'antd';
import { I18nContext, FontContext, PluginsRegistry, OptionsContext } from '../contexts.js';
import { i18n, getDict } from '../i18n.js';
import { defaultTheme } from '../theme.js';
import {
  FieldPaletteContext,
  type FieldGroup,
  type FieldPaletteContextValue,
} from '../contexts/FieldPaletteContext.js';
import type { Dict, Font, Lang, UIOptions, PluginRegistry } from '@pdfme/common';

type Props = {
  children: React.ReactNode;
  lang: Lang;
  font: Font;
  plugins: PluginRegistry;
  options: UIOptions;
  /** Optional ERP field groups for the field palette sidebar */
  fieldGroups?: FieldGroup[];
};

const isObject = (item: unknown): item is Record<string, unknown> =>
  Boolean(item) && typeof item === 'object' && !Array.isArray(item);

const deepMerge = <T extends Record<string, unknown>, U extends Record<string, unknown>>(
  target: T,
  source: U,
): T & U => {
  let output = { ...target } as T & U;

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      const sourceValue = source[key];
      if (isObject(sourceValue)) {
        if (!(key in target)) {
          Object.assign(output, { [key]: sourceValue });
        } else {
          const targetValue = target[key];
          if (isObject(targetValue)) {
            // Using Record<string, unknown> for recursive type
            (output as Record<string, unknown>)[key] = deepMerge(targetValue, sourceValue);
          } else {
            Object.assign(output, { [key]: sourceValue });
          }
        }
      } else {
        Object.assign(output, { [key]: sourceValue });
      }
    });
  }
  return output;
};

const AppContextProvider = ({ children, lang, font, plugins, options, fieldGroups }: Props) => {
  let theme = defaultTheme;
  if (options.theme) {
    theme = deepMerge(
      theme as unknown as Record<string, unknown>,
      options.theme as unknown as Record<string, unknown>,
    ) as typeof theme;
  }

  let dict = getDict(lang);
  if (options.labels) {
    dict = deepMerge(
      dict as unknown as Record<string, unknown>,
      options.labels as unknown as Record<string, unknown>,
    ) as typeof dict;
  }

  const fieldPaletteValue = useMemo<FieldPaletteContextValue>(
    () => ({
      fieldGroups: fieldGroups ?? [],
      hasFields: (fieldGroups ?? []).length > 0,
    }),
    [fieldGroups],
  );

  return (
    <ThemeConfigProvider
      theme={theme}
      // antd v6: Modal/Drawer mask has blur enabled by default — disable it
      // to prevent the backdrop filter from interfering with the WYSIWYG canvas
      modal={{ mask: { blur: false } }}
      drawer={{ mask: { blur: false } }}
    >
      <I18nContext.Provider value={(key: keyof Dict) => i18n(key, dict)}>
        <FontContext.Provider value={font}>
          <PluginsRegistry.Provider value={plugins}>
            <OptionsContext.Provider value={options}>
              <FieldPaletteContext.Provider value={fieldPaletteValue}>
                {children}
              </FieldPaletteContext.Provider>
            </OptionsContext.Provider>
          </PluginsRegistry.Provider>
        </FontContext.Provider>
      </I18nContext.Provider>
    </ThemeConfigProvider>
  );
};

export default AppContextProvider;
