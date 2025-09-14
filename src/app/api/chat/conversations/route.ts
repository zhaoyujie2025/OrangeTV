import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { Conversation } from '../../../../lib/types';
import { getAuthInfoFromCookie } from '../../../../lib/auth';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const conversations = await db.getConversations(authInfo.username);
    return NextResponse.json(conversations);
  } catch (error) {
    console.error('Error loading conversations:', error);
    return NextResponse.json({ error: '获取对话列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { participants, name, type } = await request.json();

    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      return NextResponse.json({ error: '参与者列表不能为空' }, { status: 400 });
    }

    // 确保当前用户在参与者列表中
    if (!participants.includes(authInfo.username)) {
      participants.push(authInfo.username);
    }

    // 根据参与者数量确定对话类型
    const conversationType = type || (participants.length > 2 ? 'group' : 'private');
    const isGroup = conversationType === 'group';

    const conversation: Conversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name || participants.filter(p => p !== authInfo.username).join(', '),
      participants,
      type: conversationType,
      created_at: Date.now(),
      updated_at: Date.now(),
      is_group: isGroup,
    };

    await db.createConversation(conversation);
    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    console.error('Error creating conversation:', error);
    return NextResponse.json({ error: '创建对话失败' }, { status: 500 });
  }
}
