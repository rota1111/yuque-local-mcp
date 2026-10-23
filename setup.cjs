'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { Writable } = require('node:stream');

function normalize(origin, value) {
  const url = new URL(origin || 'https://www.yuque.com');
  if (url.protocol !== 'https:' || !(url.hostname === 'yuque.com' || url.hostname.endsWith('.yuque.com')) || url.username || url.password || url.port) throw new Error('必须是 HTTPS 语雀站点');
  let cookie = value.trim().replace(/^cookie:\s*/i, '');
  if (cookie && !cookie.includes('_yuque_session=') && !cookie.includes(';')) cookie = '_yuque_session=' + cookie;
  if (!cookie.includes('_yuque_session=') || /[\r\n]/.test(cookie)) throw new Error('缺少 _yuque_session 或格式无效');
  return { origin: url.origin, cookie };
}
function save(credentials) {
  const root = path.resolve(process.env.YUQUE_DATA_DIR || path.join(__dirname, 'private'));
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
  const file = path.join(root, 'credentials.json');
  const fd = fs.openSync(file, 'w', 0o600);
  try {
    if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify(credentials));
  } finally { fs.closeSync(fd); }
}
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('请在交互式终端中运行 npm run setup');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  const ask = prompt => new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('已取消'));
    rl.once('close', cancel);
    rl.question(prompt, answer => { rl.removeListener('close', cancel); resolve(answer); });
  });
  rl.on('SIGINT', () => rl.close());
  try {
    console.log('在浏览器开发者工具 Application → Cookies 中复制 _yuque_session 的 Value。不要在聊天发送凭证。');
    const origin = (await ask('语雀站点 [https://www.yuque.com]: ')).trim();
    process.stdout.write('_yuque_session 的值或完整 Cookie（隐藏输入）: ');
    muted = true;
    const value = await ask('');
    muted = false;
    process.stdout.write('\n');
    save(normalize(origin, value));
    console.log('已保存在本机。服务无需重启即可读取新凭证。');
  } finally { muted = false; rl.close(); }
}
if (require.main === module) main().catch(error => { console.error('未完成配置：' + error.message); process.exitCode = 1; });
module.exports = { normalize, save };
