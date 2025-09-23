'use client';

import { useEffect } from 'react';

// 全局主题加载器组件 - 确保主题配置始终正确，优先信任服务端配置
const GlobalThemeLoader = () => {
  useEffect(() => {
    const validateAndSyncTheme = async () => {
      try {
        // 检查服务端预设的配置
        const runtimeConfig = (window as any).RUNTIME_CONFIG;
        const serverThemeConfig = runtimeConfig?.THEME_CONFIG;

        console.log('检查服务端预设主题配置:', serverThemeConfig);

        if (serverThemeConfig && serverThemeConfig.defaultTheme !== 'default') {
          // 服务端有非默认配置，优先使用服务端配置
          console.log('使用服务端主题配置，跳过API检查:', serverThemeConfig);

          // 确保服务端配置已正确应用到DOM
          const html = document.documentElement;
          const currentTheme = html.getAttribute('data-theme');

          if (currentTheme !== serverThemeConfig.defaultTheme) {
            console.log('DOM主题与服务端配置不一致，重新应用:', {
              current: currentTheme,
              expected: serverThemeConfig.defaultTheme
            });
            applyTheme(serverThemeConfig.defaultTheme, serverThemeConfig.customCSS || '');
          } else {
            console.log('服务端主题配置已正确应用，无需更新');
          }
          return;
        }

        // 只有当服务端配置为默认值时，才从API获取配置
        console.log('服务端为默认配置，从API获取最新配置...');
        const response = await fetch('/api/theme');
        const result = await response.json();

        if (result.success && result.data) {
          const { defaultTheme, customCSS } = result.data;
          const isFallback = result.fallback;

          console.log('从API获取到主题配置:', {
            defaultTheme,
            customCSS,
            isFallback: !!isFallback,
            error: result.error
          });

          if (isFallback) {
            console.log('API返回备用配置，保持服务端设置不变');
            return;
          }

          // 只有API返回非默认配置且非备用配置时才应用
          if (defaultTheme !== 'default' || customCSS) {
            console.log('应用API获取的有效主题配置:', { defaultTheme, customCSS });
            applyTheme(defaultTheme, customCSS);

            // 更新运行时配置
            if (runtimeConfig) {
              runtimeConfig.THEME_CONFIG = { defaultTheme, customCSS, allowUserCustomization: true };
            }
          } else {
            console.log('API返回默认配置，保持当前状态');
          }
        } else {
          console.log('API获取失败，保持当前主题配置');
        }
      } catch (error) {
        console.error('主题配置验证失败:', error);

        // 出错时优先使用服务端配置
        const runtimeConfig = (window as any).RUNTIME_CONFIG;
        const serverThemeConfig = runtimeConfig?.THEME_CONFIG;

        if (serverThemeConfig) {
          console.log('错误恢复：使用服务端配置:', serverThemeConfig);
          applyTheme(serverThemeConfig.defaultTheme, serverThemeConfig.customCSS || '');
        } else {
          console.log('错误恢复：使用默认主题');
          applyTheme('default', '');
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

    // 稍作延迟，确保DOM完全加载后再验证主题
    const timer = setTimeout(() => {
      validateAndSyncTheme();
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return null; // 这是一个逻辑组件，不渲染任何内容
};

export default GlobalThemeLoader;
