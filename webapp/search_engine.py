#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1688 图搜引擎模块
优先使用 API 直连方式，Playwright 浏览器自动化作为兜底
"""

import os
import json
import time
import math
import threading
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

# 导入 API 直连模块
try:
    from search_api import get_api_client
    API_AVAILABLE = True
except ImportError:
    API_AVAILABLE = False
    get_api_client = None

# 配置
USE_API_FIRST = True  # 优先使用 API 直连
IMAGE_SEARCH_URL = "https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&kj_agent_plugin=dianleida"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BROWSER_DATA_DIR = os.path.join(BASE_DIR, "browser_data")

# Chrome 路径和用户数据目录（用于复用系统 Chrome 的登录状态）
def get_chrome_path():
    """获取系统 Chrome 可执行文件路径"""
    possible_paths = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for path in possible_paths:
        if os.path.exists(path):
            return path
    return None

# 使用 Chrome 副本的用户数据目录（复制过来的，不影响原 Chrome）
CHROME_DATA_COPY = os.path.join(BASE_DIR, "browser_data_chrome")

# 是否使用系统 Chrome + 复制的用户数据（复用登录状态）
USE_SYSTEM_CHROME = False

# 通过 CDP 连接现有浏览器（复用用户当前浏览器的登录状态）
# 设置为 True 时，需要先以 --remote-debugging-port=9222 启动浏览器
USE_CDP_CONNECTION = True
CDP_ENDPOINT = "http://localhost:9222"


class SearchEngine:
    """1688 图搜搜索引擎"""

    def __init__(self, headless=False):
        self.headless = headless
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        self._initialized = False
        self._is_cdp_connection = False  # 是否是 CDP 连接模式

    def initialize(self):
        """初始化浏览器"""
        if self._initialized:
            return

        if sync_playwright is None:
            raise RuntimeError("请先安装 playwright: pip install playwright && playwright install chromium")

        self.playwright = sync_playwright().start()

        # 优先尝试 CDP 连接现有浏览器
        cdp_success = False
        if USE_CDP_CONNECTION:
            try:
                print(f"[INFO] 尝试连接现有浏览器: {CDP_ENDPOINT}")
                self.browser = self.playwright.chromium.connect_over_cdp(CDP_ENDPOINT)
                
                # 获取默认 context
                if self.browser.contexts:
                    self.context = self.browser.contexts[0]
                else:
                    self.context = self.browser.new_context()
                
                self._is_cdp_connection = True
                cdp_success = True
                print("[INFO] ✅ 成功连接到现有浏览器")
            except Exception as e:
                print(f"[INFO] CDP 连接失败: {e}")
                print("[INFO] 回退到启动新浏览器模式")

        # 如果 CDP 连接失败，启动新浏览器
        if not cdp_success:
            # 配置启动参数
            launch_args = [
                '--disable-blink-features=AutomationControlled',
                '--no-default-browser-check',
                '--no-sandbox',
                '--disable-dev-shm-usage',
            ]

            # 决定使用哪个浏览器和用户数据目录
            chrome_path = get_chrome_path()

            if USE_SYSTEM_CHROME and chrome_path and os.path.exists(CHROME_DATA_COPY):
                # 使用系统 Chrome + 复制的用户数据（复用登录状态，不影响原 Chrome）
                print(f"[INFO] 使用系统 Chrome: {chrome_path}")
                print(f"[INFO] 用户数据目录: {CHROME_DATA_COPY}")

                # 清理锁文件
                lock_file = os.path.join(CHROME_DATA_COPY, "SingletonLock")
                if os.path.exists(lock_file):
                    try:
                        os.remove(lock_file)
                        print("[INFO] 已清理锁文件")
                    except:
                        pass

                self.context = self.playwright.chromium.launch_persistent_context(
                    user_data_dir=CHROME_DATA_COPY,
                    headless=self.headless,
                    executable_path=chrome_path,
                    args=launch_args,
                    viewport={'width': 1280, 'height': 800},
                )
            else:
                # 使用 Playwright 自带的 Chromium
                os.makedirs(BROWSER_DATA_DIR, exist_ok=True)

                # 清理锁文件
                lock_file = os.path.join(BROWSER_DATA_DIR, "SingletonLock")
                if os.path.exists(lock_file):
                    try:
                        os.remove(lock_file)
                    except:
                        pass

                self.context = self.playwright.chromium.launch_persistent_context(
                    user_data_dir=BROWSER_DATA_DIR,
                    headless=self.headless,
                    args=launch_args,
                    viewport={'width': 1280, 'height': 800},
                )

        # 获取或创建页面
        if self.context.pages:
            self.page = self.context.pages[0]
        else:
            self.page = self.context.new_page()

        # CDP 模式下尽早注入 API 拦截器
        if self._is_cdp_connection:
            try:
                self._inject_api_interceptor()
                print("[INFO] 已注入 API 响应拦截器")
            except Exception as e:
                print(f"[WARN] 注入 API 拦截器失败: {e}")

        # 打开图搜页面
        try:
            self.page.goto(IMAGE_SEARCH_URL, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            print(f"[WARN] 打开页面时出错: {e}")

        # 页面加载后再次注入（确保覆盖所有情况）
        if self._is_cdp_connection:
            try:
                self.page.wait_for_load_state("domcontentloaded", timeout=5000)
            except:
                pass
            try:
                self._inject_api_interceptor()
                print("[INFO] 页面加载后重新注入 API 拦截器")
            except Exception as e:
                print(f"[WARN] 重新注入拦截器失败: {e}")

        self._initialized = True
        print("[INFO] 搜索引擎初始化完成")

    def close(self):
        """关闭浏览器"""
        if self._is_cdp_connection:
            # CDP 模式下只断开连接，不关闭浏览器（用户还要用）
            print("[INFO] 断开与浏览器的 CDP 连接（浏览器保持打开）")
            if self.browser:
                self.browser.close()  # 这只是断开连接，不会关闭浏览器
        else:
            if self.context:
                self.context.close()
        if self.playwright:
            self.playwright.stop()
        self._initialized = False

    def _handle_slider_captcha(self, max_attempts=3):
        """处理滑块验证"""
        for attempt in range(max_attempts):
            slider = None
            slider_selectors = [
                '.nc_iconfont.btn_slide', '#nc_1_n1z', '.btn_slide',
                '.slider-btn', '[class*="slide"]', '[class*="slider"]',
            ]

            for sel in slider_selectors:
                try:
                    el = self.page.query_selector(sel)
                    if el and el.is_visible():
                        slider = el
                        break
                except:
                    continue

            if slider is None:
                try:
                    page_text = self.page.inner_text('body', timeout=2000)
                    if '滑块' not in page_text and '滑动' not in page_text:
                        return True
                except:
                    pass
                if attempt == 0:
                    return True
                continue

            try:
                slider_box = slider.bounding_box()
                if not slider_box:
                    continue

                track_width = slider_box['width'] * 6
                track_selectors = ['.nc_container', '.nc-lang-cnt', '.slide-track']
                for tsel in track_selectors:
                    try:
                        track = self.page.query_selector(tsel)
                        if track and track.is_visible():
                            track_box = track.bounding_box()
                            if track_box:
                                track_width = track_box['width']
                                break
                    except:
                        continue

                start_x = slider_box['x'] + slider_box['width'] / 2
                start_y = slider_box['y'] + slider_box['height'] / 2
                end_x = start_x + track_width - slider_box['width'] - 5

                self.page.mouse.move(start_x, start_y)
                time.sleep(0.1)
                self.page.mouse.down()
                time.sleep(0.1)

                steps = 20
                for i in range(steps):
                    progress = (i + 1) / steps
                    eased = 1 - math.pow(1 - progress, 2)
                    current_x = start_x + (end_x - start_x) * eased
                    jitter_y = start_y + (0.5 - (i % 3) * 0.5) * 2
                    self.page.mouse.move(current_x, jitter_y)
                    time.sleep(0.02 + (1 - eased) * 0.03)

                time.sleep(0.05)
                self.page.mouse.move(end_x, start_y)
                time.sleep(0.1)
                self.page.mouse.up()
                time.sleep(2)

                try:
                    if not slider.is_visible():
                        return True
                except:
                    pass

            except Exception as e:
                print(f"[滑块验证] 出错: {e}")
                time.sleep(1)

        return False

    def _deep_find_normalization_score(self, data):
        """
        深度递归查找所有包含 normalizationScore 的商品数据
        返回找到的所有商品数据列表
        """
        results = []
        if not data:
            return results

        if isinstance(data, dict):
            # 检查当前字典是否包含 normalizationScore
            if 'normalizationScore' in data:
                product = self._extract_product_info(data)
                if product and product.get('similarity') is not None:
                    results.append(product)

            # 检查常见的商品数据结构
            for key in ['data', 'result', 'items', 'list', 'offers', 'products', 'OFFER']:
                if key in data and isinstance(data[key], (dict, list)):
                    results.extend(self._deep_find_normalization_score(data[key]))

            # 递归所有值
            for key, value in data.items():
                if isinstance(value, (dict, list)) and key not in ['data', 'result', 'items', 'list', 'offers', 'products', 'OFFER']:
                    results.extend(self._deep_find_normalization_score(value))

        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    # 检查列表项是否包含 normalizationScore
                    if 'normalizationScore' in item:
                        product = self._extract_product_info(item)
                        if product and product.get('similarity') is not None:
                            results.append(product)
                if isinstance(item, (dict, list)):
                    results.extend(self._deep_find_normalization_score(item))

        return results

    def _extract_from_api_response(self, data):
        """从API响应中递归提取商品信息"""
        results = []
        if not data:
            return results

        if isinstance(data, dict):
            # 1688 mtop接口格式
            offer_items = data.get('data', {}).get('data', {}).get('OFFER', {}).get('items', [])
            if offer_items and isinstance(offer_items, list):
                for item in offer_items:
                    item_data = item.get('data', {})
                    if item_data:
                        product = self._extract_product_info(item_data)
                        if product:
                            results.append(product)
                if results:
                    return results

            # 另一种常见格式: data.data.items
            items = data.get('data', {}).get('items', [])
            if items and isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        product = self._extract_product_info(item)
                        if product:
                            results.append(product)
                if results:
                    return results

            # 深度搜索 normalizationScore
            deep_results = self._deep_find_normalization_score(data)
            if deep_results:
                results.extend(deep_results)

            # 递归检查其他字段
            for key, value in data.items():
                if isinstance(value, (dict, list)):
                    results.extend(self._extract_from_api_response(value))

        elif isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    product = self._extract_product_info(item)
                    if product:
                        results.append(product)
                if isinstance(item, (dict, list)):
                    results.extend(self._extract_from_api_response(item))

        # 去重
        seen = set()
        unique_results = []
        for r in results:
            key = r.get('offer_id', '') or r.get('url', '')
            if key and key not in seen:
                seen.add(key)
                unique_results.append(r)

        return unique_results

    def _extract_product_info(self, item_data):
        """从商品数据中提取信息"""
        if not isinstance(item_data, dict):
            return None

        product = {}

        # 商品ID
        offer_id = item_data.get('offerId', '')
        if offer_id:
            product['offer_id'] = str(offer_id)

        # 标题
        title = ''
        title_tags = item_data.get('titleTags', [])
        if title_tags and isinstance(title_tags, list):
            for tag in title_tags:
                if isinstance(tag, dict):
                    text = tag.get('text', '')
                    if text and len(text) > 5:
                        title = text
                        break
        if not title:
            for key in ['subject', 'title', 'goodsName', 'offerTitle']:
                if key in item_data and item_data[key]:
                    title = str(item_data[key])
                    break
        if title:
            product['title'] = title

        # 相似度分数 normalizationScore
        norm_score = item_data.get('normalizationScore')
        if norm_score is not None:
            try:
                product['similarity'] = float(norm_score)
                product['score_type'] = 'normalizationScore'
            except (ValueError, TypeError):
                pass

        # trackInfo里的相似度
        if product.get('similarity') is None:
            track_info = item_data.get('trackInfo', {})
            if isinstance(track_info, dict):
                ui_track = track_info.get('uiTrackInfo', {})
                if isinstance(ui_track, dict):
                    click_info = ui_track.get('click', {})
                    if isinstance(click_info, dict):
                        args = click_info.get('args', {})
                        if isinstance(args, dict):
                            norm_score = args.get('normalizationScore')
                            if norm_score is not None:
                                try:
                                    product['similarity'] = float(norm_score)
                                    product['score_type'] = 'trackInfo'
                                except (ValueError, TypeError):
                                    pass

        # 深度递归查找 normalizationScore（在 item_data 的任何嵌套层级）
        if product.get('similarity') is None:
            def find_norm_score(obj, depth=0, max_depth=10):
                """递归查找 normalizationScore"""
                if depth > max_depth or obj is None:
                    return None
                if isinstance(obj, dict):
                    if 'normalizationScore' in obj:
                        return obj['normalizationScore']
                    for key, val in obj.items():
                        if isinstance(val, (dict, list)):
                            result = find_norm_score(val, depth + 1, max_depth)
                            if result is not None:
                                return result
                elif isinstance(obj, list):
                    for item in obj:
                        if isinstance(item, (dict, list)):
                            result = find_norm_score(item, depth + 1, max_depth)
                            if result is not None:
                                return result
                return None

            deep_score = find_norm_score(item_data)
            if deep_score is not None:
                try:
                    product['similarity'] = float(deep_score)
                    product['score_type'] = 'normalizationScore_deep'
                except (ValueError, TypeError):
                    pass

        # 商品图片
        img_url = item_data.get('offerPicUrl') or item_data.get('odPicUrl') or item_data.get('imgUrl')
        if img_url:
            if img_url.startswith('//'):
                img_url = 'https:' + img_url
            product['image'] = img_url

        # 商品URL
        link_url = item_data.get('linkUrl', '')
        if link_url:
            if link_url.startswith('//'):
                link_url = 'https:' + link_url
            product['url'] = link_url
        elif offer_id:
            product['url'] = f"https://detail.1688.com/offer/{offer_id}.html"

        # 店铺名
        shop_name = item_data.get('loginId') or item_data.get('companyName') or item_data.get('shopName')
        if shop_name:
            product['shop'] = str(shop_name)

        # 价格
        price = None
        price_info = item_data.get('priceInfo', {})
        if isinstance(price_info, dict):
            for pk in ['price', 'showPrice', 'currentPrice']:
                if pk in price_info and price_info[pk]:
                    price = str(price_info[pk])
                    break
        if not price:
            for key in ['price', 'priceRange', 'showPrice']:
                if key in item_data and item_data[key]:
                    val = item_data[key]
                    if isinstance(val, str) and val:
                        price = val
                        break
                    elif isinstance(val, (int, float)):
                        price = str(val)
                        break
        if price:
            if price.replace('.', '').isdigit():
                price = '¥' + price
            elif not price.startswith('¥') and any(c.isdigit() for c in price):
                price = '¥' + price
            product['price'] = price

        if product.get('offer_id') or product.get('similarity') is not None or product.get('url'):
            return product
        return None

    def _extract_from_page(self):
        """从页面DOM提取结果（兜底方案）"""
        try:
            results = self.page.evaluate("""
                () => {
                    const results = [];
                    const seen = new Set();

                    // 方案1: 使用精确的商品卡片选择器 searchOfferWrapper
                    const offerCards = document.querySelectorAll('[class*="searchOfferWrapper"]');
                    if (offerCards.length > 0) {
                        console.log('[Extractor] 找到商品卡片:', offerCards.length);
                        
                        offerCards.forEach((card, idx) => {
                            if (idx >= 60) return;
                            
                            // 从卡片自身的 aplusReport 获取相似度（data-aplus-report 在卡片元素本身）
                            let normScore = null;
                            let offerId = '';
                            
                            // 直接检查卡片自身的 dataset
                            let aplusEl = null;
                            if (card.dataset && card.dataset.aplusReport) {
                                aplusEl = card;
                            }
                            
                            // 如果卡片自身没有，在子元素中找
                            if (!aplusEl) {
                                aplusEl = card.querySelector('[data-aplus-report]');
                            }
                            
                            // 如果还没有，往上找祖先
                            if (!aplusEl) {
                                let parent = card.parentElement;
                                let depth = 0;
                                while (parent && depth < 10) {
                                    if (parent.dataset && parent.dataset.aplusReport) {
                                        aplusEl = parent;
                                        break;
                                    }
                                    parent = parent.parentElement;
                                    depth++;
                                }
                            }
                            
                            if (aplusEl) {
                                const report = aplusEl.dataset.aplusReport || '';
                                
                                // 提取 offerId
                                const trackIdMatch = report.match(/serverTrackId@[^_]+_([\\d]+)_/);
                                if (trackIdMatch) {
                                    offerId = trackIdMatch[1];
                                }
                                
                                // 提取 aitheta_min_score (normalizationScore)
                                const scoreMatch = report.match(/aitheta_min_score:([\\d.]+)/);
                                if (scoreMatch) {
                                    normScore = parseFloat(scoreMatch[1]);
                                }
                                
                                if (normScore === null) {
                                    const normMatch = report.match(/normalizationScore:([\\d.]+)/);
                                    if (normMatch) {
                                        normScore = parseFloat(normMatch[1]);
                                    }
                                }
                            }
                            
                            // 提取图片
                            let image = '';
                            let title = '';
                            const img = card.querySelector('img');
                            if (img) {
                                const imgSrc = img.src || img.getAttribute('data-src') || '';
                                if (imgSrc) {
                                    image = imgSrc.startsWith('//') ? 'https:' + imgSrc : imgSrc;
                                }
                                title = img.alt || '';
                            }
                            
                            // 提取链接
                            let url = '';
                            const link = card.querySelector('a[href*="offer"], a[href*="detail"], a[href*="air.1688"]');
                            if (link) {
                                url = link.href;
                            }
                            
                            // 提取标题 - 优先从卡片文本第一行获取
                            if (!title || title.length < 5) {
                                // 获取卡片内所有文本节点，找最长的非价格文本
                                const allTexts = [];
                                const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, null);
                                let node;
                                while (node = walker.nextNode()) {
                                    const text = (node.nodeValue || '').trim();
                                    if (text && text.length > 8 && text.length < 150 && !text.startsWith('¥') && !text.includes('运费')) {
                                        allTexts.push(text);
                                    }
                                }
                                if (allTexts.length > 0) {
                                    // 取最长的作为标题
                                    allTexts.sort((a, b) => b.length - a.length);
                                    title = allTexts[0];
                                }
                            }
                            
                            // 提取价格 - 使用精确选择器
                            let price = '';
                            const priceEl = card.querySelector('[class*="priceItem"], [class*="offerPrice"]');
                            if (priceEl) {
                                const priceText = (priceEl.innerText || '').replace(/\\s+/g, '');
                                const priceMatch = priceText.match(/¥([\\d.]+)/);
                                if (priceMatch) {
                                    price = '¥' + priceMatch[1];
                                }
                            }
                            if (!price) {
                                const priceMatch = (card.innerText || '').match(/¥\\s*([\\d.]+)/);
                                if (priceMatch) {
                                    price = '¥' + priceMatch[1];
                                }
                            }
                            
                            // 提取店铺名 - 使用精确选择器
                            let shop = '';
                            const shopEl = card.querySelector('[class*="shopName"]');
                            if (shopEl) {
                                shop = (shopEl.innerText || '').trim();
                            }
                            if (!shop) {
                                const shopEls = card.querySelectorAll('[class*="company"], [class*="shop"], [class*="store"], [class*="seller"], [class*="factory"]');
                                for (const el of shopEls) {
                                    const text = (el.innerText || '').trim();
                                    if (text && text.length > 2 && text.length < 60 && !text.includes('¥') && !text.includes('运费')) {
                                        shop = text;
                                        break;
                                    }
                                }
                            }
                            
                            // 去重
                            const uniqueKey = offerId || url || (title + price);
                            if (seen.has(uniqueKey)) return;
                            seen.add(uniqueKey);
                            
                            // 至少要有标题或图片
                            if (!title && !image) return;
                            
                            const item = {
                                title: title,
                                price: price,
                                shop: shop,
                                url: url || '',
                                offer_id: offerId,
                                rank: idx + 1
                            };
                            
                            if (image) item.image = image;
                            
                            if (normScore !== null && !isNaN(normScore)) {
                                item.similarity = normScore;
                                item.score_type = 'normalizationScore';
                            } else {
                                // 禁止伪造排名分数；没有真实字段时明确返回空值
                                item.similarity = null;
                                item.score_type = 'unavailable';
                            }
                            
                            results.push(item);
                        });
                        
                        if (results.length > 0) {
                            return results;
                        }
                    }
                    
                    // 方案2: 从 aplusReport 元素中提取（兜底）
                    const aplusCards = document.querySelectorAll('[data-aplus-report]');
                    if (aplusCards.length > 0) {
                        console.log('[Extractor] 从 aplusReport 提取');
                        let validCount = 0;
                        aplusCards.forEach((card, idx) => {
                            const report = card.dataset.aplusReport || '';
                            
                            // 只处理有图片或链接的元素（认为是商品）
                            const img = card.querySelector('img');
                            const link = card.querySelector('a[href*="offer"], a[href*="detail"]');
                            if (!img && !link) return;
                            
                            if (validCount >= 60) return;
                            validCount++;
                            
                            let offerId = '';
                            const trackIdMatch = report.match(/serverTrackId@[^_]+_([\\d]+)_/);
                            if (trackIdMatch) {
                                offerId = trackIdMatch[1];
                            }
                            
                            let normScore = null;
                            const scoreMatch = report.match(/aitheta_min_score:([\\d.]+)/);
                            if (scoreMatch) {
                                normScore = parseFloat(scoreMatch[1]);
                            }
                            
                            if (normScore === null) {
                                const normMatch = report.match(/normalizationScore:([\\d.]+)/);
                                if (normMatch) {
                                    normScore = parseFloat(normMatch[1]);
                                }
                            }
                            
                            const href = link ? link.href : '';
                            const uniqueKey = offerId || href || idx;
                            if (seen.has(uniqueKey)) return;
                            seen.add(uniqueKey);
                            
                            let title = '';
                            let image = '';
                            let price = '';
                            let shop = '';
                            
                            if (img) {
                                const imgSrc = img.src || img.getAttribute('data-src') || '';
                                if (imgSrc) {
                                    image = imgSrc.startsWith('//') ? 'https:' + imgSrc : imgSrc;
                                }
                                title = img.alt || '';
                            }
                            
                            const titleSelectors = [
                                '[class*="title"]', '[class*="name"]', '[class*="desc"]', 
                                '[class*="subject"]', '[class*="offerTitle"]', '[class*="offer-title"]'
                            ];
                            for (const sel of titleSelectors) {
                                const el = card.querySelector(sel);
                                if (el) {
                                    const text = (el.innerText || '').trim();
                                    if (text && text.length > 5 && text.length < 150 && !text.startsWith('¥')) {
                                        title = text;
                                        break;
                                    }
                                }
                            }
                            
                            const priceMatch = (card.innerText || '').match(/¥\\s*([\\d.]+)/);
                            if (priceMatch) {
                                price = '¥' + priceMatch[1];
                            }
                            
                            const shopSelectors = [
                                '[class*="company"]', '[class*="shop"]', '[class*="store"]',
                                '[class*="seller"]', '[class*="factory"]'
                            ];
                            for (const sel of shopSelectors) {
                                const el = card.querySelector(sel);
                                if (el) {
                                    const text = (el.innerText || '').trim();
                                    if (text && text.length > 2 && text.length < 60 && !text.includes('¥')) {
                                        shop = text;
                                        break;
                                    }
                                }
                            }
                            
                            if (title || price || image) {
                                const item = {
                                    title: title,
                                    price: price,
                                    shop: shop,
                                    url: href || '',
                                    offer_id: offerId,
                                    rank: validCount
                                };
                                
                                if (image) item.image = image;
                                
                                if (normScore !== null && !isNaN(normScore)) {
                                    item.similarity = normScore;
                                    item.score_type = 'normalizationScore';
                                } else {
                                    item.similarity = null;
                                    item.score_type = 'unavailable';
                                }
                                
                                results.push(item);
                            }
                        });
                        
                        if (results.length > 0) {
                            return results;
                        }
                    }
                    
                    // 方案3: 通用卡片提取（最后兜底）
                    const cards = document.querySelectorAll(
                        '[class*="item"], [class*="card"], [class*="product"], [class*="offer"], li'
                    );

                    let rank = 0;
                    cards.forEach(card => {
                        const img = card.querySelector('img');
                        const link = card.querySelector('a[href*="detail"], a[href*="offer"]');
                        if (!img && !link) return;

                        const href = link ? link.href : '';
                        if (!href || seen.has(href)) return;
                        seen.add(href);

                        let title = '';
                        let image = '';
                        let price = '';
                        let shop = '';

                        if (img) {
                            const imgSrc = img.src || img.getAttribute('data-src') || '';
                            if (imgSrc) {
                                image = imgSrc.startsWith('//') ? 'https:' + imgSrc : imgSrc;
                            }
                            title = img.alt || '';
                        }

                        const titleEls = card.querySelectorAll(
                            '[class*="title"], [class*="name"], [class*="desc"], [class*="subject"]'
                        );
                        for (const t of titleEls) {
                            const text = t.innerText?.trim() || '';
                            if (text && text.length > 5 && text.length < 100 && !text.includes('¥')) {
                                title = text;
                                break;
                            }
                        }

                        const pricePattern = /¥\\s*[\\d.]+/;
                        const allEls = card.querySelectorAll('*');
                        for (const el of allEls) {
                            const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
                            if (pricePattern.test(text)) {
                                const match = text.match(/¥\\s*[\\d.]+/);
                                if (match) {
                                    price = match[0].replace(/\\s+/g, '');
                                    break;
                                }
                            }
                        }

                        const shopEls = card.querySelectorAll(
                            '[class*="company"], [class*="shop"], [class*="store"]'
                        );
                        for (const s of shopEls) {
                            const text = s.innerText?.trim() || '';
                            if (text && text.length < 50 && !text.includes('¥')) {
                                shop = text;
                                break;
                            }
                        }

                        if ((title || price || image) && rank < 30) {
                            rank++;
                            const item = {
                                title, price, shop, url: href,
                                similarity: null,
                                score_type: 'unavailable',
                                rank
                            };
                            if (image) item.image = image;
                            results.push(item);
                        }
                    });

                    return results;
                }
            """)
            return results or []
        except Exception as e:
            print(f"[DEBUG] 页面提取失败: {e}")
            import traceback
            traceback.print_exc()
            return []

    def _search_by_api(self, image_path):
        """
        使用 API 直连方式搜索图片
        :param image_path: 图片路径
        :return: 搜索结果列表
        """
        if not API_AVAILABLE:
            print("[API] API 模块不可用")
            return []

        print(f"[API] 开始 API 搜索: {image_path}")
        try:
            client = get_api_client()
            products = client.search_image(image_path, max_results=60)
            print(f"[API] 搜索完成，找到 {len(products)} 个商品")
        except Exception as e:
            print(f"[API] 搜索异常: {e}")
            import traceback
            traceback.print_exc()
            raise

        # 转换为统一的结果格式
        results = []
        for i, p in enumerate(products):
            item = {
                'title': p.get('title', ''),
                'price': p.get('price', ''),
                'shop': p.get('shop', ''),
                'url': p.get('url', ''),
                'offer_id': p.get('offer_id', ''),
                'image': p.get('image', ''),
                'similarity': p.get('similarity'),
                'score_type': p.get('score_type', 'normalizationScore'),
                'rank': i + 1,
                'is_ad': p.get('is_ad', False),
                'source': 'api',  # 标记来源为 API
            }
            results.append(item)

        return results

    def _inject_api_interceptor(self):
        """
        向页面注入 API 响应拦截器（CDP 模式下使用）
        拦截 XHR、fetch 和 JSONP 请求，保存所有响应到 window.__api_responses
        """
        self.page.evaluate("""() => {
            if (window.__api_interceptor_installed) return;
            window.__api_interceptor_installed = true;
            window.__api_responses = [];
            
            // 安全解析 JSON
            function safeParseJson(text) {
                try { return JSON.parse(text); } catch(e) { return null; }
            }
            
            // 保存响应
            function saveResponse(url, data) {
                try {
                    if (!url) return;
                    window.__api_responses.push({ 
                        url: url, 
                        data: data,
                        timestamp: Date.now()
                    });
                    // 限制最大保存数量
                    if (window.__api_responses.length > 200) {
                        window.__api_responses = window.__api_responses.slice(-150);
                    }
                } catch(e) {}
            }
            
            // 拦截 XHR
            const origXhrOpen = XMLHttpRequest.prototype.open;
            const origXhrSend = XMLHttpRequest.prototype.send;
            
            XMLHttpRequest.prototype.open = function(method, url) {
                this.__url = url;
                return origXhrOpen.apply(this, arguments);
            };
            
            XMLHttpRequest.prototype.send = function() {
                const self = this;
                
                function handleLoad() {
                    try {
                        const url = self.__url || self.responseURL || '';
                        const text = self.responseText;
                        if (text && text.length > 10) {
                            const data = safeParseJson(text);
                            if (data) {
                                saveResponse(url, data);
                            }
                        }
                    } catch(e) {}
                }
                
                this.addEventListener('load', handleLoad);
                this.addEventListener('loadend', handleLoad);
                
                return origXhrSend.apply(this, arguments);
            };
            
            // 拦截 fetch
            const origFetch = window.fetch;
            if (origFetch) {
                window.fetch = function(...args) {
                    const url = (typeof args[0] === 'string') ? args[0] : (args[0]?.url || '');
                    
                    return origFetch.apply(this, args).then(response => {
                        try {
                            const clone = response.clone();
                            clone.text().then(text => {
                                try {
                                    if (text && text.length > 10) {
                                        const data = safeParseJson(text);
                                        if (data) {
                                            saveResponse(url, data);
                                        }
                                    }
                                } catch(e) {}
                            }).catch(() => {});
                        } catch(e) {}
                        return response;
                    });
                };
            }
            
            // 拦截 JSONP（通过 script 标签）
            const origCreateElement = document.createElement;
            document.createElement = function(tagName) {
                const element = origCreateElement.apply(this, arguments);
                if (tagName && tagName.toLowerCase() === 'script') {
                    let src = '';
                    Object.defineProperty(element, 'src', {
                        get() { return this.getAttribute('src') || ''; },
                        set(value) {
                            src = value;
                            this.setAttribute('src', value);
                        }
                    });
                    
                    element.addEventListener('load', function() {
                        // JSONP 响应通常执行回调函数，难以直接捕获
                        // 记录 URL 供调试
                        saveResponse('[JSONP] ' + src, { jsonpUrl: src });
                    });
                }
                return element;
            };
            
            console.log('[API Interceptor] 已安装 XHR/fetch/JSONP 拦截器');
        }""")

    def search_image(self, image_path, first_time=False):
        """
        搜索单张图片
        优先使用 API 直连方式，失败时回退到 Playwright 浏览器方式
        :param image_path: 图片路径
        :param first_time: 是否首次搜索（仅浏览器模式使用）
        :return: 搜索结果列表
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"图片不存在: {image_path}")

        # 优先使用 API 直连
        if USE_API_FIRST and API_AVAILABLE:
            try:
                api_results = self._search_by_api(image_path)
                if api_results and len(api_results) > 0:
                    print(f"[INFO] ✅ API 直连搜索成功，返回 {len(api_results)} 个结果")
                    return api_results
                else:
                    print("[WARN] API 搜索无结果，回退到浏览器模式")
            except Exception as e:
                print(f"[WARN] API 搜索失败: {e}，回退到浏览器模式")
                import traceback
                traceback.print_exc()

        # 回退到浏览器模式
        if not self._initialized:
            self.initialize()

        api_results = []

        def handle_response(response):
            try:
                url = response.url.lower()
                is_search_related = any(kw in url for kw in [
                    'imagesearch', 'image_search', 'imgsearch', 'similar',
                    'searchoffer', 'offersearch', 'recommend', 'mtop'
                ])
                if is_search_related:
                    try:
                        body = response.json()
                        extracted = self._extract_from_api_response(body)
                        if extracted:
                            api_results.extend(extracted)
                    except:
                        pass
            except:
                pass

        try:
            # CDP 连接模式下不使用事件监听（会有 event loop 冲突）
            # 改用页面注入的方式捕获 API 响应
            if not self._is_cdp_connection:
                self.page.on("response", handle_response)
            else:
                # CDP 模式：确保 API 拦截器已注入（每次搜索前重新注入确保有效）
                try:
                    self._inject_api_interceptor()
                except:
                    pass
                # 清空之前的响应记录
                try:
                    self.page.evaluate("() => { window.__api_responses = []; }")
                except:
                    pass

            if first_time:
                self.page.goto(IMAGE_SEARCH_URL, wait_until="domcontentloaded", timeout=30000)
                time.sleep(3)
                try:
                    self.page.wait_for_load_state("networkidle", timeout=10000)
                except:
                    pass

            api_results.clear()

            # 处理滑块
            self._handle_slider_captcha(max_attempts=2)

            # 找到文件上传输入
            file_input = None
            
            # 优先找可见的 file input
            file_inputs = self.page.query_selector_all('input[type="file"]')
            for inp in file_inputs:
                try:
                    # 检查 accept 属性是否包含图片
                    accept = inp.get_attribute('accept') or ''
                    if 'jpg' in accept or 'png' in accept or 'image' in accept or not accept:
                        # 强制可见以便上传
                        try:
                            self.page.evaluate("""(el) => {
                                el.style.display = 'block';
                                el.style.visibility = 'visible';
                                el.style.opacity = '1';
                                el.style.position = 'fixed';
                                el.style.zIndex = '999999';
                                el.style.width = '100px';
                                el.style.height = '100px';
                                el.style.top = '0';
                                el.style.left = '0';
                            }""", inp)
                        except:
                            pass
                        file_input = inp
                        break
                except:
                    pass

            if not file_input and file_inputs:
                file_input = file_inputs[0]

            if not file_input:
                try:
                    upload_btn = self.page.get_by_text("上传图片")
                    if upload_btn.count() > 0:
                        upload_btn.first.click()
                        time.sleep(1)
                        file_inputs2 = self.page.query_selector_all('input[type="file"]')
                        if file_inputs2:
                            file_input = file_inputs2[0]
                except:
                    pass

            if not file_input:
                if not self._is_cdp_connection:
                    self.page.remove_listener("response", handle_response)
                return []

            # 上传图片
            file_input.set_input_files(image_path)
            print(f"[INFO] 图片已上传，等待搜索结果...")
            time.sleep(3)

            # 点击搜索按钮（如果需要的话）
            search_btn_clicked = False
            try:
                # 尝试多种搜索按钮文本
                for btn_text in ["搜索图片", "搜 索", "搜索", "找一下", "立即搜索"]:
                    search_btn = self.page.get_by_text(btn_text, exact=True)
                    for i in range(search_btn.count()):
                        btn = search_btn.nth(i)
                        if btn.is_visible():
                            btn.click()
                            search_btn_clicked = True
                            print(f"[INFO] 点击了搜索按钮: {btn_text}")
                            break
                    if search_btn_clicked:
                        break
            except:
                pass

            if not search_btn_clicked:
                # 有些页面上传后自动搜索，不需要点击
                print("[INFO] 未找到搜索按钮，等待自动搜索...")
                search_btn_clicked = True  # 假设自动搜索

            # 等待结果加载
            if search_btn_clicked:
                # 等待搜索结果出现
                print("[INFO] 等待搜索结果加载...")
                time.sleep(2)
                
                # 等待 aplusReport 卡片出现（说明结果加载完成）
                try:
                    self.page.wait_for_selector('[data-aplus-report]', timeout=15000)
                    print("[INFO] ✅ 搜索结果已加载")
                except Exception as e:
                    print(f"[WARN] 等待 aplusReport 超时: {e}")
                
                try:
                    self.page.wait_for_load_state("domcontentloaded", timeout=5000)
                except:
                    pass
                
                # 额外等待确保数据渲染完成
                time.sleep(1)

            # 处理滑块
            self._handle_slider_captcha(max_attempts=2)

            # 滚动加载更多（减少次数和等待时间）
            for _ in range(3):
                self.page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
                time.sleep(1)

            self.page.evaluate("window.scrollTo(0, 0)")
            time.sleep(1)

            # 提取结果
            page_results = self._extract_from_page()

            # CDP 模式下，额外从页面全局变量中提取数据（可能包含 normalizationScore）
            if self._is_cdp_connection:
                try:
                    window_data = self.page.evaluate("""() => {
                        const results = [];
                        
                        // 检查常见的全局数据变量
                        const candidates = [
                            '__INITIAL_STATE__', '__NEXT_DATA__', 'windowData',
                            'pageData', 'searchData', 'resultData', 'state',
                            '__data__', 'initialData', 'appData'
                        ];
                        
                        for (const key of candidates) {
                            try {
                                if (window[key]) {
                                    results.push({ key, data: JSON.parse(JSON.stringify(window[key])) });
                                }
                            } catch(e) {}
                        }
                        
                        // 检查 React/Vue 的根节点数据
                        try {
                            const root = document.getElementById('root') || document.getElementById('app');
                            if (root && root.__reactFiber$) {
                                // 尝试从 React fiber 中提取
                                results.push({ key: '__react_root__', data: 'react_fiber_detected' });
                            }
                        } catch(e) {}
                        
                        return results;
                    }""")
                    
                    if window_data:
                        print(f"[INFO] 从页面全局变量中找到 {len(window_data)} 个数据对象")
                        for item in window_data:
                            key = item.get('key', '')
                            data = item.get('data')
                            if isinstance(data, dict):
                                # 检查是否包含 normalizationScore
                                data_str = str(data)
                                if 'normalizationScore' in data_str:
                                    print(f"[INFO] ✅ 全局变量 {key} 中包含 normalizationScore!")
                                    extracted = self._extract_from_api_response(data)
                                    if extracted:
                                        print(f"[INFO] 从全局变量 {key} 提取到 {len(extracted)} 个结果")
                                        api_results.extend(extracted)
                except Exception as e:
                    print(f"[DEBUG] 从页面全局变量提取失败: {e}")

            # CDP 模式下，从页面注入的拦截器获取 API 响应
            if self._is_cdp_connection:
                try:
                    api_responses = self.page.evaluate("() => window.__api_responses || []")
                    if api_responses:
                        print(f"[INFO] 从页面拦截到 {len(api_responses)} 个 API 响应")
                        
                        # 打印所有响应的 URL（调试用）
                        print(f"[DEBUG] 所有拦截的 API URL:")
                        for i, resp in enumerate(api_responses[:20]):
                            url = resp.get('url', '')
                            data = resp.get('data')
                            has_norm = False
                            # 简单检查是否包含 normalizationScore
                            try:
                                data_str = str(data) if data else ''
                                has_norm = 'normalizationScore' in data_str
                            except:
                                pass
                            print(f"  [{i+1}] {'[HAS SCORE]' if has_norm else '         '} {url[:100]}")
                        
                        # 1688 图搜相关的 API URL 关键词
                        search_keywords = [
                            'imagesearch', 'image_search', 'imgsearch', 'similar',
                            'searchoffer', 'offersearch', 'recommend', 'mtop',
                            'smartengine', 'smart_engine', 'search', 'offer',
                            'h5api', 'api.1688', 'data.1688', 'open-s.1688',
                            'youxuan', 'imag', 'picsearch', 'pic_search'
                        ]
                        
                        for resp in api_responses:
                            try:
                                url = resp.get('url', '').lower()
                                is_search_related = any(kw in url for kw in search_keywords)
                                
                                # 只要响应中包含 normalizationScore 就提取
                                data = resp.get('data')
                                has_norm_score = False
                                if data:
                                    try:
                                        data_str = str(data)
                                        has_norm_score = 'normalizationScore' in data_str
                                    except:
                                        pass
                                
                                if is_search_related or has_norm_score:
                                    if data:
                                        extracted = self._extract_from_api_response(data)
                                        if extracted:
                                            api_results.extend(extracted)
                                            print(f"[INFO] 从API提取到 {len(extracted)} 个结果: {url[:80]}")
                                            # 检查是否有 normalizationScore
                                            has_score = sum(1 for r in extracted if r.get('score_type') == 'normalizationScore')
                                            if has_score > 0:
                                                print(f"[INFO] ✅ 其中 {has_score} 个包含真实 normalizationScore")
                            except Exception as e:
                                pass
                except Exception as e:
                    print(f"[WARN] 读取页面API响应失败: {e}")
                    import traceback
                    traceback.print_exc()

            # 合并结果，优先API结果
            if api_results:
                api_with_sim = [r for r in api_results if r.get('score_type') == 'normalizationScore']
                if api_with_sim:
                    seen_urls = set()
                    merged = []
                    for r in api_with_sim:
                        url = r.get('url', '')
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            merged.append(r)
                    for r in page_results:
                        url = r.get('url', '')
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            merged.append(r)
                    results = merged
                else:
                    seen_urls = set()
                    merged = []
                    for r in api_results:
                        url = r.get('url', '')
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            merged.append(r)
                    for r in page_results:
                        url = r.get('url', '')
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            merged.append(r)
                    results = merged
            else:
                results = page_results

            # 统计结果
            norm_count = sum(1 for r in results if r.get('score_type') in ('normalizationScore', 'normalizationScore_deep'))
            unavailable_count = sum(1 for r in results if r.get('score_type') == 'unavailable')
            print(f"[INFO] 最终结果: {len(results)} 个 (真实相似度: {norm_count} 个, 无真实值: {unavailable_count} 个)")
            
            if norm_count > 0:
                print(f"[INFO] ✅ 成功获取到 normalizationScore 真实值!")
                # 打印前3个的分数
                norm_results = [r for r in results if r.get('score_type') in ('normalizationScore', 'normalizationScore_deep')]
                for i, r in enumerate(norm_results[:3]):
                    print(f"       [{i+1}] 相似度: {r.get('similarity', '')} - {r.get('title', '')[:30]}")

            if not self._is_cdp_connection:
                self.page.remove_listener("response", handle_response)
            return results

        except Exception as e:
            print(f"[ERROR] 搜索失败: {e}")
            import traceback
            traceback.print_exc()
            return []

    def batch_search(self, image_paths, progress_callback=None, max_workers=3):
        """
        批量搜索图片（并发模式）
        :param image_paths: 图片路径列表
        :param progress_callback: 进度回调函数 callback(current, total, image_name, results_count)
        :param max_workers: 最大并发数，默认3线程
        :return: 所有搜索结果字典
        """
        all_results = {}
        total = len(image_paths)
        completed_count = 0
        lock = threading.Lock()

        def search_single(img_path, idx):
            nonlocal completed_count
            img_name = os.path.basename(img_path)
            print(f"[进度] {idx + 1}/{total} - {img_name} (线程开始)")

            t_start = time.time()
            try:
                results = self._search_single_api(img_path)
            except Exception as e:
                print(f"[ERROR] 搜索失败 {img_name}: {e}")
                results = []
            t_end = time.time()
            search_duration = round(t_end - t_start, 2)

            result_entry = {
                "image_path": img_path,
                "image_name": img_name,
                "search_time": datetime.now().isoformat(),
                "search_duration": search_duration,
                "result_count": len(results),
                "results": results,
                "status": "completed" if results else "no_results",
            }

            with lock:
                completed_count += 1
                current = completed_count
                all_results[img_name] = result_entry
                if progress_callback:
                    progress_callback(current, total, img_name, len(results))

            return result_entry

        # 使用线程池并发搜索
        # API直连模式是纯HTTP请求，线程安全
        # 只有API失败时才回退到浏览器模式（浏览器模式串行处理）
        use_concurrent = max_workers > 1 and total > 1

        if use_concurrent:
            from concurrent.futures import ThreadPoolExecutor, as_completed
            print(f"[INFO] 启用并发搜索，{max_workers} 线程，{total} 张图片")
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {
                    executor.submit(search_single, img_path, idx): idx
                    for idx, img_path in enumerate(image_paths)
                }
                for future in as_completed(futures):
                    try:
                        future.result()
                    except Exception as e:
                        print(f"[ERROR] 线程异常: {e}")
        else:
            # 串行模式（浏览器回退时使用）
            for idx, img_path in enumerate(image_paths):
                search_single(img_path, idx)

        return all_results

    def _search_single_api(self, image_path):
        """
        单张图片API搜索（线程安全，不依赖浏览器状态）
        :param image_path: 图片路径
        :return: 搜索结果列表
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"图片不存在: {image_path}")

        # 优先使用 API 直连
        if USE_API_FIRST and API_AVAILABLE:
            try:
                api_results = self._search_by_api(image_path)
                if api_results and len(api_results) > 0:
                    print(f"[INFO] ✅ API 直连搜索成功，返回 {len(api_results)} 个结果")
                    return api_results
                else:
                    print("[WARN] API 搜索无结果，回退到浏览器模式")
            except Exception as e:
                print(f"[WARN] API 搜索失败: {e}，回退到浏览器模式")

        # 回退到浏览器模式（串行，需要初始化）
        if not self._initialized:
            self.initialize()
        return self.search_image(image_path, first_time=False)


# 单例模式
_engine_instance = None


def get_engine(headless=False):
    """获取搜索引擎单例"""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = SearchEngine(headless=headless)
    return _engine_instance


def close_engine():
    """关闭搜索引擎"""
    global _engine_instance
    if _engine_instance:
        _engine_instance.close()
        _engine_instance = None
