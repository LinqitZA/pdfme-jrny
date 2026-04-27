import type { ThemeConfig } from 'antd';

export const defaultTheme: ThemeConfig = {
  token: {
    colorPrimary: '#3b82f6', // blue-500 — matches host JRNY theme
    colorBgContainer: '#ffffff',
    colorBgLayout: '#f1f5f9', // slate-100
    colorText: '#0f172a', // slate-900
    colorTextSecondary: '#64748b', // slate-500
    colorBorder: '#e2e8f0', // slate-200
    colorBorderSecondary: '#f1f5f9', // slate-100
    borderRadius: 6,
    fontSize: 13,
  },
  components: {
    Form: {
      fontSize: 12,
      margin: 8,
      marginLG: 12,
      marginXS: 4,
      padding: 8,
      paddingLG: 12,
      paddingXS: 4,
      itemMarginBottom: 4,
      verticalLabelPadding: '0 0 2px',
    },
  },
};
