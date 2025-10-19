// 全局主题Hook - 已弃用，主题现在由 GlobalThemeLoader 统一管理
// 保留此文件是为了向后兼容性，但不再使用

export const useThemeInit = () => {
  // 不再执行任何操作，主题由 GlobalThemeLoader 处理
  console.warn('useThemeInit is deprecated. Theme is now managed by GlobalThemeLoader.');
};

export const useTheme = () => {
  // 已弃用：主题现在由 GlobalThemeLoader 和 ThemeManager 统一管理
  console.warn('useTheme is deprecated. Use ThemeManager component for theme management.');

  return {
    applyTheme: () => console.warn('applyTheme is deprecated'),
    getCurrentTheme: () => 'default',
    getCurrentCustomCSS: () => ''
  };
};


