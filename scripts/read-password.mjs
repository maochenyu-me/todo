/**
 * 从 stdin 读"第一行密码"的**解码逻辑**（纯 Node，可单测，不参与浏览器 bundle）。
 *
 * 为什么单独成文件：`gen-password.mjs` 一被 import 就会执行 CLI（顶层 `await main()`），
 * 想给它写测试就必须把解码这段拎出来。这里只做"字节流 → 第一行字符串"，
 * 碰终端/readline 的事情留在 `gen-password.mjs`。
 *
 * ## 为什么不能 `raw += chunk`
 *
 * 管道里 chunk 是 `Buffer`，`raw += chunk` 等于对**每块各自**调用 `toString()`。
 * 一个汉字在 UTF-8 里占 3 字节，只要它跨了 chunk 边界（4KB 管道缓冲很容易切在中间），
 * 前半块解出 `U+FFFD`、后半块又是 `U+FFFD`，拼出来的密码就已经不是用户输入的那个了。
 * 更糟的是它**不报错**：脚本照样算出一个派生值，用户粘进 `.env` 后永远是"密码错误"。
 * 静默生成错密钥比直接崩溃坏得多。
 *
 * 所以这里用 `StringDecoder`：它会把不完整的字节序列**留到下一块**再解，
 * 保证最终的字符串与原始字节严格对应。
 */

import { StringDecoder } from 'node:string_decoder';

/**
 * 取第一行。三种行尾都切掉：`\r\n`（Windows）、`\n`（Unix）、`\r`（老式 Mac）。
 * 只 `split(/\r?\n/)` 会把纯 `\r` 行尾留在密码末尾——多一个不可见字符，
 * 派生的值就和用户以为的不一样了。
 */
export function firstLineOf(text) {
  return text.split(/\r\n|\r|\n/)[0] ?? '';
}

/**
 * 读完整个可读流，返回第一行（不做 trim：空格是密码的一部分）。
 *
 * `chunk` 可能是 `Buffer`（未设 encoding 的管道）或 `string`（已设 encoding）——两种都接。
 */
export async function readPasswordFromStream(stream) {
  const decoder = new StringDecoder('utf8');
  let raw = '';
  for await (const chunk of stream) {
    raw += typeof chunk === 'string' ? chunk : decoder.write(chunk);
  }
  // 收尾：把解码器里可能剩下的半截序列冲出来（正常收尾时通常是空串）。
  raw += decoder.end();
  return firstLineOf(raw);
}
