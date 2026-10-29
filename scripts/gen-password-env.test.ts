import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnv } from 'vite';
import { describe, expect, test } from 'vitest';

import { parseKdf } from '../src/lib/auth';

/**
 * 守卫：`.env` 里 `PUBLIC_ADMIN_PASSWORD_KDF` 的 `$` 必须写成 `\$`。
 *
 * ## 为什么值得一个测试
 *
 * `npm run gen-password` 产出 `pbkdf2$600000$<salt>$<hash>`。如果照原样粘进 `.env`，
 * Vite/Astro 加载 `.env` 时的 **dotenv 变量展开**会把 `$600000`、`$<salt>`、`$<hash>`
 * 当成变量名展开成空串——派生值被吃掉，口令永远校验不过，而界面上看不出任何原因。
 * 这个坑在 Task 14 的浏览器验证里真的踩到了（见 task-14-report.md），
 * 症状是「明明配了，却永远说口令不对」。
 *
 * 所以这里把三件事钉死：
 * 1. `.env.example` 教学用的占位符必须是转义形式（否则它就是那个错误示范）；
 * 2. `\$` 经 Vite 的 `loadEnv()` 后会被还原成 `$`（浏览器拿到的是正常值）；
 * 3. 不转义确实会被吃坏 —— 这是对第三方行为的**特征测试**：
 *    哪天 Vite 改了展开规则，这条会先失败，提醒我们重新验证整条链路。
 *
 * 测试用临时目录，不碰仓库自己的 `.env`。
 */

const ENV_VAR = 'PUBLIC_ADMIN_PASSWORD_KDF';

/** 用一个临时目录装 `.env`，跑 Vite 真正的加载器。 */
function loadFrom(content: string): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), 'todo-env-'));
  try {
    writeFileSync(join(dir, '.env'), content, 'utf8');
    return loadEnv('production', dir, 'PUBLIC_')[ENV_VAR];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 与 `.env` 里应出现的写法一致：真实四段值，`$` 已转义。 */
const STORED = 'pbkdf2$600000$BwcHBwcHBwcHBwcHBwcHBw==$CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=';
const ESCAPED = STORED.replace(/\$/g, '\\$');

describe('`.env` 里的口令派生值', () => {
  test('.env.example 的占位符用转义写法（不能是错误示范）', () => {
    const example = readFileSync(join(import.meta.dirname, '..', '.env.example'), 'utf8');
    const line = example
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${ENV_VAR}=`) && !l.trimStart().startsWith('#'));
    expect(line).toBeDefined();
    const value = line!.slice(ENV_VAR.length + 1).trim();
    // 四段之间全是 `\$`
    expect(value.startsWith('pbkdf2\\$600000\\$')).toBe(true);
    // 不能出现"裸"的 `$`（后面紧跟非转义字符）
    expect(value).not.toMatch(/(?<!\\)\$(?!\\)/);
  });

  test('转义后的值经 loadEnv 原样还原（浏览器拿到正常的 $）', () => {
    expect(loadFrom(`${ENV_VAR}=${ESCAPED}\n`)).toBe(STORED);
    // 还原出来的值必须是合法派生值，否则锁屏会显示「配置的值不完整」
    expect(parseKdf(STORED)).not.toBeNull();
  });

  test('不转义会被 dotenv 吃坏 —— 这正是「口令永远不对」的根因', () => {
    const collapsed = loadFrom(`${ENV_VAR}=${STORED}\n`);
    expect(collapsed).not.toBe(STORED);
    // 被吃坏的形态解析不出四段 → 锁屏据此显示「配置的值不完整」，而不是「口令不正确」。
    expect(parseKdf(collapsed ?? '')).toBeNull();
  });

  test('被吃坏的典型形态（塌成 pbkdf2）确实解析失败', () => {
    expect(parseKdf('pbkdf2')).toBeNull();
  });
});
