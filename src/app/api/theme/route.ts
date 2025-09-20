import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const config = await db.getAdminConfig();
    const themeConfig = config?.ThemeConfig || {
      defaultTheme: 'default' as const,
      customCSS: '',
      allowUserCustomization: true,
    };

    return NextResponse.json({
      success: true,
      data: themeConfig,
    });
  } catch (error) {
    console.error('获取主题配置失败:', error);
    return NextResponse.json(
      {
        success: false,
        data: {
          defaultTheme: 'default' as const,
          customCSS: '',
          allowUserCustomization: true,
        }
      },
      { status: 200 } // 返回默认配置而不是错误
    );
  }
}
