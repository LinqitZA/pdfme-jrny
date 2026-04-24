"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSingleTable = createSingleTable;
const common_1 = require("@pdfme/common");
const classes_js_1 = require("./classes.js");
function parseSection(sectionName, sectionRows, columns, styleProps, fallbackFontName) {
    const rowSpansLeftForColumn = {};
    const result = sectionRows.map((rawRow, rowIndex) => {
        let skippedRowForRowSpans = 0;
        const cells = {};
        let colSpansAdded = 0;
        let columnSpansLeft = 0;
        for (const column of columns) {
            if (rowSpansLeftForColumn[column.index] == null ||
                rowSpansLeftForColumn[column.index].left === 0) {
                if (columnSpansLeft === 0) {
                    let rawCell;
                    if (Array.isArray(rawRow)) {
                        rawCell = rawRow[column.index - colSpansAdded - skippedRowForRowSpans];
                    }
                    else {
                        rawCell = rawRow[column.index];
                    }
                    const styles = cellStyles(sectionName, column, rowIndex, styleProps, fallbackFontName);
                    const cell = new classes_js_1.Cell(rawCell, styles, sectionName);
                    cells[column.index] = cell;
                    columnSpansLeft = 0;
                    rowSpansLeftForColumn[column.index] = {
                        left: 0,
                        times: columnSpansLeft,
                    };
                }
                else {
                    columnSpansLeft--;
                    colSpansAdded++;
                }
            }
            else {
                rowSpansLeftForColumn[column.index].left--;
                columnSpansLeft = rowSpansLeftForColumn[column.index].times;
                skippedRowForRowSpans++;
            }
        }
        return new classes_js_1.Row(rawRow, rowIndex, sectionName, cells);
    });
    return result;
}
function parseContent4Table(input, fallbackFontName) {
    const content = input.content;
    const columns = content.columns.map((index) => new classes_js_1.Column(index));
    const styles = input.styles;
    return {
        columns,
        head: parseSection('head', content.head, columns, styles, fallbackFontName),
        body: parseSection('body', content.body, columns, styles, fallbackFontName),
    };
}
function cellStyles(sectionName, column, rowIndex, styles, fallbackFontName) {
    let sectionStyles;
    if (sectionName === 'head') {
        sectionStyles = styles.headStyles;
    }
    else if (sectionName === 'body') {
        sectionStyles = styles.bodyStyles;
    }
    const otherStyles = Object.assign({}, styles.styles, sectionStyles);
    const colStyles = styles.columnStyles[column.index] || {};
    const sectionColStyles = sectionName === 'head'
        ? (styles.headColumnStyles?.[column.index] || {})
        : (styles.bodyColumnStyles?.[column.index] || {});
    const rowStyles = sectionName === 'body' && rowIndex % 2 === 0
        ? Object.assign({}, styles.alternateRowStyles)
        : {};
    const defaultStyle = {
        fontName: fallbackFontName,
        backgroundColor: '',
        textColor: '#000000',
        lineHeight: 1,
        characterSpacing: 0,
        alignment: 'left',
        verticalAlignment: 'middle',
        fontSize: 10,
        cellPadding: { top: 5, right: 5, bottom: 5, left: 5 },
        lineColor: '#000000',
        lineWidth: { top: 0, right: 0, bottom: 0, left: 0 },
        minCellHeight: 0,
        minCellWidth: 0,
    };
    return Object.assign(defaultStyle, otherStyles, rowStyles, colStyles, sectionColStyles);
}
function mapCellStyle(style) {
    const result = {};
    if (style.fontName !== undefined) result.fontName = style.fontName;
    if (style.alignment !== undefined) result.alignment = style.alignment;
    if (style.verticalAlignment !== undefined) result.verticalAlignment = style.verticalAlignment;
    if (style.fontSize !== undefined) result.fontSize = style.fontSize;
    if (style.lineHeight !== undefined) result.lineHeight = style.lineHeight;
    if (style.characterSpacing !== undefined) result.characterSpacing = style.characterSpacing;
    if (style.backgroundColor !== undefined) result.backgroundColor = style.backgroundColor;
    if (style.fontColor !== undefined) result.textColor = style.fontColor;
    if (style.borderColor !== undefined) result.lineColor = style.borderColor;
    if (style.borderWidth !== undefined) result.lineWidth = style.borderWidth;
    if (style.padding !== undefined) result.cellPadding = style.padding;
    if (style.overflow !== undefined) result.overflow = style.overflow;
    return result;
}
function getTableOptions(schema, body) {
    const columnStylesWidth = schema.headWidthPercentages.reduce((acc, cur, i) => ({ ...acc, [i]: { cellWidth: schema.width * (cur / 100) } }), {});
    const columnStylesAlignment = Object.entries(schema.columnStyles.alignment || {}).reduce((acc, [key, value]) => ({ ...acc, [key]: { alignment: value } }), {});
    const allKeys = new Set([
        ...Object.keys(columnStylesWidth).map(Number),
        ...Object.keys(columnStylesAlignment).map(Number),
    ]);
    const columnStyles = Array.from(allKeys).reduce((acc, key) => {
        const widthStyle = columnStylesWidth[key] || {};
        const alignmentStyle = columnStylesAlignment[key] || {};
        return { ...acc, [key]: { ...widthStyle, ...alignmentStyle } };
    }, {});
    const bodyColumnStyles = {};
    const headColumnStyles = {};
    if (schema.bodyColumnStyles) {
        for (const [idx, style] of Object.entries(schema.bodyColumnStyles)) {
            bodyColumnStyles[Number(idx)] = mapCellStyle(style);
        }
    }
    if (schema.headColumnStyles) {
        for (const [idx, style] of Object.entries(schema.headColumnStyles)) {
            headColumnStyles[Number(idx)] = mapCellStyle(style);
        }
    }
    return {
        head: [schema.head],
        body,
        showHead: schema.showHead,
        startY: schema.position.y,
        tableWidth: schema.width,
        tableLineColor: schema.tableStyles?.borderColor ?? '#000000',
        tableLineWidth: schema.tableStyles?.borderWidth ?? 0,
        headStyles: mapCellStyle(schema.headStyles),
        bodyStyles: mapCellStyle(schema.bodyStyles),
        alternateRowStyles: { backgroundColor: schema.bodyStyles.alternateBackgroundColor },
        columnStyles,
        ...(Object.keys(bodyColumnStyles).length > 0 ? { bodyColumnStyles } : {}),
        ...(Object.keys(headColumnStyles).length > 0 ? { headColumnStyles } : {}),
        margin: { top: 0, right: 0, left: schema.position.x, bottom: 0 },
    };
}
function parseStyles(cInput) {
    const styleOptions = {
        styles: {},
        headStyles: {},
        bodyStyles: {},
        alternateRowStyles: {},
        columnStyles: {},
    };
    for (const prop of Object.keys(styleOptions)) {
        if (prop === 'columnStyles') {
            const current = cInput[prop];
            styleOptions.columnStyles = Object.assign({}, current);
        }
        else {
            const allOptions = [cInput];
            const styles = allOptions.map((opts) => opts[prop] || {});
            styleOptions[prop] = Object.assign({}, styles[0], styles[1], styles[2]);
        }
    }
    if (cInput.bodyColumnStyles) {
        styleOptions.bodyColumnStyles = Object.assign({}, cInput.bodyColumnStyles);
    }
    if (cInput.headColumnStyles) {
        styleOptions.headColumnStyles = Object.assign({}, cInput.headColumnStyles);
    }
    return styleOptions;
}
function parseContent4Input(options) {
    const head = options.head || [];
    const body = options.body || [];
    const columns = (head[0] || body[0] || []).map((_, index) => index);
    return { columns, head, body };
}
function parseInput(schema, body) {
    const options = getTableOptions(schema, body);
    const styles = parseStyles(options);
    const settings = {
        startY: options.startY,
        margin: options.margin,
        tableWidth: options.tableWidth,
        showHead: options.showHead,
        tableLineWidth: options.tableLineWidth ?? 0,
        tableLineColor: options.tableLineColor ?? '',
    };
    const content = parseContent4Input(options);
    return { content, styles, settings };
}
function createSingleTable(body, args) {
    const { options, _cache, basePdf } = args;
    if (!(0, common_1.isBlankPdf)(basePdf)) {
        console.warn('[@pdfme/schema/table]' +
            'When specifying a custom PDF for basePdf, ' +
            'you cannot use features such as page breaks or re-layout of other elements.' +
            'To utilize these features, please define basePdf as follows:\n' +
            '{ width: number; height: number; padding: [number, number, number, number]; }');
    }
    const schema = (0, common_1.cloneDeep)(args.schema);
    const { start } = schema.__bodyRange || { start: 0 };
    if (start % 2 === 1) {
        const alternateBackgroundColor = schema.bodyStyles.alternateBackgroundColor;
        schema.bodyStyles.alternateBackgroundColor = schema.bodyStyles.backgroundColor;
        schema.bodyStyles.backgroundColor = alternateBackgroundColor;
    }
    schema.showHead = schema.showHead === false ? false : (!schema.__isSplit || schema.repeatHead === true);
    const input = parseInput(schema, body);
    const font = options.font || (0, common_1.getDefaultFont)();
    const fallbackFontName = (0, common_1.getFallbackFontName)(font);
    const content = parseContent4Table(input, fallbackFontName);
    return classes_js_1.Table.create({
        input,
        content,
        font,
        _cache: _cache,
    });
}
//# sourceMappingURL=tableHelper.js.map