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
        let customStyleEl = document.getElementById('custom-theme-css');
        if (!customStyleEl) {
          customStyleEl = document.createElement('style');
          customStyleEl.id = 'custom-theme-css';
          document.head.appendChild(customStyleEl);
        }
        customStyleEl.textContent = css;
      }
    }

    // 应用默认主题避免闪烁，等待GlobalThemeLoader加载全站配置
    applyTheme('default', '');
    console.log('主题初始化完成，等待加载全站配置');

    // 注意：GlobalThemeLoader会在React组件挂载后加载并应用全站主题配置
  } catch (error) {
    console.error('主题初始化失败:', error);
  }
})();


