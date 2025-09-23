import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    console.log('API /theme: 开始获取主题配置...');
    const config = await db.getAdminConfig();

    console.log('API /theme: 获取到的管理员配置:', {
      hasConfig: !!config,
      hasThemeConfig: !!(config?.ThemeConfig),
      themeConfig: config?.ThemeConfig
    });

    const themeConfig = config?.ThemeConfig || {
      defaultTheme: 'default' as const,
      customCSS: '',
      allowUserCustomization: true,
    };

    console.log('API /theme: 最终返回的主题配置:', themeConfig);

    return NextResponse.json({
      success: true,
      data: themeConfig,
    });
  } catch (error) {
    console.error('API /theme: 获取主题配置失败，返回默认配置:', error);

    const defaultThemeConfig = {
      defaultTheme: 'default' as const,
      customCSS: '',
      allowUserCustomization: true,
    };

    return NextResponse.json(
      {
        success: true, // 改为 success: true，因为我们提供了有效的默认配置
        data: defaultThemeConfig,
        fallback: true, // 标记这是备用配置
        error: error instanceof Error ? error.message : '未知错误'
      },
      { status: 200 }
    );
  }
}
