#!/usr/bin/env node
/**
 * 把 shared/cloudfn-common.js 同步到每个云函数目录下的 common.js
 * 云函数部署时只上传自身目录，无法 require 目录外文件，故做一份拷贝。
 *
 * 用法：node shared/sync-cloudfn.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(__dirname, 'cloudfn-common.js');
const fnRoot = path.join(root, 'cloudfunctions');

if (!fs.existsSync(src)) {
  console.error('找不到 shared/cloudfn-common.js');
  process.exit(1);
}

const fns = fs.readdirSync(fnRoot).filter(function (d) {
  const p = path.join(fnRoot, d);
  return fs.statSync(p).isDirectory();
});

fns.forEach(function (fn) {
  const dst = path.join(fnRoot, fn, 'common.js');
  fs.copyFileSync(src, dst);
  console.log('  ✓ cloudfunctions/' + fn + '/common.js');
});

console.log('完成，已同步 ' + fns.length + ' 个云函数。');
