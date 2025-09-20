// 全局主题Hook - 用于在任何组件中初始化和使用主题
import { useEffect } from 'react';

export const useThemeInit = () => {
  useEffect(() => {
    // 确保在客户端环境中执行
    if (typeof window === 'undefined') return;

    try {
      // 从localStorage获取保存的主题
      const savedTheme = localStorage.getItem('app-theme') || 'default';
      const savedCustomCSS = localStorage.getItem('app-custom-css') || '';

      // 立即应用主题到HTML元素
      const html = document.documentElement;

      // 移除所有主题属性
      html.removeAttribute('data-theme');

      // 应用保存的主题
      if (savedTheme !== 'default') {
        html.setAttribute('data-theme', savedTheme);
      }

      // 应用自定义CSS
      if (savedCustomCSS) {
        let customStyleEl = document.getElementById('custom-theme-css');
        if (!customStyleEl) {
          customStyleEl = document.createElement('style');
          customStyleEl.id = 'custom-theme-css';
          document.head.appendChild(customStyleEl);
        }
        customStyleEl.textContent = savedCustomCSS;
      }

      console.log(`主题已初始化: ${savedTheme}`);
    } catch (error) {
      console.error('主题初始化失败:', error);
    }
  }, []);
};

export const useTheme = () => {
  const applyTheme = (themeId: string, css: string = '') => {
    if (typeof window === 'undefined') return;

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

    // 保存到localStorage
    localStorage.setItem('app-theme', themeId);
    localStorage.setItem('app-custom-css', css);
  };

  const getCurrentTheme = () => {
    if (typeof window === 'undefined') return 'default';
    return localStorage.getItem('app-theme') || 'default';
  };

  const getCurrentCustomCSS = () => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('app-custom-css') || '';
  };

  return {
    applyTheme,
    getCurrentTheme,
    getCurrentCustomCSS
  };
};


