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
          const { defaultTheme, customCSS, allowUserCustomization } = result.data;

          // 检查用户是否有自定义设置
          const userTheme = localStorage.getItem('app-theme');
          const userCustomCSS = localStorage.getItem('app-custom-css') || '';

          console.log('当前用户设置:', { userTheme, userCustomCSS });
          console.log('全站配置:', { defaultTheme, customCSS, allowUserCustomization });

          // 如果不允许用户自定义，强制应用全局配置
          if (!allowUserCustomization) {
            localStorage.setItem('app-theme', defaultTheme);
            localStorage.setItem('app-custom-css', customCSS);
            applyTheme(defaultTheme, customCSS);
            console.log('强制应用全站配置:', defaultTheme);
            return;
          }

          // 智能决定使用哪个主题
          let finalTheme = defaultTheme;
          let finalCSS = customCSS;

          // 检查是否需要强制应用全站主题
          // 如果localStorage中存储的主题与全站默认不同，说明可能是过期的设置，需要更新
          const shouldForceGlobalTheme = !userTheme || userTheme !== defaultTheme;

          if (shouldForceGlobalTheme) {
            // 强制应用全站默认配置
            finalTheme = defaultTheme;
            finalCSS = customCSS;
            localStorage.setItem('app-theme', defaultTheme);
            if (customCSS) {
              localStorage.setItem('app-custom-css', customCSS);
            } else {
              localStorage.removeItem('app-custom-css');
            }
            console.log('强制应用全站默认主题:', defaultTheme, '(替换过期设置:', userTheme, ')');
          } else {
            // 用户设置与全站默认一致，使用现有设置
            finalTheme = userTheme;
            finalCSS = userCustomCSS || customCSS;
            console.log('保持一致的主题设置:', userTheme);
          }

          // 应用最终主题
          applyTheme(finalTheme, finalCSS);
        }
      } catch (error) {
        console.error('加载全局主题配置失败:', error);
        // 失败时使用本地设置或默认设置
        const savedTheme = localStorage.getItem('app-theme') || 'default';
        const savedCustomCSS = localStorage.getItem('app-custom-css') || '';
        applyTheme(savedTheme, savedCustomCSS);
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
      let customStyleEl = document.getElementById('global-theme-css');
      if (!customStyleEl) {
        customStyleEl = document.createElement('style');
        customStyleEl.id = 'global-theme-css';
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
