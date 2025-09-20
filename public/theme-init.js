// 主题初始化脚本 - 立即执行，避免主题闪烁
(function () {
  try {
    // 应用主题函数
    function applyTheme(themeId, css) {
      const html = document.documentElement;

      // 移除所有主题属性
      html.removeAttribute('data-theme');

      // 应用主题
      if (themeId !== 'default') {
        html.setAttribute('data-theme', themeId);
      }

      // 应用自定义CSS
      if (css) {
        let customStyleEl = document.getElementById('init-theme-css');
        if (!customStyleEl) {
          customStyleEl = document.createElement('style');
          customStyleEl.id = 'init-theme-css';
          document.head.appendChild(customStyleEl);
        }
        customStyleEl.textContent = css;
      }
    }

    // 从localStorage获取保存的主题
    const savedTheme = localStorage.getItem('app-theme');
    const savedCustomCSS = localStorage.getItem('app-custom-css') || '';

    // 立即应用已保存的主题（如果有）
    if (savedTheme) {
      applyTheme(savedTheme, savedCustomCSS);
      console.log('主题已初始化(本地设置):', savedTheme);
    } else {
      // 没有用户设置时，先应用默认主题
      applyTheme('default', '');
      console.log('主题已初始化(默认)');
    }

    // 注意：GlobalThemeLoader会在React组件挂载后进一步处理全站配置
  } catch (error) {
    console.error('主题初始化失败:', error);
  }
})();


