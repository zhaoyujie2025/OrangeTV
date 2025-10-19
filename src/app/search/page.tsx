/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any,@typescript-eslint/no-non-null-assertion,no-empty */
'use client';

import { ChevronUp, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { startTransition, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';

import PageLayout from '@/components/PageLayout';
import SearchResultFilter, { SearchFilterCategory } from '@/components/SearchResultFilter';
import SearchSuggestions from '@/components/SearchSuggestions';
import VideoCard, { VideoCardHandle } from '@/components/VideoCard';

function SearchPageClient() {
  // 搜索历史
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // 返回顶部按钮显示状态
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 滚动进度状态
  const [scrollProgress, setScrollProgress] = useState(0);

  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQueryRef = useRef<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [totalSources, setTotalSources] = useState(0);
  const [completedSources, setCompletedSources] = useState(0);
  const pendingResultsRef = useRef<SearchResult[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const [useFluidSearch, setUseFluidSearch] = useState(true);
  // 聚合卡片 refs 与聚合统计缓存
  const groupRefs = useRef<Map<string, React.RefObject<VideoCardHandle>>>(new Map());
  const groupStatsRef = useRef<Map<string, { douban_id?: number; episodes?: number; source_names: string[] }>>(new Map());

  // 执行搜索的通用函数
  const performSearch = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    // 更新搜索查询和状态
    setSearchQuery(trimmed);
    currentQueryRef.current = trimmed;

    // 清理缓存标记，确保执行新搜索
    sessionStorage.removeItem('fromPlayPage');

    // 清空旧的搜索结果和状态
    if (eventSourceRef.current) {
      try { eventSourceRef.current.close(); } catch { }
      eventSourceRef.current = null;
    }
    setSearchResults([]);
    setTotalSources(0);
    setCompletedSources(0);
    pendingResultsRef.current = [];
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    // 清理聚合统计缓存和refs
    groupStatsRef.current.clear();
    groupRefs.current.clear();
    setIsLoading(true);
    setShowResults(true);

    // 读取流式搜索设置
    let currentFluidSearch = useFluidSearch;
    if (typeof window !== 'undefined') {
      const savedFluidSearch = localStorage.getItem('fluidSearch');
      if (savedFluidSearch !== null) {
        currentFluidSearch = JSON.parse(savedFluidSearch);
      } else {
        const defaultFluidSearch = (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
        currentFluidSearch = defaultFluidSearch;
      }
    }

    if (currentFluidSearch !== useFluidSearch) {
      setUseFluidSearch(currentFluidSearch);
    }

    if (currentFluidSearch) {
      // 流式搜索
      const es = new EventSource(`/api/search/ws?q=${encodeURIComponent(trimmed)}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        if (!event.data) return;
        try {
          const payload = JSON.parse(event.data);
          if (currentQueryRef.current !== trimmed || eventSourceRef.current !== es) {
            console.warn('忽略过期的搜索响应:', payload.type, '当前查询:', currentQueryRef.current, '响应查询:', trimmed);
            return;
          }
          switch (payload.type) {
            case 'start':
              setTotalSources(payload.totalSources || 0);
              setCompletedSources(0);
              break;
            case 'source_result': {
              setCompletedSources((prev) => prev + 1);
              if (Array.isArray(payload.results) && payload.results.length > 0) {
                const activeYearOrder = (viewMode === 'agg' ? (filterAgg.yearOrder) : (filterAll.yearOrder));
                const incoming: SearchResult[] =
                  activeYearOrder === 'none'
                    ? sortBatchForNoOrder(payload.results as SearchResult[])
                    : (payload.results as SearchResult[]);
                pendingResultsRef.current.push(...incoming);
                if (!flushTimerRef.current) {
                  flushTimerRef.current = window.setTimeout(() => {
                    const toAppend = pendingResultsRef.current;
                    pendingResultsRef.current = [];
                    startTransition(() => {
                      setSearchResults((prev) => prev.concat(toAppend));
                    });
                    flushTimerRef.current = null;
                  }, 80);
                }
              }
              break;
            }
            case 'source_error':
              setCompletedSources((prev) => prev + 1);
              break;
            case 'complete':
              setCompletedSources(payload.completedSources || totalSources);
              if (pendingResultsRef.current.length > 0) {
                const toAppend = pendingResultsRef.current;
                pendingResultsRef.current = [];
                if (flushTimerRef.current) {
                  clearTimeout(flushTimerRef.current);
                  flushTimerRef.current = null;
                }
                startTransition(() => {
                  setSearchResults((prev) => {
                    const newResults = prev.concat(toAppend);
                    try {
                      sessionStorage.setItem('cachedSearchQuery', trimmed);
                      sessionStorage.setItem('cachedSearchResults', JSON.stringify(newResults));
                      sessionStorage.setItem('cachedSearchState', JSON.stringify({
                        totalSources: payload.completedSources || totalSources,
                        completedSources: payload.completedSources || totalSources,
                      }));
                      sessionStorage.setItem('cachedSearchFilters', JSON.stringify({
                        filterAll,
                        filterAgg,
                      }));
                      sessionStorage.setItem('cachedViewMode', viewMode);
                    } catch (error) {
                      console.error('缓存搜索结果失败:', error);
                    }
                    return newResults;
                  });
                });
              } else {
                setTimeout(() => {
                  setSearchResults((prev) => {
                    try {
                      sessionStorage.setItem('cachedSearchQuery', trimmed);
                      sessionStorage.setItem('cachedSearchResults', JSON.stringify(prev));
                      sessionStorage.setItem('cachedSearchState', JSON.stringify({
                        totalSources: payload.completedSources || totalSources,
                        completedSources: payload.completedSources || totalSources,
                      }));
                      sessionStorage.setItem('cachedSearchFilters', JSON.stringify({
                        filterAll,
                        filterAgg,
                      }));
                      sessionStorage.setItem('cachedViewMode', viewMode);
                    } catch (error) {
                      console.error('缓存搜索结果失败:', error);
                    }
                    return prev;
                  });
                }, 100);
              }
              setIsLoading(false);
              try { es.close(); } catch { }
              if (eventSourceRef.current === es) {
                eventSourceRef.current = null;
              }
              break;
          }
        } catch { }
      };

      es.onerror = () => {
        setIsLoading(false);
        if (pendingResultsRef.current.length > 0) {
          const toAppend = pendingResultsRef.current;
          pendingResultsRef.current = [];
          if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          startTransition(() => {
            setSearchResults((prev) => prev.concat(toAppend));
          });
        }
        try { es.close(); } catch { }
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }
      };
    } else {
      // 传统搜索
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
        .then(response => response.json())
        .then(data => {
          if (currentQueryRef.current !== trimmed) {
            console.warn('忽略过期的搜索响应 (传统):', '当前查询:', currentQueryRef.current, '响应查询:', trimmed);
            return;
          }

          if (data.results && Array.isArray(data.results)) {
            const activeYearOrder = (viewMode === 'agg' ? (filterAgg.yearOrder) : (filterAll.yearOrder));
            const results: SearchResult[] =
              activeYearOrder === 'none'
                ? sortBatchForNoOrder(data.results as SearchResult[])
                : (data.results as SearchResult[]);

            setSearchResults(results);
            setTotalSources(1);
            setCompletedSources(1);

            try {
              sessionStorage.setItem('cachedSearchQuery', trimmed);
              sessionStorage.setItem('cachedSearchResults', JSON.stringify(results));
              sessionStorage.setItem('cachedSearchState', JSON.stringify({
                totalSources: 1,
                completedSources: 1,
              }));
              sessionStorage.setItem('cachedSearchFilters', JSON.stringify({
                filterAll,
                filterAgg,
              }));
              sessionStorage.setItem('cachedViewMode', viewMode);
            } catch (error) {
              console.error('缓存搜索结果失败:', error);
            }
          }
          setIsLoading(false);
        })
        .catch(() => {
          setIsLoading(false);
        });
    }

    // 保存到搜索历史
    addSearchHistory(trimmed);

    // 更新URL但不触发重新渲染
    const newUrl = `/search?q=${encodeURIComponent(trimmed)}`;
    window.history.replaceState(null, '', newUrl);
  };

  const getGroupRef = (key: string) => {
    let ref = groupRefs.current.get(key);
    if (!ref) {
      ref = React.createRef<VideoCardHandle>();
      groupRefs.current.set(key, ref);
    }
    return ref;
  };

  const computeGroupStats = (group: SearchResult[]) => {
    const episodes = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        const len = g.episodes?.length || 0;
        if (len > 0) countMap.set(len, (countMap.get(len) || 0) + 1);
      });
      let max = 0;
      let res = 0;
      countMap.forEach((v, k) => {
        if (v > max) { max = v; res = k; }
      });
      return res;
    })();
    const source_names = Array.from(new Set(group.map((g) => g.source_name).filter(Boolean))) as string[];

    const douban_id = (() => {
      const countMap = new Map<number, number>();
      group.forEach((g) => {
        if (g.douban_id && g.douban_id > 0) {
          countMap.set(g.douban_id, (countMap.get(g.douban_id) || 0) + 1);
        }
      });
      let max = 0;
      let res: number | undefined;
      countMap.forEach((v, k) => {
        if (v > max) { max = v; res = k; }
      });
      return res;
    })();

    return { episodes, source_names, douban_id };
  };
  // 过滤器：非聚合与聚合
  const [filterAll, setFilterAll] = useState<{ source: string; title: string; year: string; yearOrder: 'none' | 'asc' | 'desc' }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });
  const [filterAgg, setFilterAgg] = useState<{ source: string; title: string; year: string; yearOrder: 'none' | 'asc' | 'desc' }>({
    source: 'all',
    title: 'all',
    year: 'all',
    yearOrder: 'none',
  });

  // 获取默认聚合设置：只读取用户本地设置，默认为 true
  const getDefaultAggregate = () => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      if (userSetting !== null) {
        return JSON.parse(userSetting);
      }
    }
    return true; // 默认启用聚合
  };

  const [viewMode, setViewMode] = useState<'agg' | 'all'>(() => {
    return getDefaultAggregate() ? 'agg' : 'all';
  });

  // 在“无排序”场景用于每个源批次的预排序：完全匹配标题优先，其次年份倒序，未知年份最后
  const sortBatchForNoOrder = (items: SearchResult[]) => {
    const q = currentQueryRef.current.trim();
    return items.slice().sort((a, b) => {
      const aExact = (a.title || '').trim() === q;
      const bExact = (b.title || '').trim() === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aNum = Number.parseInt(a.year as any, 10);
      const bNum = Number.parseInt(b.year as any, 10);
      const aValid = !Number.isNaN(aNum);
      const bValid = !Number.isNaN(bNum);
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      if (aValid && bValid) return bNum - aNum; // 年份倒序
      return 0;
    });
  };

  // 检查搜索结果与关键字的相关性
  const isRelevantResult = (item: SearchResult, query: string) => {
    if (!query.trim()) return true;

    const searchTerms = query.trim().toLowerCase().split(/\s+/);
    const title = (item.title || '').toLowerCase();
    const typeName = (item.type_name || '').toLowerCase();

    // 至少匹配一个搜索关键字
    return searchTerms.some(term => {
      // 标题包含关键字
      if (title.includes(term)) return true;
      // 类型名包含关键字
      if (typeName.includes(term)) return true;
      // 支持年份搜索
      if (term.match(/^\d{4}$/) && item.year === term) return true;
      // 支持模糊匹配（去除空格和标点符号后的匹配）
      const cleanTitle = title.replace(/[\s\-_\.]/g, '');
      const cleanTerm = term.replace(/[\s\-_\.]/g, '');
      if (cleanTitle.includes(cleanTerm)) return true;

      return false;
    });
  };

  // 简化的年份排序：unknown/空值始终在最后
  const compareYear = (aYear: string, bYear: string, order: 'none' | 'asc' | 'desc') => {
    // 如果是无排序状态，返回0（保持原顺序）
    if (order === 'none') return 0;

    // 处理空值和unknown
    const aIsEmpty = !aYear || aYear === 'unknown';
    const bIsEmpty = !bYear || bYear === 'unknown';

    if (aIsEmpty && bIsEmpty) return 0;
    if (aIsEmpty) return 1; // a 在后
    if (bIsEmpty) return -1; // b 在后

    // 都是有效年份，按数字比较
    const aNum = parseInt(aYear, 10);
    const bNum = parseInt(bYear, 10);

    return order === 'asc' ? aNum - bNum : bNum - aNum;
  };

  // 聚合后的结果（按标题和年份分组）
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    const keyOrder: string[] = []; // 记录键出现的顺序

    searchResults.forEach((item) => {
      // 使用 title + year + type 作为键，year 必然存在，但依然兜底 'unknown'
      const key = `${item.title.replaceAll(' ', '')}-${item.year || 'unknown'
        }-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];

      // 如果是新的键，记录其顺序
      if (arr.length === 0) {
        keyOrder.push(key);
      }

      arr.push(item);
      map.set(key, arr);
    });

    // 按出现顺序返回聚合结果
    return keyOrder.map(key => [key, map.get(key)!] as [string, SearchResult[]]);
  }, [searchResults]);

  // 当聚合结果变化时，如果某个聚合已存在，则调用其卡片 ref 的 set 方法增量更新
  useEffect(() => {
    aggregatedResults.forEach(([mapKey, group]) => {
      const stats = computeGroupStats(group);
      const prev = groupStatsRef.current.get(mapKey);
      if (!prev) {
        // 第一次出现，记录初始值，不调用 ref（由初始 props 渲染）
        groupStatsRef.current.set(mapKey, stats);
        return;
      }
      // 对比变化并调用对应的 set 方法
      const ref = groupRefs.current.get(mapKey);
      if (ref && ref.current) {
        if (prev.episodes !== stats.episodes) {
          ref.current.setEpisodes(stats.episodes);
        }
        const prevNames = (prev.source_names || []).join('|');
        const nextNames = (stats.source_names || []).join('|');
        if (prevNames !== nextNames) {
          ref.current.setSourceNames(stats.source_names);
        }
        if (prev.douban_id !== stats.douban_id) {
          ref.current.setDoubanId(stats.douban_id);
        }
        groupStatsRef.current.set(mapKey, stats);
      }
    });
  }, [aggregatedResults]);

  // 构建筛选选项 - 只基于相关的搜索结果
  const filterOptions = useMemo(() => {
    const sourcesSet = new Map<string, string>();
    const titlesSet = new Set<string>();
    const yearsSet = new Set<string>();

    // 只考虑与搜索关键字相关的结果来构建过滤选项
    const relevantResults = searchResults.filter(item => isRelevantResult(item, searchQuery));

    relevantResults.forEach((item) => {
      if (item.source && item.source_name) {
        sourcesSet.set(item.source, item.source_name);
      }
      if (item.title) titlesSet.add(item.title);
      if (item.year) yearsSet.add(item.year);
    });

    const sourceOptions: { label: string; value: string }[] = [
      { label: '全部来源', value: 'all' },
      ...Array.from(sourcesSet.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ label, value })),
    ];

    const titleOptions: { label: string; value: string }[] = [
      { label: '全部标题', value: 'all' },
      ...Array.from(titlesSet.values())
        .sort((a, b) => a.localeCompare(b))
        .map((t) => ({ label: t, value: t })),
    ];

    // 年份: 将 unknown 放末尾
    const years = Array.from(yearsSet.values());
    const knownYears = years.filter((y) => y !== 'unknown').sort((a, b) => parseInt(b) - parseInt(a));
    const hasUnknown = years.includes('unknown');
    const yearOptions: { label: string; value: string }[] = [
      { label: '全部年份', value: 'all' },
      ...knownYears.map((y) => ({ label: y, value: y })),
      ...(hasUnknown ? [{ label: '未知', value: 'unknown' }] : []),
    ];

    const categoriesAll: SearchFilterCategory[] = [
      { key: 'source', label: '来源', options: sourceOptions },
      { key: 'title', label: '标题', options: titleOptions },
      { key: 'year', label: '年份', options: yearOptions },
    ];

    const categoriesAgg: SearchFilterCategory[] = [
      { key: 'source', label: '来源', options: sourceOptions },
      { key: 'title', label: '标题', options: titleOptions },
      { key: 'year', label: '年份', options: yearOptions },
    ];

    return { categoriesAll, categoriesAgg };
  }, [searchResults]);

  // 非聚合：应用筛选与排序
  const filteredAllResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAll;
    const filtered = searchResults.filter((item) => {
      // 首先检查相关性
      if (!isRelevantResult(item, searchQuery)) return false;
      // 然后应用其他过滤器
      if (source !== 'all' && item.source !== source) return false;
      if (title !== 'all' && item.title !== title) return false;
      if (year !== 'all' && item.year !== year) return false;
      return true;
    });

    // 如果是无排序状态，直接返回过滤后的原始顺序
    if (yearOrder === 'none') {
      return filtered;
    }

    // 简化排序：1. 年份排序，2. 年份相同时精确匹配在前，3. 标题排序
    return filtered.sort((a, b) => {
      // 首先按年份排序
      const yearComp = compareYear(a.year, b.year, yearOrder);
      if (yearComp !== 0) return yearComp;

      // 年份相同时，精确匹配在前
      const aExactMatch = a.title === searchQuery.trim();
      const bExactMatch = b.title === searchQuery.trim();
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 最后按标题排序，正序时字母序，倒序时反字母序
      return yearOrder === 'asc' ?
        a.title.localeCompare(b.title) :
        b.title.localeCompare(a.title);
    });
  }, [searchResults, filterAll, searchQuery]);

  // 聚合：应用筛选与排序
  const filteredAggResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAgg as any;
    const filtered = aggregatedResults.filter(([_, group]) => {
      // 检查聚合组中是否至少有一个结果与搜索关键字相关
      const hasRelevantResult = group.some(item => isRelevantResult(item, searchQuery));
      if (!hasRelevantResult) return false;

      const gTitle = group[0]?.title ?? '';
      const gYear = group[0]?.year ?? 'unknown';
      const hasSource = source === 'all' ? true : group.some((item) => item.source === source);
      if (!hasSource) return false;
      if (title !== 'all' && gTitle !== title) return false;
      if (year !== 'all' && gYear !== year) return false;
      return true;
    });

    // 如果是无排序状态，保持按关键字+年份+类型出现的原始顺序
    if (yearOrder === 'none') {
      return filtered;
    }

    // 简化排序：1. 年份排序，2. 年份相同时精确匹配在前，3. 标题排序
    return filtered.sort((a, b) => {
      // 首先按年份排序
      const aYear = a[1][0].year;
      const bYear = b[1][0].year;
      const yearComp = compareYear(aYear, bYear, yearOrder);
      if (yearComp !== 0) return yearComp;

      // 年份相同时，精确匹配在前
      const aExactMatch = a[1][0].title === searchQuery.trim();
      const bExactMatch = b[1][0].title === searchQuery.trim();
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      // 最后按标题排序，正序时字母序，倒序时反字母序
      const aTitle = a[1][0].title;
      const bTitle = b[1][0].title;
      return yearOrder === 'asc' ?
        aTitle.localeCompare(bTitle) :
        bTitle.localeCompare(aTitle);
    });
  }, [aggregatedResults, filterAgg, searchQuery]);

  useEffect(() => {
    // 无搜索参数时聚焦搜索框
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();

    // 初始加载搜索历史
    getSearchHistory().then(setSearchHistory);

    // 读取流式搜索设置
    if (typeof window !== 'undefined') {
      const savedFluidSearch = localStorage.getItem('fluidSearch');
      const defaultFluidSearch =
        (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
      if (savedFluidSearch !== null) {
        setUseFluidSearch(JSON.parse(savedFluidSearch));
      } else if (defaultFluidSearch !== undefined) {
        setUseFluidSearch(defaultFluidSearch);
      }
    }

    // 监听搜索历史更新事件
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (newHistory: string[]) => {
        setSearchHistory(newHistory);
      }
    );

    // 获取滚动位置的函数 - 专门针对 body 滚动
    const getScrollTop = () => {
      return document.body.scrollTop || 0;
    };

    // 使用 requestAnimationFrame 持续检测滚动位置
    let isRunning = false;
    const checkScrollPosition = () => {
      if (!isRunning) return;

      const scrollTop = getScrollTop();
      const shouldShow = scrollTop > 300;
      setShowBackToTop(shouldShow);

      // 计算滚动进度
      const documentHeight = document.body.scrollHeight - document.body.clientHeight;
      const progress = documentHeight > 0 ? Math.min((scrollTop / documentHeight) * 100, 100) : 0;
      setScrollProgress(progress);

      requestAnimationFrame(checkScrollPosition);
    };

    // 启动持续检测
    isRunning = true;
    checkScrollPosition();

    // 监听 body 元素的滚动事件
    const handleScroll = () => {
      const scrollTop = getScrollTop();
      setShowBackToTop(scrollTop > 300);

      // 计算滚动进度
      const documentHeight = document.body.scrollHeight - document.body.clientHeight;
      const progress = documentHeight > 0 ? Math.min((scrollTop / documentHeight) * 100, 100) : 0;
      setScrollProgress(progress);
    };

    document.body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      unsubscribe();
      isRunning = false; // 停止 requestAnimationFrame 循环

      // 移除 body 滚动事件监听器
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    // 当搜索参数变化时更新搜索状态
    const query = searchParams.get('q') || '';
    currentQueryRef.current = query.trim();

    if (query) {
      setSearchQuery(query);

      // 检查是否从播放页返回，如果是则尝试使用缓存
      const fromPlayPage = sessionStorage.getItem('fromPlayPage');
      const cachedQuery = sessionStorage.getItem('cachedSearchQuery');
      const cachedResults = sessionStorage.getItem('cachedSearchResults');
      const cachedState = sessionStorage.getItem('cachedSearchState');
      const cachedFilters = sessionStorage.getItem('cachedSearchFilters');
      const cachedViewMode = sessionStorage.getItem('cachedViewMode');

      if (fromPlayPage === 'true' && cachedQuery === query.trim() && cachedResults && cachedState) {
        // 从播放页返回且有缓存，使用缓存的搜索结果
        console.log('使用缓存的搜索结果');

        try {
          const results = JSON.parse(cachedResults);
          const state = JSON.parse(cachedState);

          // 恢复缓存的过滤器和视图状态
          if (cachedFilters) {
            const filters = JSON.parse(cachedFilters);
            if (filters.filterAll) setFilterAll(filters.filterAll);
            if (filters.filterAgg) setFilterAgg(filters.filterAgg);
          }

          if (cachedViewMode && ['agg', 'all'].includes(cachedViewMode)) {
            setViewMode(cachedViewMode as 'agg' | 'all');
          }

          // 恢复搜索结果和状态
          setSearchResults(results);
          setTotalSources(state.totalSources || 0);
          setCompletedSources(state.completedSources || 0);
          setIsLoading(false);
          setShowResults(true);

          // 清理导航标记，避免影响后续搜索
          sessionStorage.removeItem('fromPlayPage');

          return; // 直接返回，不执行新搜索
        } catch (error) {
          console.error('恢复缓存的搜索结果失败:', error);
          // 缓存损坏，清理缓存并继续正常搜索
          sessionStorage.removeItem('cachedSearchQuery');
          sessionStorage.removeItem('cachedSearchResults');
          sessionStorage.removeItem('cachedSearchState');
          sessionStorage.removeItem('cachedSearchFilters');
          sessionStorage.removeItem('cachedViewMode');
          sessionStorage.removeItem('fromPlayPage');
        }
      }

      // 执行新搜索 - 使用performSearch函数（不更新URL，因为URL已经由路由处理了）
      const trimmed = query.trim();

      // 清空旧的搜索结果和状态
      if (eventSourceRef.current) {
        try { eventSourceRef.current.close(); } catch { }
        eventSourceRef.current = null;
      }
      setSearchResults([]);
      setTotalSources(0);
      setCompletedSources(0);
      pendingResultsRef.current = [];
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      // 清理聚合统计缓存和refs
      groupStatsRef.current.clear();
      groupRefs.current.clear();
      setIsLoading(true);
      setShowResults(true);

      // 读取流式搜索设置
      let currentFluidSearch = useFluidSearch;
      if (typeof window !== 'undefined') {
        const savedFluidSearch = localStorage.getItem('fluidSearch');
        if (savedFluidSearch !== null) {
          currentFluidSearch = JSON.parse(savedFluidSearch);
        } else {
          const defaultFluidSearch = (window as any).RUNTIME_CONFIG?.FLUID_SEARCH !== false;
          currentFluidSearch = defaultFluidSearch;
        }
      }

      if (currentFluidSearch !== useFluidSearch) {
        setUseFluidSearch(currentFluidSearch);
      }

      if (currentFluidSearch) {
        // 流式搜索
        const es = new EventSource(`/api/search/ws?q=${encodeURIComponent(trimmed)}`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!event.data) return;
          try {
            const payload = JSON.parse(event.data);
            if (currentQueryRef.current !== trimmed || eventSourceRef.current !== es) {
              console.warn('忽略过期的搜索响应:', payload.type, '当前查询:', currentQueryRef.current, '响应查询:', trimmed);
              return;
            }
            switch (payload.type) {
              case 'start':
                setTotalSources(payload.totalSources || 0);
                setCompletedSources(0);
                break;
              case 'source_result': {
                setCompletedSources((prev) => prev + 1);
                if (Array.isArray(payload.results) && payload.results.length > 0) {
                  const activeYearOrder = (viewMode === 'agg' ? (filterAgg.yearOrder) : (filterAll.yearOrder));
                  const incoming: SearchResult[] =
                    activeYearOrder === 'none'
                      ? sortBatchForNoOrder(payload.results as SearchResult[])
                      : (payload.results as SearchResult[]);
                  pendingResultsRef.current.push(...incoming);
                  if (!flushTimerRef.current) {
                    flushTimerRef.current = window.setTimeout(() => {
                      const toAppend = pendingResultsRef.current;
                      pendingResultsRef.current = [];
                      startTransition(() => {
                        setSearchResults((prev) => prev.concat(toAppend));
                      });
                      flushTimerRef.current = null;
                    }, 80);
                  }
                }
                break;
              }
              case 'source_error':
                setCompletedSources((prev) => prev + 1);
                break;
              case 'complete':
                setCompletedSources(payload.completedSources || totalSources);
                if (pendingResultsRef.current.length > 0) {
                  const toAppend = pendingResultsRef.current;
                  pendingResultsRef.current = [];
                  if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                  }
                  startTransition(() => {
                    setSearchResults((prev) => {
                      const newResults = prev.concat(toAppend);
                      try {
                        sessionStorage.setItem('cachedSearchQuery', trimmed);
                        sessionStorage.setItem('cachedSearchResults', JSON.stringify(newResults));
                        sessionStorage.setItem('cachedSearchState', JSON.stringify({
                          totalSources: payload.completedSources || totalSources,
                          completedSources: payload.completedSources || totalSources,
                        }));
                        sessionStorage.setItem('cachedSearchFilters', JSON.stringify({
                          filterAll,
                          filterAgg,
                        }));
                        sessionStorage.setItem('cachedViewMode', viewMode);
                      } catch (error) {
                        console.error('缓存搜索结果失败:', error);
                      }
                      return newResults;
                    });
                  });
                } else {
                  setTimeout(() => {
                    setSearchResults((prev) => {
                      try {
                        sessionStorage.setItem('cachedSearchQuery', trimmed);
                        sessionStorage.setItem('cachedSearchResults', JSON.stringify(prev));
                        sessionStorage.setItem('cachedSearchState', JSON.stringify({
                          totalSources: payload.completedSources || totalSources,
                          completedSources: payload.completedSources || totalSources,
                        }));
                        sessionStorage.setItem('cachedSearchFilters', JSON.stringify({
                          filterAll,
                          filterAgg,
                        }));
                        sessionStorage.setItem('cachedViewMode', viewMode);
                      } catch (error) {
                        console.error('缓存搜索结果失败:', error);
                      }
                      return prev;
                    });
                  }, 100);
                }
                setIsLoading(false);
                try { es.close(); } catch { }
                if (eventSourceRef.current === es) {
                  eventSourceRef.current = null;
                }
                break;
            }
          } catch { }
        };

        es.onerror = () => {
          setIsLoading(false);
          if (pendingResultsRef.current.length > 0) {
            const toAppend = pendingResultsRef.current;
            pendingResultsRef.current = [];
            if (flushTimerRef.current) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            startTransition(() => {
              setSearchResults((prev) => prev.concat(toAppend));
            });
          }
          try { es.close(); } catch { }
          if (eventSourceRef.current === es) {
            eventSourceRef.current = null;
          }
        };
      } else {
        // 传统搜索
        fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
          .then(response => response.json())
          .then(data => {
            if (currentQueryRef.current !== trimmed) {
              console.warn('忽略过期的搜索响应 (传统):', '当前查询:', currentQueryRef.current, '响应查询:', trimmed);
              return;
            }

            if (data.results && Array.isArray(data.results)) {
              const activeYearOrder = (viewMode === 'agg' ? (filterAgg.yearOrder) : (filterAll.yearOrder));
              const results: SearchResult[] =
                activeYearOrder === 'none'
                  ? sortBatchForNoOrder(data.results as SearchResult[])
                  : (data.results as SearchResult[]);

              setSearchResults(results);
              setTotalSources(1);
              setCompletedSources(1);

              try {
                sessionStorage.setItem('cachedSearchQuery', trimmed);
                sessionStorage.setItem('cachedSearchResults', JSON.stringify(results));
                sessionStorage.setItem('cachedSearchState', JSON.stringify({
                  totalSources: 1,
                  completedSources: 1,
                }));
                sessionStorage.setItem('cachedSearchFilters', JSON.stringify({
                  filterAll,
                  filterAgg,
                }));
                sessionStorage.setItem('cachedViewMode', viewMode);
              } catch (error) {
                console.error('缓存搜索结果失败:', error);
              }
            }
            setIsLoading(false);
          })
          .catch(() => {
            setIsLoading(false);
          });
      }

      setShowSuggestions(false);
      // 保存到搜索历史
      addSearchHistory(trimmed);
    } else {
      setShowResults(false);
      setShowSuggestions(false);
    }
  }, [searchParams]);

  // 组件卸载时，关闭可能存在的连接并清理所有状态
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        try { eventSourceRef.current.close(); } catch { }
        eventSourceRef.current = null;
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingResultsRef.current = [];
      // 清理聚合统计缓存和refs，防止状态泄露
      groupStatsRef.current.clear();
      groupRefs.current.clear();
      // 重置当前查询引用
      currentQueryRef.current = '';
    };
  }, []);

  // 输入框内容变化时触发，显示搜索建议
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (value.trim()) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  };

  // 搜索框聚焦时触发，显示搜索建议
  const handleInputFocus = () => {
    if (searchQuery.trim()) {
      setShowSuggestions(true);
    }
  };

  // 搜索表单提交时触发，处理搜索逻辑
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    setShowSuggestions(false);
    // 直接调用搜索函数
    performSearch(trimmed);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setShowSuggestions(false);
    // 直接调用搜索函数
    performSearch(suggestion);
  };

  // 返回顶部功能
  const scrollToTop = () => {
    try {
      // 根据调试结果，真正的滚动容器是 document.body
      document.body.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (error) {
      // 如果平滑滚动完全失败，使用立即滚动
      document.body.scrollTop = 0;
    }
  };

  return (
    <PageLayout activePath='/search'>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10'>
        {/* 搜索框 */}
        <div className='mb-8'>
          <form onSubmit={handleSearch} className='max-w-2xl mx-auto'>
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500' />
              <input
                id='searchInput'
                type='text'
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                placeholder='搜索电影、电视剧、短剧...'
                autoComplete="off"
                className='w-full h-12 rounded-lg bg-gray-50/80 py-3 pl-10 pr-12 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white border border-gray-200/50 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 dark:border-gray-700'
              />

              {/* 清除按钮 */}
              {searchQuery && (
                <button
                  type='button'
                  onClick={() => {
                    setSearchQuery('');
                    setShowSuggestions(false);
                    document.getElementById('searchInput')?.focus();
                  }}
                  className='absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors dark:text-gray-500 dark:hover:text-gray-300'
                  aria-label='清除搜索内容'
                >
                  <X className='h-5 w-5' />
                </button>
              )}

              {/* 搜索建议 */}
              <SearchSuggestions
                query={searchQuery}
                isVisible={showSuggestions}
                onSelect={handleSuggestionSelect}
                onClose={() => setShowSuggestions(false)}
                onEnterKey={() => {
                  // 当用户按回车键时，使用搜索框的实际内容进行搜索
                  const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
                  if (!trimmed) return;

                  setShowSuggestions(false);
                  // 直接调用搜索函数
                  performSearch(trimmed);
                }}
              />
            </div>
          </form>
        </div>

        {/* 搜索结果或搜索历史 */}
        <div className='max-w-[95%] mx-auto mt-12 overflow-visible'>
          {showResults ? (
            <section className='mb-12'>
              {/* 标题 */}
              <div className='mb-4'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  搜索结果
                  {totalSources > 0 && useFluidSearch && (
                    <span className='ml-2 text-sm font-normal text-gray-500 dark:text-gray-400'>
                      {completedSources}/{totalSources}
                    </span>
                  )}
                  {isLoading && useFluidSearch && (
                    <span className='ml-2 inline-block align-middle'>
                      <span className='inline-block h-3 w-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin'></span>
                    </span>
                  )}
                </h2>
              </div>
              {/* 筛选器 + 聚合开关 同行 */}
              <div className='mb-8 flex items-center justify-between gap-3'>
                <div className='flex-1 min-w-0'>
                  {viewMode === 'agg' ? (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAgg}
                      values={filterAgg}
                      onChange={(v) => setFilterAgg(v as any)}
                    />
                  ) : (
                    <SearchResultFilter
                      categories={filterOptions.categoriesAll}
                      values={filterAll}
                      onChange={(v) => setFilterAll(v as any)}
                    />
                  )}
                </div>
                {/* 聚合开关 */}
                <label className='flex items-center gap-2 cursor-pointer select-none shrink-0'>
                  <span className='text-xs sm:text-sm text-gray-700 dark:text-gray-300'>聚合</span>
                  <div className='relative'>
                    <input
                      type='checkbox'
                      className='sr-only peer'
                      checked={viewMode === 'agg'}
                      onChange={() => setViewMode(viewMode === 'agg' ? 'all' : 'agg')}
                    />
                    <div className='w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-blue-500 transition-colors dark:bg-gray-600'></div>
                    <div className='absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4'></div>
                  </div>
                </label>
              </div>
              {searchResults.length === 0 ? (
                isLoading ? (
                  <div className='flex justify-center items-center h-40'>
                    <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500'></div>
                  </div>
                ) : (
                  <div className='text-center text-gray-500 py-8 dark:text-gray-400'>
                    未找到相关结果
                  </div>
                )
              ) : (
                <div
                  key={`search-results-${viewMode}`}
                  className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'
                >
                  {viewMode === 'agg'
                    ? filteredAggResults.map(([mapKey, group]) => {
                      const title = group[0]?.title || '';
                      const poster = group[0]?.poster || '';
                      const year = group[0]?.year || 'unknown';
                      const { episodes, source_names, douban_id } = computeGroupStats(group);
                      const type = episodes === 1 ? 'movie' : 'tv';

                      // 如果该聚合第一次出现，写入初始统计
                      if (!groupStatsRef.current.has(mapKey)) {
                        groupStatsRef.current.set(mapKey, { episodes, source_names, douban_id });
                      }

                      return (
                        <div key={`agg-${mapKey}`} className='w-full'>
                          <VideoCard
                            ref={getGroupRef(mapKey)}
                            from='search'
                            isAggregate={true}
                            title={title}
                            poster={poster}
                            year={year}
                            episodes={episodes}
                            source_names={source_names}
                            douban_id={douban_id}
                            query={
                              searchQuery.trim() !== title
                                ? searchQuery.trim()
                                : ''
                            }
                            type={type}
                          />
                        </div>
                      );
                    })
                    : filteredAllResults.map((item) => (
                      <div
                        key={`all-${item.source}-${item.id}`}
                        className='w-full'
                      >
                        <VideoCard
                          id={item.id}
                          title={item.title}
                          poster={item.poster}
                          episodes={item.episodes.length}
                          source={item.source}
                          source_name={item.source_name}
                          douban_id={item.douban_id}
                          query={
                            searchQuery.trim() !== item.title
                              ? searchQuery.trim()
                              : ''
                          }
                          year={item.year}
                          from='search'
                          type={item.episodes.length > 1 ? 'tv' : 'movie'}
                        />
                      </div>
                    ))}
                </div>
              )}
            </section>
          ) : searchHistory.length > 0 ? (
            // 搜索历史
            <section className='mb-12'>
              <h2 className='mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200'>
                搜索历史
                {searchHistory.length > 0 && (
                  <button
                    onClick={() => {
                      clearSearchHistory(); // 事件监听会自动更新界面
                    }}
                    className='ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500'
                  >
                    清空
                  </button>
                )}
              </h2>
              <div className='flex flex-wrap gap-2'>
                {searchHistory.map((item) => (
                  <div key={item} className='relative group'>
                    <button
                      onClick={() => {
                        // 直接调用搜索函数
                        performSearch(item.trim());
                      }}
                      className='px-4 py-2 bg-gray-500/10 hover:bg-gray-300 rounded-full text-sm text-gray-700 transition-colors duration-200 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
                    >
                      {item}
                    </button>
                    {/* 删除按钮 */}
                    <button
                      aria-label='删除搜索历史'
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        deleteSearchHistory(item); // 事件监听会自动更新界面
                      }}
                      className='absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* 返回顶部悬浮按钮 - 科技风格 */}
      <div
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] transition-all duration-300 ease-in-out ${showBackToTop
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
      >
        <button
          onClick={scrollToTop}
          className='relative w-14 h-14 bg-gradient-to-br from-blue-500/20 via-cyan-500/20 to-purple-500/20 backdrop-blur-xl rounded-full shadow-2xl transition-all duration-300 ease-out group hover:scale-110 hover:shadow-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-400/50 border border-white/20'
          aria-label={`返回顶部 (${Math.round(scrollProgress)}%)`}
          style={{
            background: `conic-gradient(from 0deg, #3b82f6 ${scrollProgress * 3.6}deg, rgba(59, 130, 246, 0.1) ${scrollProgress * 3.6}deg)`
          }}
        >
          {/* 内部发光圆圈 */}
          <div className='absolute inset-1 bg-gradient-to-br from-blue-500/30 to-cyan-500/30 rounded-full backdrop-blur-sm flex items-center justify-center transition-all duration-300 group-hover:from-blue-400/40 group-hover:to-cyan-400/40'>
            <ChevronUp className='w-6 h-6 text-white/90 transition-all duration-300 group-hover:scale-110 group-hover:text-white drop-shadow-lg' />
          </div>

          {/* 进度环 */}
          <svg className='absolute inset-0 w-full h-full -rotate-90' viewBox='0 0 56 56'>
            <circle
              cx='28'
              cy='28'
              r='25'
              fill='none'
              stroke='rgba(255, 255, 255, 0.1)'
              strokeWidth='2'
            />
            <circle
              cx='28'
              cy='28'
              r='25'
              fill='none'
              stroke='url(#progressGradient)'
              strokeWidth='2'
              strokeLinecap='round'
              strokeDasharray={`${(scrollProgress / 100) * 157} 157`}
              className='transition-all duration-300 ease-out'
            />
            <defs>
              <linearGradient id='progressGradient' x1='0%' y1='0%' x2='100%' y2='100%'>
                <stop offset='0%' stopColor='#3b82f6' />
                <stop offset='50%' stopColor='#06b6d4' />
                <stop offset='100%' stopColor='#8b5cf6' />
              </linearGradient>
            </defs>
          </svg>

          {/* 悬停时的进度提示 */}
          <div className='absolute -top-12 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none'>
            <div className='bg-gray-900/90 text-white text-xs px-3 py-1.5 rounded-lg backdrop-blur-sm border border-white/10 shadow-xl'>
              <div className='text-center font-medium'>
                {Math.round(scrollProgress)}%
              </div>
              <div className='w-2 h-2 bg-gray-900/90 rotate-45 absolute -bottom-1 left-1/2 transform -translate-x-1/2 border-r border-b border-white/10'></div>
            </div>
          </div>

          {/* 脉冲动画 */}
          <div className='absolute inset-0 rounded-full bg-gradient-to-br from-blue-400/20 to-cyan-400/20 animate-pulse opacity-0 group-hover:opacity-100 transition-opacity duration-300'></div>
        </button>
      </div>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
