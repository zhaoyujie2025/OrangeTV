import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { ChatMessage } from '../../../../lib/types';
import { getAuthInfoFromCookie } from '../../../../lib/auth';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      console.log('未授权访问消息API:', authInfo);
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!conversationId) {
      console.log('缺少对话ID参数');
      return NextResponse.json({ error: '对话 ID 不能为空' }, { status: 400 });
    }

    console.log('加载消息 - 用户:', authInfo.username, '对话ID:', conversationId);

    // 验证用户是否有权限访问此对话
    let conversation;
    try {
      conversation = await db.getConversation(conversationId);
      console.log('对话查询结果:', conversation ? '找到对话' : '对话不存在');
    } catch (dbError) {
      console.error('数据库查询对话失败:', dbError);
      return NextResponse.json({
        error: '数据库查询失败',
        details: process.env.NODE_ENV === 'development' ? (dbError as Error).message : undefined
      }, { status: 500 });
    }

    if (!conversation) {
      console.log('对话不存在:', conversationId);
      return NextResponse.json({ error: '对话不存在' }, { status: 404 });
    }

    if (!conversation.participants.includes(authInfo.username)) {
      console.log('用户无权限访问对话:', authInfo.username, '参与者:', conversation.participants);
      return NextResponse.json({ error: '无权限访问此对话' }, { status: 403 });
    }

    try {
      const messages = await db.getMessages(conversationId, limit, offset);
      console.log(`成功加载 ${messages.length} 条消息`);
      return NextResponse.json(messages);
    } catch (dbError) {
      console.error('数据库查询消息失败:', dbError);
      return NextResponse.json({
        error: '获取消息失败',
        details: process.env.NODE_ENV === 'development' ? (dbError as Error).message : undefined
      }, { status: 500 });
    }

  } catch (error) {
    console.error('加载消息API发生未知错误:', error);
    return NextResponse.json({
      error: '获取消息失败',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const messageData = await request.json();

    if (!messageData.conversation_id || !messageData.content) {
      return NextResponse.json({ error: '对话 ID 和消息内容不能为空' }, { status: 400 });
    }

    // 验证用户是否有权限发送消息到此对话
    const conversation = await db.getConversation(messageData.conversation_id);
    if (!conversation || !conversation.participants.includes(authInfo.username)) {
      return NextResponse.json({ error: '无权限发送消息到此对话' }, { status: 403 });
    }

    const message: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conversation_id: messageData.conversation_id,
      sender_id: authInfo.username,
      sender_name: authInfo.username,
      content: messageData.content,
      message_type: messageData.message_type || 'text',
      timestamp: Date.now(),
      is_read: false,
    };

    await db.saveMessage(message);

    // 更新对话的最后消息和更新时间
    await db.updateConversation(messageData.conversation_id, {
      last_message: message,
      updated_at: Date.now(),
    });

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error('Error sending message:', error);
    return NextResponse.json({ error: '发送消息失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { messageId } = await request.json();

    if (!messageId) {
      return NextResponse.json({ error: '消息 ID 不能为空' }, { status: 400 });
    }

    await db.markMessageAsRead(messageId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error marking message as read:', error);
    return NextResponse.json({ error: '标记消息已读失败' }, { status: 500 });
  }
}
