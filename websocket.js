// WebSocket 服务器独立实现
const WebSocket = require('ws');

// 存储已连接的用户
const connectedUsers = new Map();

// 创建 WebSocket 服务器
function createWebSocketServer(server) {
  const wss = new WebSocket.Server({
    noServer: true  // 使用 noServer 模式，手动处理升级请求
  });

  console.log('WebSocket 服务器已初始化');

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
          // 转发消息给目标用户
          if (message.data.receiverId && connectedUsers.has(message.data.receiverId)) {
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
        case 'friend_accepted':
          // 转发好友相关消息
          if (message.data.targetUserId && connectedUsers.has(message.data.targetUserId)) {
            const targetWs = connectedUsers.get(message.data.targetUserId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(JSON.stringify(message));
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
      // 发送ping，使用noop回调
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

module.exports = {
  createWebSocketServer,
  getOnlineUsers,
  sendMessageToUser,
  sendMessageToUsers,
  broadcastUserStatus
};
