import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 获取弹幕
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    if (!videoId) {
      return NextResponse.json({ error: '视频ID不能为空' }, { status: 400 });
    }

    const danmuList = await db.getDanmu(videoId);

    // 转换为artplayer-plugin-danmuku所需的格式
    const formattedDanmu = danmuList.map((item) => ({
      text: item.text,
      color: item.color,
      mode: item.mode,
      time: item.time,
      border: false,
      size: 25
    }));

    return NextResponse.json(formattedDanmu);
  } catch (error) {
    console.error('获取弹幕失败:', error);
    return NextResponse.json({ error: '获取弹幕失败' }, { status: 500 });
  }
}

// 发送弹幕
export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { videoId, text, color, mode, time } = body;

    if (!videoId || !text) {
      return NextResponse.json({ error: '视频ID和弹幕内容不能为空' }, { status: 400 });
    }

    // 验证弹幕内容长度
    if (text.length > 100) {
      return NextResponse.json({ error: '弹幕内容不能超过100个字符' }, { status: 400 });
    }

    // 过滤敏感内容（可以扩展）
    const sensitiveWords = ['垃圾', '傻逼', '草泥马', '操你妈']; // 示例敏感词
    const hasSensitiveWord = sensitiveWords.some(word => text.includes(word));
    if (hasSensitiveWord) {
      return NextResponse.json({ error: '弹幕内容包含敏感词汇' }, { status: 400 });
    }

    const danmuData = {
      text: text.trim(),
      color: color || '#FFFFFF',
      mode: mode || 0,
      time: time || 0,
      timestamp: Date.now()
    };

    await db.saveDanmu(videoId, authInfo.username, danmuData);

    return NextResponse.json({ success: true, message: '弹幕发送成功' });
  } catch (error) {
    console.error('发送弹幕失败:', error);
    return NextResponse.json({ error: '发送弹幕失败' }, { status: 500 });
  }
}

// 删除弹幕（管理员功能）
export async function DELETE(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 只有管理员和站长可以删除弹幕
    if (authInfo.role !== 'admin' && authInfo.role !== 'owner') {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');
    const danmuId = searchParams.get('danmuId');

    if (!videoId || !danmuId) {
      return NextResponse.json({ error: '视频ID和弹幕ID不能为空' }, { status: 400 });
    }

    await db.deleteDanmu(videoId, danmuId);

    return NextResponse.json({ success: true, message: '弹幕删除成功' });
  } catch (error) {
    console.error('删除弹幕失败:', error);
    return NextResponse.json({ error: '删除弹幕失败' }, { status: 500 });
  }
}
