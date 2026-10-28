import { pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { base64ToBytes, bytesToBase64, constantTimeEqual, parseKdf, verifyPassword } from './auth';

/**
 * 注意：本文件的 PBKDF2 一律用 1000 次迭代，**绝不用生产里的 600000 次**。
 * 600k 轮每算一次要几百毫秒，测试套件会被拖到不可接受。
 * 实现必须从 `stored` 字符串里读 iterations，所以低迭代数同样能验证正确性。
 */
const TEST_ITERATIONS = 1000;

/** 固定 salt，让"生成 → 校验"可复现（真实 salt 由 gen-password 随机产生）。 */
const SALT = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

const PASSWORD = 'correct horse battery staple';

/**
 * 用 Node 原生（OpenSSL）PBKDF2 生成 stored 字符串。
 * 刻意不复用 `auth.ts` 里的任何代码：这样"WebCrypto 派生"和"Node 派生"互为对照，
 * 实现若算错（salt/hash 拼接、base64、DKLen）测试立刻暴露。
 */
function storedFor(password: string, iterations = TEST_ITERATIONS, salt: Uint8Array = SALT): string {
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `pbkdf2$${iterations}$${Buffer.from(salt).toString('base64')}$${hash.toString('base64')}`;
}

const VALID_STORED = storedFor(PASSWORD);

describe('parseKdf：解析 KDF 字符串', () => {
  test('合法字符串解析出 iterations / salt / hash', () => {
    const parsed = parseKdf(VALID_STORED);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.iterations).toBe(TEST_ITERATIONS);
    expect(parsed.salt).toBeInstanceOf(Uint8Array);
    expect(parsed.salt.length).toBe(16);
    expect(Array.from(parsed.salt)).toEqual(Array.from(SALT));
    expect(parsed.hash.length).toBe(32);
    expect(parsed.hash).toEqual(new Uint8Array(pbkdf2Sync(PASSWORD, SALT, TEST_ITERATIONS, 32, 'sha256')));
  });

  test('解析结果里没有算法字段以外的东西（不为未来算法预留半成品）', () => {
    const parsed = parseKdf(VALID_STORED);
    expect(parsed && Object.keys(parsed).sort()).toEqual(['hash', 'iterations', 'salt']);
  });

  test('畸形输入一律返回 null 而不抛异常', () => {
    const malformed = [
      '',
      '   ',
      'not-a-kdf',
      // 段数不对
      'pbkdf2$600000$abc',
      'pbkdf2$600000',
      'pbkdf2$600000$c2FsdA==$aGFzaA==$extra',
      // iterations 不是数字 / 是 0 / 是负数
      'pbkdf2$abc$c2FsdA==$aGFzaA==',
      'pbkdf2$0$c2FsdA==$aGFzaA==',
      'pbkdf2$-1$c2FsdA==$aGFzaA==',
      'pbkdf2$1.5$c2FsdA==$aGFzaA==',
      // salt 或 hash 为空
      'pbkdf2$600000$$aGFzaA==',
      'pbkdf2$600000$c2FsdA==$',
      // 非法 base64
      'pbkdf2$600000$!!!==$aGFzaA==',
      'pbkdf2$600000$c2FsdA$=aGFzaA==',
      'pbkdf2$600000$abc$aGFzaA==',
      // 算法不认识
      'argon2$600000$c2FsdA==$aGFzaA==',
      'PBKDF2$600000$c2FsdA==$aGFzaA==',
    ];
    for (const raw of malformed) {
      expect(parseKdf(raw), `应当拒绝：${raw}`).toBeNull();
    }
  });

  test('容忍首尾空白（粘贴 .env 时常见的尾随换行）', () => {
    expect(parseKdf(`  ${VALID_STORED}\n`)?.iterations).toBe(TEST_ITERATIONS);
  });
});

describe('verifyPassword：正确密码通过', () => {
  test('用固定 salt 生成的 stored，正确密码返回 true', async () => {
    await expect(verifyPassword(PASSWORD, VALID_STORED)).resolves.toBe(true);
  });

  test('空密码也能往返（长度规则只约束 gen-password，不约束校验）', async () => {
    await expect(verifyPassword('', storedFor(''))).resolves.toBe(true);
  });

  test('非 ASCII 密码按 UTF-8 派生后仍能通过', async () => {
    const stored = storedFor('中文密码-héllo-🚀');
    await expect(verifyPassword('中文密码-héllo-🚀', stored)).resolves.toBe(true);
  });

  test('显式注入 SubtleCrypto 时同样工作（测试可替换依赖）', async () => {
    await expect(verifyPassword(PASSWORD, VALID_STORED, globalThis.crypto.subtle)).resolves.toBe(true);
  });
});

describe('verifyPassword：错误密码不通过', () => {
  test('错误密码返回 false', async () => {
    await expect(verifyPassword('wrong password', VALID_STORED)).resolves.toBe(false);
  });

  test('大小写不同也算错', async () => {
    await expect(verifyPassword(PASSWORD.toUpperCase(), VALID_STORED)).resolves.toBe(false);
  });

  test('密码多一个空格也算错（不做 trim 之类的静默修正）', async () => {
    await expect(verifyPassword(` ${PASSWORD}`, VALID_STORED)).resolves.toBe(false);
  });
});

