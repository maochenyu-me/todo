import * as React from 'react';
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

/**
 * 吐司（保存成功 / 发布失败 / 网络断了）—— 基于 `sonner`。
 *
 * 两个要点：
 *
 * 1. **配色走 sonner 自己的 CSS 变量，而不是 `className`**。sonner 在运行时把
 *    样式表插到 `<head>` 末尾，同一个选择器（`[data-sonner-toast]`）下它排在
 *    Tailwind 之后，能盖掉工具类；改 `--normal-bg` 这些变量才是稳定的做法。
 *
 * 2. **明暗跟随本站的 `.dark` class**，不用 sonner 的 `theme="system"`：
 *    本站的明暗是三态（跟随系统/明亮/暗黑）存在 `localStorage["todo.theme"]`，
 *    用户选了「明亮」而系统是暗色时，`system` 会把吐司画成黑的。
 *    这里用 MutationObserver 盯 `<html class>`，与站点真正生效的模式保持一致。
 */
type ThemedStyle = React.CSSProperties & Record<`--${string}`, string>;

function useDarkClass(): boolean {
  const [dark, setDark] = React.useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );

  React.useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

function Toaster(props: ToasterProps) {
  const dark = useDarkClass();

  return (
    <SonnerToaster
      theme={dark ? 'dark' : 'light'}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--card)',
          '--normal-text': 'var(--card-foreground)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--card)',
          '--success-text': 'var(--done)',
          '--success-border': 'var(--done)',
          '--error-bg': 'var(--card)',
          '--error-text': 'var(--seal)',
          '--error-border': 'var(--seal)',
          '--border-radius': 'var(--radius)',
        } as ThemedStyle
      }
      toastOptions={{
        classNames: {
          toast: 'font-sans text-[0.875rem]',
          description: 'text-muted-foreground',
          actionButton: '!bg-primary !text-primary-foreground',
          cancelButton: '!bg-muted !text-foreground',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
