import { NextRequest } from 'next/server';

// 这个端点主要用于 WebSocket 升级，实际的 WebSocket 处理在自定义服务器中进行
export async function GET(request: NextRequest) {
  // 如果运行在自定义服务器环境下，WebSocket 连接应该已经被处理
  // 这里主要是为了提供一个回退响应

  const { searchParams } = new URL(request.url);
  if (searchParams.get('upgrade') === 'websocket') {
    return new Response('WebSocket upgrade should be handled by custom server', {
      status: 426,
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
      },
    });
  }

  return new Response('WebSocket endpoint', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}