describe('verifyPassword：iterations 来自 stored 而非硬编码', () => {
  test('stored 里是 1000 次迭代时能验证通过（若写死 600000 这里必然为 false）', async () => {
    const stored = storedFor(PASSWORD, 1000);
    expect(stored).toContain('pbkdf2$1000$');
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
  });

  test('改掉 stored 里的迭代数（而 hash 不变）就不通过', async () => {
    const tampered = VALID_STORED.replace('pbkdf2$1000$', 'pbkdf2$2000$');
    await expect(verifyPassword(PASSWORD, tampered)).resolves.toBe(false);
  });

  test('换一个迭代数重新派生后依然自洽', async () => {
    await expect(verifyPassword(PASSWORD, storedFor(PASSWORD, 2000))).resolves.toBe(true);
  });
});

describe('verifyPassword：畸形 stored 返回 false 且不抛异常', () => {
  test('非 KDF 字符串', async () => {
    await expect(verifyPassword('x', 'not-a-kdf')).resolves.toBe(false);
  });

  test('brief 列出的几种畸形输入全部 false，且都不抛异常', async () => {
    const malformed = [
      '',
      'pbkdf2$600000$abc',
      'pbkdf2$abc$salt$hash',
      'pbkdf2$0$salt$hash',
      'argon2$600000$c2FsdA==$aGFzaA==',
    ];
    for (const stored of malformed) {
      await expect(verifyPassword('x', stored), `应当返回 false：${stored}`).resolves.toBe(false);
    }
  });

  test('hash 长度不同的 stored 返回 false（走 constantTimeEqual 的长度分支）', async () => {
    const shortHash = Buffer.from([1, 2, 3]).toString('base64');
    const stored = `pbkdf2$1000$${Buffer.from(SALT).toString('base64')}$${shortHash}`;
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
  });

  test('派生过程抛错时被吞掉并返回 false（注入会抛的 fake subtle）', async () => {
    const exploding = {
      importKey: () => {
        throw new Error('boom');
      },
    } as unknown as SubtleCrypto;
    await expect(verifyPassword(PASSWORD, VALID_STORED, exploding)).resolves.toBe(false);
  });
});

describe('constantTimeEqual', () => {
  test('完全相同的输入返回 true', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  test('长度相同但内容不同返回 false', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([0, 0, 0]), new Uint8Array([0, 0, 1]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([255]), new Uint8Array([0]))).toBe(false);
  });

  test('不等长输入返回 false（例如 brief 里的 [1,2] vs [1,2,3]）', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  test('前导相同、只在最后一位不同的长输入返回 false（不是只看长度）', () => {
    const a = new Uint8Array(32).fill(7);
    const b = new Uint8Array(32).fill(7);
    b[31] = 8;
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  test('空数组之间返回 true，空与非空返回 false', () => {
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array([0]))).toBe(false);
  });
});

describe('base64 helpers：浏览器与 Node 都能用', () => {
  test('与 Node Buffer 的 base64 输出逐字节一致', () => {
    for (const bytes of [new Uint8Array(), new Uint8Array([0]), new Uint8Array([255, 0, 128]), SALT]) {
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  test('编码后再解码回到原字节（覆盖 0/1/2/3 补齐位）', () => {
    for (let len = 0; len <= 7; len++) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) % 256);
      expect(base64ToBytes(bytesToBase64(bytes)), `长度 ${len}`).toEqual(bytes);
    }
  });

  test('大数组（20000 字节）也能正确编解码', () => {
    // 朴素写法 btoa(String.fromCharCode(...bytes)) 会在这种长度上爆栈，这里守住它。
    const big = Uint8Array.from({ length: 20000 }, (_, i) => (i * 7) % 256);
    const encoded = bytesToBase64(big);
    expect(encoded).toBe(Buffer.from(big).toString('base64'));
    expect(base64ToBytes(encoded)).toEqual(big);
  });

  test('非法 base64 返回 null 而不是抛异常', () => {
    for (const bad of ['!!!', 'abc', 'a', 'a$b', '====']) {
      expect(base64ToBytes(bad), `应当拒绝：${bad}`).toBeNull();
    }
  });
});

/**
 * 守卫：`auth.ts` 会被打进浏览器 bundle（后台登录框要校验密码），
 * 一旦引入任何 `node:*` 模块，客户端构建就会失败。
 * 与 `entry-codec.test.ts` 里的同款守卫保持一致。
 */
describe('守卫：auth 不含 node 依赖', () => {
  test('auth.ts 不含 node: 导入，也不引用 Buffer', () => {
    const src = readFileSync('src/lib/auth.ts', 'utf8');
    expect(src).not.toMatch(/from ['"]node:/);
    expect(src).not.toMatch(/require\(['"]node:/);
    expect(src).not.toMatch(/\bBuffer\b/);
  });
});
