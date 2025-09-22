'use client';

import { useEffect } from 'react';

// 全局主题加载器组件
const GlobalThemeLoader = () => {
  useEffect(() => {
    const loadGlobalTheme = async () => {
      try {
        // 获取全局主题配置
        const response = await fetch('/api/theme');
        const result = await response.json();

        console.log('获取到全站主题配置:', result);

        if (result.success && result.data) {
          const { defaultTheme, customCSS } = result.data;

          console.log('加载全站主题配置:', { defaultTheme, customCSS });

          // 直接应用全站配置
          applyTheme(defaultTheme, customCSS);
          console.log('已应用全站主题:', defaultTheme);
        }
      } catch (error) {
        console.error('加载全站主题配置失败:', error);
        // 失败时使用默认设置
        applyTheme('default', '');
        console.log('加载配置失败，使用默认主题');
      }
    };

    // 应用主题函数
    const applyTheme = (themeId: string, css: string = '') => {
      const html = document.documentElement;

      // 移除所有主题class
      html.removeAttribute('data-theme');

      // 应用新主题
      if (themeId !== 'default') {
        html.setAttribute('data-theme', themeId);
      }

      // 应用自定义CSS
      let customStyleEl = document.getElementById('custom-theme-css');
      if (!customStyleEl) {
        customStyleEl = document.createElement('style');
        customStyleEl.id = 'custom-theme-css';
        document.head.appendChild(customStyleEl);
      }
      customStyleEl.textContent = css;
    };

    // 立即加载，不延迟
    loadGlobalTheme();
  }, []);

  return null; // 这是一个逻辑组件，不渲染任何内容
};

export default GlobalThemeLoader;
