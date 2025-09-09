/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

// 短剧搜索函数
async function searchShortDrama(query: string, page = 1, limit = 20): Promise<any[]> {
  try {
    // 使用 AbortController 实现超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`https://api.r2afosne.dpdns.org/vod/search?name=${encodeURIComponent(query)}&page=${page}&limit=${limit}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'LunaTV/1.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Short drama API returned ${response.status}`);
    }

    const data = await response.json();

    if (!data.list || !Array.isArray(data.list)) {
      return [];
    }

    // 将短剧数据转换为统一的搜索结果格式，限制数量避免卡顿
    const limitedResults = data.list.slice(0, limit);
    return limitedResults.map((item: any) => ({
      id: item.id?.toString() || '',
      title: item.name || '',
      poster: item.cover || '',
      year: item.update_time ? new Date(item.update_time).getFullYear().toString() : 'unknown',
      episodes: [{ id: '1', name: '第1集' }], // 短剧通常有多集，但这里简化处理
      source: 'shortdrama',
      source_name: '短剧',
      douban_id: 0,
      type_name: '短剧',
      // 短剧特有字段
      score: item.score || 0,
      update_time: item.update_time || '',
      vod_class: '',
      vod_tag: '',
    }));
  } catch (error) {
    console.warn('短剧搜索失败:', error);
    return [];
  }
}

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);

  // 添加超时控制和错误处理，避免慢接口拖累整体响应
  const searchPromises = apiSites.map((site) =>
    Promise.race([
      searchFromApi(site, query),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
      ),
    ]).then((results: unknown) => {
      // 限制每个源的结果数量，避免页面卡顿
      return Array.isArray(results) ? results.slice(0, 50) : [];
    }).catch((err) => {
      console.warn(`搜索失败 ${site.name}:`, err.message);
      return []; // 返回空数组而不是抛出错误
    })
  );

  // 添加短剧搜索
  const shortDramaSearchPromise = searchShortDrama(query, 1, 20).catch((err) => {
    console.warn('短剧搜索失败:', err.message);
    return [];
  });

  // 将短剧搜索添加到所有搜索Promise中
  searchPromises.push(shortDramaSearchPromise);

  try {
    const results = await Promise.allSettled(searchPromises);
    const successResults = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => (result as PromiseFulfilledResult<any>).value);
    let flattenedResults = successResults.flat();
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    const cacheTime = await getCacheTime();

    if (flattenedResults.length === 0) {
      // no cache if empty
      return NextResponse.json({ results: [] }, { status: 200 });
    }

    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
