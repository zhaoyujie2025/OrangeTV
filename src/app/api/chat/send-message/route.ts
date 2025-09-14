import { NextRequest, NextResponse } from 'next/server';
import { getAuthInfoFromCookie } from '../../../../lib/auth';
import { WebSocketMessage } from '../../../../lib/types';

// 从全局对象获取WebSocket实例相关方法
function sendMessageToUsers(userIds: string[], message: WebSocketMessage): boolean {
  try {
    if ((global as any).wss) {
      // 假设websocket.js中导出了sendMessageToUsers方法并附加到了wss对象上
      return require('../../../../../websocket').sendMessageToUsers(userIds, message);
    }
    return false;
  } catch (error) {
    console.error('发送WebSocket消息失败:', error);
    return false;
  }
}

// 发送消息的备用 API 路由，在 WebSocket 不可用时使用
export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const message: WebSocketMessage = await request.json();

    // 根据消息类型处理
    let targetUsers: string[] = [];

    switch (message.type) {
      case 'message':
        const { participants } = message.data;
        if (participants && Array.isArray(participants)) {
          targetUsers = participants;
        }
        break;

      case 'friend_request':
        const { to_user } = message.data;
        if (to_user) {
          targetUsers = [to_user];
        }
        break;

      case 'friend_accepted':
        const { from_user } = message.data;
        if (from_user) {
          targetUsers = [from_user];
        }
        break;

      default:
        return NextResponse.json({ error: '不支持的消息类型' }, { status: 400 });
    }

    // 通过 WebSocket 发送消息
    const sent = sendMessageToUsers(targetUsers, message);

    return NextResponse.json({
      success: true,
      delivered: sent
    });
  } catch (error) {
    console.error('通过 API 发送消息失败:', error);
    return NextResponse.json({ error: '发送消息失败' }, { status: 500 });
  }
}
