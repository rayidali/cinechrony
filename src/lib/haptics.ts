import { Capacitor } from '@capacitor/core';

/**
 * Tactile feedback — the first piece of the native-feel motion layer.
 *
 * Fire-and-forget. On web / PWA this is a no-op: iOS Safari + the WKWebView
 * ignore `navigator.vibrate`, so real haptics only exist on the native build
 * via `@capacitor/haptics` (UIImpactFeedbackGenerator on iOS). The plugin is
 * loaded with a dynamic import so it never enters the web bundle.
 *
 * Usage: `haptic('selection')` on a tab/segment switch, `haptic('medium')` on
 * a FAB, `haptic('success')` after a save. Never awaited by callers.
 */
export type HapticKind =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'selection'
  | 'success'
  | 'warning'
  | 'error';

export function haptic(kind: HapticKind = 'light'): void {
  if (!Capacitor.isNativePlatform()) return;
  // Dynamic import keeps the plugin out of the web bundle; fully guarded.
  void (async () => {
    try {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
      if (kind === 'selection') {
        await Haptics.selectionChanged();
        return;
      }
      if (kind === 'success' || kind === 'warning' || kind === 'error') {
        const map = {
          success: NotificationType.Success,
          warning: NotificationType.Warning,
          error: NotificationType.Error,
        } as const;
        await Haptics.notification({ type: map[kind] });
        return;
      }
      const styles = {
        light: ImpactStyle.Light,
        medium: ImpactStyle.Medium,
        heavy: ImpactStyle.Heavy,
      } as const;
      await Haptics.impact({ style: styles[kind] ?? ImpactStyle.Light });
    } catch {
      /* plugin unavailable or feedback denied — silently ignore */
    }
  })();
}
