/**
 * 独立的WebSocket服务器
 * 完全独立于Next.js，避免任何冲突
 */
const WebSocket = require('ws');

// 存储已连接的用户
const connectedUsers = new Map();

// 创建独立的WebSocket服务器，使用不同的端口
function createStandaloneWebSocketServer(port = 3001) {
  const wss = new WebSocket.Server({
    port: port,
    perMessageDeflate: false,
    clientTracking: true
  });

  console.log(`独立WebSocket服务器已启动在端口 ${port}`);

  // 连接事件处理
  wss.on('connection', (ws, req) => {
    console.log('新的 WebSocket 连接');
    let userId = null;

    // 设置心跳检测
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // 消息处理
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(ws, message);
      } catch (error) {
        console.error('解析 WebSocket 消息错误:', error);
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: '消息格式无效' },
          timestamp: Date.now()
        }));
      }
    });

    // 关闭连接处理
    ws.on('close', () => {
      if (userId) {
        connectedUsers.delete(userId);
        // 广播用户离线状态
        broadcastUserStatus(userId, 'offline');
        console.log(`用户 ${userId} 已断开连接`);
      }
    });

    // 错误处理
    ws.on('error', (error) => {
      console.error(`WebSocket 错误 ${userId ? `(用户: ${userId})` : ''}:`, error);
    });

    // 消息处理函数
    function handleMessage(ws, message) {
      switch (message.type) {
        case 'ping':
          // 响应客户端的心跳检测
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now()
          }));
          break;

        case 'user_connect':
          userId = message.data.userId;
          connectedUsers.set(userId, ws);
          console.log(`用户 ${userId} 已连接`);

          // 确认连接成功
          ws.send(JSON.stringify({
            type: 'connection_confirmed',
            data: { userId },
            timestamp: Date.now()
          }));

          // 广播用户在线状态
          broadcastUserStatus(userId, 'online');

          // 发送在线用户列表给新连接的用户
          ws.send(JSON.stringify({
            type: 'online_users',
            data: { users: Array.from(connectedUsers.keys()) },
            timestamp: Date.now()
          }));
          break;

        case 'message':
          // 转发消息给对话参与者
          if (message.data.participants && Array.isArray(message.data.participants)) {
            message.data.participants.forEach(participantId => {
              // 不发送给自己
              if (participantId !== userId && connectedUsers.has(participantId)) {
                const participantWs = connectedUsers.get(participantId);
                if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                  participantWs.send(JSON.stringify(message));
                }
              }
            });
          }
          // 兼容旧版本的receiverId方式
          else if (message.data.receiverId && connectedUsers.has(message.data.receiverId)) {
            const receiverWs = connectedUsers.get(message.data.receiverId);
            if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
              receiverWs.send(JSON.stringify(message));
            }
          }
          break;

        case 'typing':
          // 转发打字状态给目标用户
          if (message.data.receiverId && connectedUsers.has(message.data.receiverId)) {
            const receiverWs = connectedUsers.get(message.data.receiverId);
            if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
              receiverWs.send(JSON.stringify(message));
            }
          }
          break;

        case 'friend_request':
          // 转发好友申请给目标用户
          const targetUser = message.data.to_user;
          if (targetUser && connectedUsers.has(targetUser)) {
            const targetWs = connectedUsers.get(targetUser);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify(message));
            }
          }
          break;

        case 'friend_accepted':
          // 转发好友接受消息给申请发起人
          const fromUser = message.data.from_user;
          if (fromUser && connectedUsers.has(fromUser)) {
            const fromUserWs = connectedUsers.get(fromUser);
            if (fromUserWs && fromUserWs.readyState === WebSocket.OPEN) {
              fromUserWs.send(JSON.stringify(message));
            }
          }
          break;
      }
    }
  });

  // 心跳检测定时器
  const heartbeatInterval = setInterval(() => {
    let activeConnections = 0;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log('检测到无响应的连接，正在终止...');
        return ws.terminate();
      }

      ws.isAlive = false;
      // 发送ping
      try {
        ws.ping(() => { });
        activeConnections++;
      } catch (error) {
        console.error('发送ping失败:', error);
      }
    });

    if (activeConnections > 0) {
      console.log(`心跳检测: 活跃连接数: ${activeConnections}`);
    }
  }, 30000);

  // 关闭服务器时清理定时器
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

// 广播用户状态
function broadcastUserStatus(userId, status) {
  const statusMessage = {
    type: 'user_status',
    data: { userId, status },
    timestamp: Date.now()
  };

  connectedUsers.forEach((ws, connectedUserId) => {
    if (connectedUserId !== userId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(statusMessage));
    }
  });
}

// 获取在线用户列表
function getOnlineUsers() {
  return Array.from(connectedUsers.keys());
}

// 发送消息给特定用户
function sendMessageToUser(userId, message) {
  const ws = connectedUsers.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// 发送消息给多个用户
function sendMessageToUsers(userIds, message) {
  let success = false;
  userIds.forEach(userId => {
    if (sendMessageToUser(userId, message)) {
      success = true;
    }
  });
  return success;
}

// 如果直接运行此文件，启动WebSocket服务器
if (require.main === module) {
  const port = process.env.WS_PORT || 3001;
  createStandaloneWebSocketServer(port);
}

module.exports = {
  createStandaloneWebSocketServer,
  getOnlineUsers,
  sendMessageToUser,
  sendMessageToUsers,
  broadcastUserStatus
};
