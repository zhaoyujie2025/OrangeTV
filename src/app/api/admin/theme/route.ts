import { NextResponse } from 'next/server';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { AdminConfig } from '@/lib/admin.types';
import { headers, cookies } from 'next/headers';

export async function GET() {
  try {
    // 创建一个模拟的NextRequest对象来使用getAuthInfoFromCookie
    const cookieStore = cookies();
    const authCookie = cookieStore.get('auth');

    if (!authCookie) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    let authData;
    try {
      const decoded = decodeURIComponent(authCookie.value);
      authData = JSON.parse(decoded);
    } catch (error) {
      return NextResponse.json({ error: '认证信息无效' }, { status: 401 });
    }

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
      { error: '获取主题配置失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    // 获取认证信息
    const cookieStore = cookies();
    const authCookie = cookieStore.get('auth');

    if (!authCookie) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    let authData;
    try {
      const decoded = decodeURIComponent(authCookie.value);
      authData = JSON.parse(decoded);
    } catch (error) {
      return NextResponse.json({ error: '认证信息无效' }, { status: 401 });
    }

    // 检查是否为管理员
    if (authData.role !== 'admin' && authData.role !== 'owner') {
      return NextResponse.json({ error: '权限不足，仅管理员可设置全局主题' }, { status: 403 });
    }

    const body = await request.json();
    const { defaultTheme, customCSS, allowUserCustomization } = body;

    // 验证主题名称
    const validThemes = ['default', 'minimal', 'warm', 'fresh'];
    if (!validThemes.includes(defaultTheme)) {
      return NextResponse.json({ error: '无效的主题名称' }, { status: 400 });
    }

    // 获取当前配置
    const currentConfig = await db.getAdminConfig();

    // 如果没有配置，创建一个基础配置
    let baseConfig: AdminConfig;
    if (!currentConfig) {
      baseConfig = {
        ConfigSubscribtion: {
          URL: "",
          AutoUpdate: false,
          LastCheck: "",
        },
        ConfigFile: "",
        SiteConfig: {
          SiteName: "OrangeTV",
          Announcement: "",
          SearchDownstreamMaxPage: 10,
          SiteInterfaceCacheTime: 30,
          DoubanProxyType: "direct",
          DoubanProxy: "",
          DoubanImageProxyType: "direct",
          DoubanImageProxy: "",
          DisableYellowFilter: false,
          FluidSearch: true,
          RequireDeviceCode: false,
        },
        UserConfig: {
          Users: [],
        },
        SourceConfig: [],
        CustomCategories: [],
      };
    } else {
      baseConfig = currentConfig;
    }

    // 更新主题配置
    const updatedConfig: AdminConfig = {
      ...baseConfig,
      ThemeConfig: {
        defaultTheme: defaultTheme as 'default' | 'minimal' | 'warm' | 'fresh',
        customCSS: customCSS || '',
        allowUserCustomization: allowUserCustomization !== false,
      },
    };

    console.log('保存主题配置:', updatedConfig.ThemeConfig);
    await db.saveAdminConfig(updatedConfig);
    console.log('主题配置保存成功');

    return NextResponse.json({
      success: true,
      message: '主题配置已更新',
      data: updatedConfig.ThemeConfig,
    });
  } catch (error) {
    console.error('更新主题配置失败:', error);
    return NextResponse.json(
      { error: '更新主题配置失败', details: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}
