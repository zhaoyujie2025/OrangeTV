'use client';

import { useEffect } from 'react';

// 全局主题加载器组件 - 作为服务端主题配置的同步和备份机制
const GlobalThemeLoader = () => {
  useEffect(() => {
    const syncGlobalTheme = async () => {
      try {
        // 检查是否已有服务端预设的主题配置
        const runtimeConfig = (window as any).RUNTIME_CONFIG;
        const serverThemeConfig = runtimeConfig?.THEME_CONFIG;

        console.log('检查服务端主题配置:', serverThemeConfig);

        if (serverThemeConfig) {
          // 服务端已经应用了主题配置，检查是否需要同步更新
          console.log('服务端主题配置已存在，无需重新加载');
          return;
        }

        // 如果没有服务端配置，则从API获取（备用方案）
        console.log('未检测到服务端主题配置，尝试从API加载...');
        const response = await fetch('/api/theme');
        const result = await response.json();

        if (result.success && result.data) {
          const { defaultTheme, customCSS } = result.data;
          console.log('从API获取到主题配置:', { defaultTheme, customCSS });

          // 应用从API获取的配置
          applyTheme(defaultTheme, customCSS);
          console.log('已应用API主题配置:', defaultTheme);
        }
      } catch (error) {
        console.error('同步全站主题配置失败:', error);
        // 失败时检查当前HTML状态，如果没有主题则应用默认
        const html = document.documentElement;
        if (!html.hasAttribute('data-theme')) {
          applyTheme('default', '');
          console.log('应用默认主题作为备用');
        }
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

    // 稍作延迟，确保DOM完全加载后再同步
    const timer = setTimeout(() => {
      syncGlobalTheme();
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return null; // 这是一个逻辑组件，不渲染任何内容
};

export default GlobalThemeLoader;
