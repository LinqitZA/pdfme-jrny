"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeSVG = void 0;
const tslib_1 = require("tslib");
const dompurify_1 = tslib_1.__importDefault(require("dompurify"));
const sanitizeSVG = (svgString) => {
    return dompurify_1.default.sanitize(svgString, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: [
            'script',
            'foreignObject',
            'use',
            'embed',
            'iframe',
            'object',
            'link',
            'style',
            'animate',
            'animateMotion',
            'animateTransform',
            'set',
        ],
        FORBID_ATTR: [
            'onload',
            'onerror',
            'onclick',
            'onmouseover',
            'onmouseout',
            'onmousedown',
            'onmouseup',
            'onfocus',
            'onblur',
            'onchange',
            'onsubmit',
            'onreset',
            'onselect',
            'onabort',
            'oninput',
            'onkeydown',
            'onkeypress',
            'onkeyup',
            'onbegin',
            'onend',
            'onrepeat',
            'href',
            'xlink:href',
            'src',
            'action',
            'formaction',
        ],
        KEEP_CONTENT: false,
    });
};
exports.sanitizeSVG = sanitizeSVG;
//# sourceMappingURL=sanitize.js.map