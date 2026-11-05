#!/usr/bin/env node
/**
 * 把小程序的 WXSS 转换成浏览器可用的 CSS，用于 preview/index.html 静态预览。
 *
 *   - rpx → px：按 375pt 基准，1rpx = 0.5px
 *   - 每个页面的 wxss 加 .pg-<page> 前缀，避免不同页面的同名 class 互相覆盖
 *   - app.wxss 中的 page 选择器替换为 .phone-body
 *
 * 用法： node shared/build-preview.js
 * 说明： 仅用于可视化预览，样式改动后需重新运行；不要用它替代真机调试。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const OUT = path.join(ROOT, 'preview', 'styles.css');

const PAGES = ['index', 'find', 'detail', 'orders', 'host', 'property', 'profile'];

function rpx2px(css) {
  return css.replace(/(-?\d*\.?\d+)rpx/g, (m, n) => (parseFloat(n) / 2) + 'px');
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 给每条规则的选择器加前缀（页面样式表中没有 @media / @keyframes） */
function scope(css, prefix) {
  let out = '';
  let i = 0;
  const s = stripComments(css);
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open === -1) { out += s.slice(i); break; }

    const sel = s.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < s.length && depth > 0) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') depth--;
      j++;
    }
    const body = s.slice(open + 1, j - 1);

    if (sel && !sel.startsWith('@')) {
      const scoped = sel.split(',').map(x => x.trim()).filter(Boolean)
        .map(x => prefix + ' ' + x).join(', ');
      out += scoped + ' {' + body + '}\n';
    } else if (sel) {
      out += sel + ' {' + body + '}\n';
    }
    i = j;
  }
  return out;
}

let css = '/* ===== 全局（app.wxss）===== */\n';
let app = rpx2px(stripComments(fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8')));
app = app.replace(/(^|\n)\s*page\s*\{/g, '$1.phone-body {');
css += app + '\n';

PAGES.forEach(p => {
  const f = path.join(MP, 'pages', p, p + '.wxss');
  if (!fs.existsSync(f)) return;
  const raw = rpx2px(stripComments(fs.readFileSync(f, 'utf8')));
  css += '\n/* ===== page: ' + p + ' ===== */\n' + scope(raw, '.pg-' + p);
});

if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, css);
console.log('生成 preview/styles.css，共 ' + css.split('\n').length + ' 行');
