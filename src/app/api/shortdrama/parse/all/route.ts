import { NextRequest, NextResponse } from 'next/server';
import { API_CONFIG } from '@/lib/config';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      console.error('🚫 [短剧API] 缺少必需的ID参数');
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      );
    }

    console.log(`🎬 [短剧API] 开始请求短剧全集地址:`, {
      requestId: id,
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent'),
      referer: request.headers.get('referer')
    });

    const apiUrl = new URL(`${API_CONFIG.shortdrama.baseUrl}/vod/parse/all`);
    apiUrl.searchParams.append('id', id);
    apiUrl.searchParams.append('proxy', 'true');

    console.log(`🌐 [短剧API] 外部API调用详情:`, {
      baseUrl: API_CONFIG.shortdrama.baseUrl,
      fullUrl: apiUrl.toString(),
      headers: API_CONFIG.shortdrama.headers,
      timeout: '60秒'
    });

    const requestStartTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error('⏰ [短剧API] 请求超时 - 60秒');
      controller.abort();
    }, 60000);

    const response = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers: API_CONFIG.shortdrama.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const requestEndTime = performance.now();
    const requestDuration = requestEndTime - requestStartTime;

    console.log(`📡 [短剧API] 外部API响应状态:`, {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      requestDuration: `${requestDuration.toFixed(2)}ms`,
      contentType: response.headers.get('content-type')
    });

    if (!response.ok) {
      console.error(`❌ [短剧API] 外部API请求失败:`, {
        status: response.status,
        statusText: response.statusText,
        url: apiUrl.toString(),
        requestDuration: `${requestDuration.toFixed(2)}ms`
      });
      throw new Error(`API request failed: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`📦 [短剧API] 外部API响应数据分析:`, {
      hasData: !!data,
      dataKeys: data ? Object.keys(data) : [],
      videoId: data?.videoId,
      videoName: data?.videoName,
      totalEpisodes: data?.totalEpisodes,
      successfulCount: data?.successfulCount,
      failedCount: data?.failedCount,
      hasResults: !!data?.results,
      resultsLength: data?.results?.length || 0,
      resultsType: typeof data?.results,
      isResultsArray: Array.isArray(data?.results),
      hasCover: !!data?.cover,
      hasDescription: !!data?.description
    });

    // 分析results数组的详细结构
    if (data?.results && Array.isArray(data.results)) {
      const successCount = data.results.filter((item: any) => item.status === 'success').length;
      const failureCount = data.results.filter((item: any) => item.status !== 'success').length;
      const withUrlCount = data.results.filter((item: any) => item.status === 'success' && item.parsedUrl).length;

      console.log(`📋 [短剧API] Results数组详细分析:`, {
        totalItems: data.results.length,
        successItems: successCount,
        failureItems: failureCount,
        itemsWithUrl: withUrlCount,
        sampleSuccessItems: data.results.filter((item: any) => item.status === 'success').slice(0, 3).map((item: any) => ({
          index: item.index,
          label: item.label,
          status: item.status,
          hasUrl: !!item.parsedUrl,
          urlLength: item.parsedUrl ? item.parsedUrl.length : 0,
          urlDomain: item.parsedUrl ? item.parsedUrl.match(/https?:\/\/([^\/]+)/)?.[1] : null
        })),
        sampleFailureItems: data.results.filter((item: any) => item.status !== 'success').slice(0, 3).map((item: any) => ({
          index: item.index,
          label: item.label,
          status: item.status,
          reason: item.reason
        }))
      });
    } else {
      console.error(`❌ [短剧API] Results数组无效:`, {
        hasResults: !!data?.results,
        resultsType: typeof data?.results,
        isArray: Array.isArray(data?.results),
        resultsValue: data?.results
      });
    }

    // 验证返回的数据格式
    if (!data || !data.results || !Array.isArray(data.results)) {
      console.error('❌ [短剧API] 数据格式验证失败:', {
        hasData: !!data,
        hasResults: !!data?.results,
        resultsType: typeof data?.results,
        isResultsArray: Array.isArray(data?.results),
        fullData: data
      });
      throw new Error('Invalid API response format - 外部API返回的数据格式不正确');
    }

    // 检查播放地址的有效性
    console.log('🔍 [短剧API] 开始验证播放地址有效性...');

    const validResults = data.results.filter((item: any) => {
      const isValid = item.status === 'success' &&
        item.parsedUrl &&
        typeof item.parsedUrl === 'string' &&
        item.parsedUrl.trim().length > 0;

      if (!isValid) {
        console.warn(`⚠️ [短剧API] 无效的播放源:`, {
          index: item.index,
          label: item.label,
          status: item.status,
          hasUrl: !!item.parsedUrl,
          urlType: typeof item.parsedUrl,
          urlLength: item.parsedUrl ? item.parsedUrl.length : 0,
          reason: item.reason || '未知原因'
        });
      }

      return isValid;
    });

    console.log(`✅ [短剧API] 播放源验证完成:`, {
      totalSources: data.results.length,
      validSources: validResults.length,
      invalidSources: data.results.length - validResults.length,
      validationRate: `${((validResults.length / data.results.length) * 100).toFixed(1)}%`
    });

    if (validResults.length === 0) {
      console.error('❌ [短剧API] 没有找到任何有效的播放地址:', {
        totalResults: data.results.length,
        allResults: data.results.map((item: any) => ({
          index: item.index,
          label: item.label,
          status: item.status,
          hasUrl: !!item.parsedUrl,
          urlType: typeof item.parsedUrl,
          reason: item.reason
        }))
      });
      throw new Error('No valid video sources found - 所有播放源都无效');
    }

    // 返回处理后的数据
    const processedData = {
      ...data,
      results: validResults,
      totalEpisodes: validResults.length,
      successfulCount: validResults.length,
      originalTotalEpisodes: data.totalEpisodes,
      originalSuccessfulCount: data.successfulCount,
      filteredCount: data.results.length - validResults.length
    };

    console.log('🎯 [短剧API] 返回处理后的短剧数据:', {
      videoId: processedData.videoId,
      videoName: processedData.videoName,
      originalTotal: processedData.originalTotalEpisodes,
      filteredTotal: processedData.totalEpisodes,
      originalSuccess: processedData.originalSuccessfulCount,
      filteredSuccess: processedData.successfulCount,
      filteredOut: processedData.filteredCount,
      firstEpisode: {
        index: processedData.results[0]?.index,
        label: processedData.results[0]?.label,
        urlPreview: processedData.results[0]?.parsedUrl?.substring(0, 100) + '...'
      },
      lastEpisode: {
        index: processedData.results[processedData.results.length - 1]?.index,
        label: processedData.results[processedData.results.length - 1]?.label,
        urlPreview: processedData.results[processedData.results.length - 1]?.parsedUrl?.substring(0, 100) + '...'
      }
    });

    return NextResponse.json(processedData);
  } catch (error) {
    const { searchParams: errorSearchParams } = new URL(request.url);
    const errorId = errorSearchParams.get('id');

    console.error('💥 [短剧API] 发生错误:', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      requestId: errorId,
      timestamp: new Date().toISOString(),
      isTimeoutError: error instanceof Error && error.name === 'AbortError',
      isFetchError: error instanceof TypeError,
      isNetworkError: error instanceof Error && error.message.includes('fetch')
    });

    // 分析错误类型
    let errorCategory = '未知错误';
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorCategory = '请求超时';
      } else if (error.message.includes('fetch')) {
        errorCategory = '网络连接错误';
      } else if (error.message.includes('API request failed')) {
        errorCategory = '外部API错误';
      } else if (error.message.includes('Invalid API response format')) {
        errorCategory = '数据格式错误';
      } else if (error.message.includes('No valid video sources found')) {
        errorCategory = '无有效播放源';
      }
    }

    console.warn(`🔄 [短剧API] 错误类型: ${errorCategory}，启用备用数据`);

    const mockData = {
      videoId: parseInt(errorId || '1') || 1,
      videoName: `短剧播放示例 (ID: ${errorId})`,
      results: Array.from({ length: 8 }, (_, index) => ({
        index: index,
        label: `第${index + 1}集`,
        // 使用一些测试视频地址，这些是公共测试资源
        parsedUrl: `https://sample-videos.com/zip/10/mp4/SampleVideo_720x480_1mb.mp4?episode=${index + 1}`,
        parseInfo: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://sample-videos.com'
          },
          type: 'mp4'
        },
        status: 'success',
        reason: null
      })),
      totalEpisodes: 8,
      successfulCount: 8,
      failedCount: 0,
      cover: 'https://via.placeholder.com/300x400?text=短剧示例',
      description: `这是一个短剧播放示例，用于测试播放功能。原始ID: ${errorId}，错误: ${errorCategory}`,
      // 添加错误信息供调试使用
      _debugInfo: {
        errorCategory: errorCategory,
        originalError: error instanceof Error ? error.message : String(error),
        fallbackDataUsed: true,
        timestamp: new Date().toISOString()
      }
    };

    console.log('🔧 [短剧API] 返回备用短剧数据:', {
      videoName: mockData.videoName,
      totalEpisodes: mockData.totalEpisodes,
      errorCategory: errorCategory,
      firstEpisodeUrl: mockData.results[0].parsedUrl,
      hasFallbackData: true
    });

    return NextResponse.json(mockData, {
      headers: {
        'X-Fallback-Data': 'true',
        'X-Error-Category': errorCategory,
        'X-Original-Error': error instanceof Error ? error.message : String(error)
      }
    });
  }
}
