/**
 * 环境变量的类型声明。
 *
 * Astro 只会把 `PUBLIC_` 前缀的变量打进客户端 bundle，且 `import.meta.env` 在
 * `astro/client` 里**没有**索引签名——所以每用一个 `PUBLIC_*` 变量都必须在这里声明一次，
 * 否则 `astro check` 会在 `.tsx` 里报 "Property does not exist on type 'ImportMetaEnv'"。
 *
 * `PUBLIC_ADMIN_PASSWORD_KDF` 只是 PBKDF2 派生值（`pbkdf2$<iterations>$<b64salt>$<b64hash>`），
 * 明文密码从不落盘。它缺席是合法状态（首次部署还没配），UI 必须给出可执行的配置指引，
 * 所以这里声明为 `string | undefined` 而不是 `string`。
 * 详见 `src/lib/auth.ts` 文件头的安全模型。
 */
interface ImportMetaEnv {
  readonly PUBLIC_ADMIN_PASSWORD_KDF?: string;
}
