import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 获取用户机器码信息
export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // 管理员获取所有用户的机器码信息
    if (action === 'list' && (authInfo.role === 'admin' || authInfo.role === 'owner')) {
      const machineCodeUsers = await db.getMachineCodeUsers();
      return NextResponse.json({ users: machineCodeUsers });
    }

    // 获取当前用户的机器码
    const userMachineCode = await db.getUserMachineCode(authInfo.username);

    return NextResponse.json({
      machineCode: userMachineCode,
      isBound: !!userMachineCode
    });
  } catch (error) {
    console.error('获取机器码信息失败:', error);
    return NextResponse.json({ error: '获取机器码信息失败' }, { status: 500 });
  }
}

// 绑定机器码
export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { machineCode, deviceInfo, action } = body;

    // 管理员操作：解绑用户机器码
    if (action === 'unbind' && (authInfo.role === 'admin' || authInfo.role === 'owner')) {
      const { targetUser } = body;
      if (!targetUser) {
        return NextResponse.json({ error: '目标用户不能为空' }, { status: 400 });
      }

      await db.deleteUserMachineCode(targetUser);
      return NextResponse.json({ success: true, message: '机器码解绑成功' });
    }

    // 用户绑定机器码
    if (!machineCode) {
      return NextResponse.json({ error: '机器码不能为空' }, { status: 400 });
    }

    // 检查机器码是否已被绑定
    const boundUser = await db.isMachineCodeBound(machineCode);
    if (boundUser && boundUser !== authInfo.username) {
      return NextResponse.json({
        error: `该机器码已被用户 ${boundUser} 绑定，请联系管理员处理`,
        boundUser
      }, { status: 409 });
    }

    // 检查用户是否已绑定其他机器码
    const existingMachineCode = await db.getUserMachineCode(authInfo.username);
    if (existingMachineCode && existingMachineCode !== machineCode) {
      return NextResponse.json({
        error: '您已绑定其他设备，如需更换请联系管理员',
        currentMachineCode: existingMachineCode
      }, { status: 409 });
    }

    // 绑定机器码
    await db.setUserMachineCode(authInfo.username, machineCode, deviceInfo);

    return NextResponse.json({
      success: true,
      message: '机器码绑定成功',
      machineCode
    });
  } catch (error) {
    console.error('绑定机器码失败:', error);
    return NextResponse.json({ error: '绑定机器码失败' }, { status: 500 });
  }
}

// 解绑机器码（用户自己解绑）
export async function DELETE(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 检查是否有绑定的机器码
    const existingMachineCode = await db.getUserMachineCode(authInfo.username);
    if (!existingMachineCode) {
      return NextResponse.json({ error: '您还未绑定任何机器码' }, { status: 400 });
    }

    // 解绑机器码
    await db.deleteUserMachineCode(authInfo.username);

    return NextResponse.json({
      success: true,
      message: '机器码解绑成功'
    });
  } catch (error) {
    console.error('解绑机器码失败:', error);
    return NextResponse.json({ error: '解绑机器码失败' }, { status: 500 });
  }
}
