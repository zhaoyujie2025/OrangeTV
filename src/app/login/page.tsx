/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { AlertCircle, CheckCircle, Shield } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version_check';
import MachineCode from '@/lib/machine-code';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

// 版本显示组件
function VersionDisplay() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (_) {
        // do nothing
      } finally {
        setIsChecking(false);
      }
    };

    checkUpdate();
  }, []);

  return (
    <button
      onClick={() =>
        window.open('https://github.com/djteang/OrangeTV', '_blank')
      }
      className='absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 transition-colors cursor-pointer'
    >
      <span className='font-mono'>v{CURRENT_VERSION}</span>
      {!isChecking && updateStatus !== UpdateStatus.FETCH_FAILED && (
        <div
          className={`flex items-center gap-1.5 ${updateStatus === UpdateStatus.HAS_UPDATE
            ? 'text-yellow-600 dark:text-yellow-400'
            : updateStatus === UpdateStatus.NO_UPDATE
              ? 'text-blue-600 dark:text-blue-400'
              : ''
            }`}
        >
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <>
              <AlertCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>有新版本</span>
            </>
          )}
          {updateStatus === UpdateStatus.NO_UPDATE && (
            <>
              <CheckCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>已是最新</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);

  // 机器码相关状态
  const [machineCode, setMachineCode] = useState<string>('');
  const [deviceInfo, setDeviceInfo] = useState<string>('');
  const [, setShowMachineCodeInput] = useState(false);
  const [requireMachineCode, setRequireMachineCode] = useState(false);
  const [machineCodeGenerated, setMachineCodeGenerated] = useState(false);
  const [, setShowBindOption] = useState(false);
  const [bindMachineCode, setBindMachineCode] = useState(false);
  const [deviceCodeEnabled, setDeviceCodeEnabled] = useState(true); // 站点是否启用设备码功能

  const { siteName } = useSite();

  // 在客户端挂载后设置配置并生成机器码
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const runtimeConfig = (window as any).RUNTIME_CONFIG;
      const storageType = runtimeConfig?.STORAGE_TYPE;
      const requireDeviceCode = runtimeConfig?.REQUIRE_DEVICE_CODE;

      setShouldAskUsername(storageType && storageType !== 'localstorage');
      setDeviceCodeEnabled(requireDeviceCode !== false); // 默认启用，除非明确设置为 false

      // 只有在启用设备码功能时才生成机器码和设备信息
      const generateMachineInfo = async () => {
        if (requireDeviceCode !== false && MachineCode.isSupported()) {
          try {
            const code = await MachineCode.generateMachineCode();
            const info = await MachineCode.getDeviceInfo();
            setMachineCode(code);
            setDeviceInfo(info);
            setMachineCodeGenerated(true);
          } catch (error) {
            console.error('生成机器码失败:', error);
          }
        }
      };

      generateMachineInfo();
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;

    try {
      setLoading(true);

      // 构建请求数据
      const requestData: any = {
        password,
        ...(shouldAskUsername ? { username } : {}),
      };

      // 只有在启用设备码功能时才处理机器码逻辑
      if (deviceCodeEnabled && (requireMachineCode || bindMachineCode) && machineCode) {
        requestData.machineCode = machineCode;
      }

      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        // 登录成功，如果启用设备码功能且用户选择绑定机器码，则绑定
        if (deviceCodeEnabled && bindMachineCode && machineCode && shouldAskUsername) {
          try {
            await fetch('/api/machine-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                machineCode,
                deviceInfo,
              }),
            });
          } catch (bindError) {
            console.error('绑定机器码失败:', bindError);
          }
        }

        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else if (res.status === 403) {
        // 处理机器码相关错误
        if (data.requireMachineCode) {
          setRequireMachineCode(true);
          setShowMachineCodeInput(true);
          setError('该账户已绑定设备，请验证机器码');
        } else if (data.machineCodeMismatch) {
          setError('机器码不匹配，此账户只能在绑定的设备上使用');
        } else {
          setError(data.error || '访问被拒绝');
        }
      } else if (res.status === 409) {
        // 机器码被其他用户绑定
        setError(data.error || '机器码冲突');
      } else if (res.status === 401) {
        setError('用户名或密码错误');
      } else {
        setError(data.error ?? '服务器错误');
      }
    } catch (error) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className='relative min-h-screen flex items-center justify-center px-4 overflow-hidden'>
      <div className='absolute top-4 right-4'>
        <ThemeToggle />
      </div>
      <div className='relative z-10 w-full max-w-md rounded-3xl bg-gradient-to-b from-white/90 via-white/70 to-white/40 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40 backdrop-blur-xl shadow-2xl p-10 dark:border dark:border-zinc-800'>
        <h1 className='text-blue-600 tracking-tight text-center text-3xl font-extrabold mb-8 bg-clip-text drop-shadow-sm'>
          {siteName}
        </h1>
        <form onSubmit={handleSubmit} className='space-y-8'>
          {shouldAskUsername && (
            <div className='relative'>
              <input
                id='username'
                type='text'
                autoComplete='username'
                className='peer block w-full rounded-lg border-0 py-4 px-4 pt-6 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 focus:ring-2 focus:ring-blue-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur placeholder-transparent'
                placeholder='用户名'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <label
                htmlFor='username'
                className={`absolute left-4 transition-all duration-200 pointer-events-none ${username
                  ? 'top-1 text-xs text-blue-600 dark:text-blue-400'
                  : 'top-4 text-base text-gray-500 dark:text-gray-400 peer-focus:top-1 peer-focus:text-xs peer-focus:text-blue-600 peer-focus:dark:text-blue-400'
                  }`}
              >
                用户名
              </label>
            </div>
          )}

          <div className='relative'>
            <input
              id='password'
              type='password'
              autoComplete='current-password'
              className='peer block w-full rounded-lg border-0 py-4 px-4 pt-6 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 focus:ring-2 focus:ring-blue-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur placeholder-transparent'
              placeholder='密码'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <label
              htmlFor='password'
              className={`absolute left-4 transition-all duration-200 pointer-events-none ${password
                ? 'top-1 text-xs text-blue-600 dark:text-blue-400'
                : 'top-4 text-base text-gray-500 dark:text-gray-400 peer-focus:top-1 peer-focus:text-xs peer-focus:text-blue-600 peer-focus:dark:text-blue-400'
                }`}
            >
              密码
            </label>
          </div>

          {/* 机器码信息显示 - 只有在启用设备码功能时才显示 */}
          {deviceCodeEnabled && machineCodeGenerated && shouldAskUsername && (
            <div className='space-y-4'>
              <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
                <div className='flex items-center space-x-2 mb-2'>
                  <Shield className='w-4 h-4 text-blue-600 dark:text-blue-400' />
                  <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>设备识别码</span>
                </div>
                <div className='space-y-2'>
                  <div className='text-xs font-mono text-gray-700 dark:text-gray-300 break-all'>
                    {MachineCode.formatMachineCode(machineCode)}
                  </div>
                  <div className='text-xs text-gray-600 dark:text-gray-400'>
                    设备信息: {deviceInfo}
                  </div>
                </div>
              </div>

              {/* 绑定选项 */}
              {!requireMachineCode && (
                <div className='space-y-2'>
                  <div className='flex items-center space-x-3'>
                    <input
                      id='bindMachineCode'
                      type='checkbox'
                      checked={bindMachineCode}
                      onChange={(e) => setBindMachineCode(e.target.checked)}
                      className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                    />
                    <label htmlFor='bindMachineCode' className='text-sm text-gray-700 dark:text-gray-300'>
                      绑定此设备（提升账户安全性）
                    </label>
                  </div>
                  {/* <p className='text-xs text-gray-500 dark:text-gray-400 ml-7'>
                    // 管理员可选择不绑定机器码直接登录
                  </p> */}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          )}

          {/* 登录按钮 */}
          <button
            type='submit'
            disabled={
              !password ||
              loading ||
              (shouldAskUsername && !username) ||
              (deviceCodeEnabled && machineCodeGenerated && shouldAskUsername && !requireMachineCode && !bindMachineCode)
            }
            className='inline-flex w-full justify-center rounded-lg bg-blue-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:from-blue-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>

      {/* 版本信息显示 */}
      <VersionDisplay />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
