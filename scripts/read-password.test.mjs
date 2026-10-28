import { Readable } from 'node:stream';

import { describe, expect, test } from 'vitest';

import { firstLineOf, readPasswordFromStream } from './read-password.mjs';

/**
 * 把任意字节数组包成可读流，并且**按给定切点强制分块**。
 *
 * 这里刻意用 `Readable.from([...])` 传 `Buffer`：真实管道（`'pw' | npm run gen-password`）
 * 交给脚本的就是 `Buffer` 块，切点由内核决定 —— 很可能正好切在一个汉字的 3 个字节中间。
 */
function rawStream(bytes) {
  return Readable.from([Buffer.from(bytes)]);
}

/** 按 `splits` 里的下标把字节数组切片，模拟"内核把一次写入拆成好几块"。 */
function splitStream(bytes, splits) {
  const buf = Buffer.from(bytes);
  const chunks = [];
  let prev = 0;
  for (const at of [...splits, buf.length]) {
    chunks.push(buf.subarray(prev, at));
    prev = at;
  }
  return Readable.from(chunks);
}

describe('readPasswordFromStream：多字节密码不许被切坏', () => {
  test('汉字跨 chunk 边界时仍是原字符，不产生 U+FFFD', async () => {
    // '密' = E5 AF 86。在第 1 个字节之后切开 → 前半块是残缺序列。
    const bytes = Buffer.from('密码测试-abc123\n', 'utf8');
    const password = await readPasswordFromStream(splitStream(bytes, [1]));

    expect(password).toBe('密码测试-abc123');
    expect(password).not.toContain('\uFFFD');
  });

  test('每个汉字都被切开（逐字节分块）也能还原', async () => {
    const text = '密码测试-abc123';
    const bytes = Buffer.from(`${text}\n`, 'utf8');
    const everyByte = Array.from({ length: bytes.length - 1 }, (_, i) => i + 1);
    const password = await readPasswordFromStream(splitStream(bytes, everyByte));

    expect(password).toBe(text);
    expect(password).not.toContain('\uFFFD');
  });

  test('emoji（4 字节序列）跨边界也不被切坏', async () => {
    const text = '🚀🚀 rocket-pass';
    const bytes = Buffer.from(`${text}\n`, 'utf8');
    const password = await readPasswordFromStream(splitStream(bytes, [2, 5]));

    expect(password).toBe(text);
    expect(password).not.toContain('\uFFFD');
  });

  test('朴素写法 `raw += chunk` 在这种切分下确实会坏（守住这个回归点）', async () => {
    // 对照组：证明上面的测试不是形同虚设。若实现退回逐块 toString()，等价代码会得到坏值。
    const bytes = Buffer.from('密码测试\n', 'utf8');
    const naive = (chunks) => chunks.map((c) => c.toString()).join('');
    const chunks = [bytes.subarray(0, 1), bytes.subarray(1)];
    expect(naive(chunks)).toContain('\uFFFD');

    const fixed = await readPasswordFromStream(Readable.from(chunks));
    expect(fixed).toBe('密码测试');
  });
});

describe('readPasswordFromStream / firstLineOf：行尾处理', () => {
  test('只取第一行（换行之后的内容被丢弃）', async () => {
    await expect(readPasswordFromStream(rawStream('secret-1\nignored'))).resolves.toBe('secret-1');
  });

  test('CRLF 行尾被完全切掉，不残留 CR', async () => {
    const password = await readPasswordFromStream(rawStream('secret-1\r\n'));
    expect(password).toBe('secret-1');
    expect(password).not.toContain('\r');
  });

  test('裸 CR 行尾也被切掉（只 split(/\\r?\\n/) 会留下一个 CR）', async () => {
    const password = await readPasswordFromStream(rawStream('secret-1\r'));
    expect(password).toBe('secret-1');
    expect(password).not.toContain('\r');
  });

  test('没有行尾时原样返回', async () => {
    await expect(readPasswordFromStream(rawStream('secret-1'))).resolves.toBe('secret-1');
  });

  test('不做 trim：首尾空格是密码的一部分', async () => {
    await expect(readPasswordFromStream(rawStream('  secret-1  \n'))).resolves.toBe('  secret-1  ');
  });

  test('空输入得到空串（长度规则由 gen-password 负责，不在解码层）', async () => {
    await expect(readPasswordFromStream(rawStream(''))).resolves.toBe('');
    await expect(readPasswordFromStream(rawStream('\n'))).resolves.toBe('');
  });

  test('字符串块（已设 encoding 的流）同样能读', async () => {
    await expect(readPasswordFromStream(Readable.from(['密码测试\n']))).resolves.toBe('密码测试');
  });

  test('firstLineOf 单独覆盖三种行尾', () => {
    expect(firstLineOf('a\nb')).toBe('a');
    expect(firstLineOf('a\r\nb')).toBe('a');
    expect(firstLineOf('a\rb')).toBe('a');
    expect(firstLineOf('a')).toBe('a');
    expect(firstLineOf('')).toBe('');
  });
});
