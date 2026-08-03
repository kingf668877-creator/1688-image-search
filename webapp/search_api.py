#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1688 图搜 API 直连模块
通过直接调用 mtop API 实现图片搜索，无需浏览器
使用 Python 内置 urllib 代替 requests，减少依赖
"""

import os
import json
import time
import base64
import hashlib
import threading
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
from urllib.parse import quote


# ==================== 配置 ====================

APP_KEY = '12574478'
JSV = '2.7.2'
API = 'mtop.relationrecommend.wirelessrecommend.recommend'
API_VERSION = '2.0'
APP_ID = 32517
APP_NAME = 'pctusou'
SEARCH_SCENE = 'pcImageSearch'

IMAGE_SEARCH_URL = "https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&kj_agent_plugin=dianleida"


# ==================== 签名算法 ====================

def calc_sign(token, t, app_key, data):
    """
    计算 mtop 签名
    sign = md5(token + "&" + t + "&" + appKey + "&" + data)
    """
    sign_str = f"{token}&{t}&{app_key}&{data}"
    return hashlib.md5(sign_str.encode('utf-8')).hexdigest()


# ==================== API 客户端 ====================

class MtopApiClient:
    """1688 mtop API 客户端（使用 urllib 实现，线程安全）"""

    def __init__(self):
        # 使用 cookiejar 管理 cookie
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar)
        )
        self._lock = threading.Lock()  # 并发安全锁
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Origin': 'https://air.1688.com',
            'Referer': 'https://air.1688.com/',
            'Content-Type': 'application/x-www-form-urlencoded',
        }
        self._token = None
        self._last_init_time = 0
        self._init_interval = 1800  # 30 分钟重新初始化一次

    def _get_token(self):
        """从 cookie 获取 token"""
        cookies = {}
        for cookie in self.cookie_jar:
            cookies[cookie.name] = cookie.value
        m_h5_tk = cookies.get('_m_h5_tk', '')
        if m_h5_tk and '_' in m_h5_tk:
            return m_h5_tk.split('_')[0]
        return ''

    def _get(self, url, timeout=15):
        """发送 GET 请求"""
        req = urllib.request.Request(url, headers=self.headers)
        try:
            response = self.opener.open(req, timeout=timeout)
            return response.read().decode('utf-8', errors='ignore')
        except urllib.error.HTTPError as e:
            print(f"[WARN] HTTP GET 错误 {e.code}: {url}")
            return ''
        except Exception as e:
            print(f"[WARN] GET 请求失败: {e}")
            return ''

    def _post(self, url, data, timeout=30):
        """发送 POST 请求"""
        data_bytes = urllib.parse.urlencode(data).encode('utf-8')
        req = urllib.request.Request(url, data=data_bytes, headers=self.headers)
        try:
            response = self.opener.open(req, timeout=timeout)
            return response.read().decode('utf-8', errors='ignore')
        except urllib.error.HTTPError as e:
            print(f"[WARN] HTTP POST 错误 {e.code}: {url}")
            # 即使出错也尝试读取响应体
            try:
                return e.read().decode('utf-8', errors='ignore')
            except:
                return ''
        except Exception as e:
            print(f"[WARN] POST 请求失败: {e}")
            return ''

    def init_session(self, force=False):
        """
        初始化会话，获取 _m_h5_tk cookie
        mtop 机制：第一次不带 sign 请求，会返回 _m_h5_tk cookie
        线程安全：使用锁防止并发初始化
        """
        now = time.time()
        if not force and self._token and (now - self._last_init_time) < self._init_interval:
            return self._token

        with self._lock:
            # 双重检查：可能在等待锁的过程中已被其他线程初始化
            now = time.time()
            if not force and self._token and (now - self._last_init_time) < self._init_interval:
                return self._token

        print("[API] 初始化 mtop 会话...")

        # 先访问页面，获取一些基础 cookie
        try:
            self._get(IMAGE_SEARCH_URL, timeout=15)
        except Exception as e:
            print(f"[WARN] 访问页面失败: {e}")

        # 第一次请求（不带 sign）获取 token
        t = str(int(time.time() * 1000))
        params_data = {
            'appName': APP_NAME,
            'searchScene': SEARCH_SCENE,
            'method': 'getInitialData',
            'verticalProductFlag': 'pcmarket',
        }
        data_str = json.dumps({
            'appId': APP_ID,
            'params': json.dumps(params_data, ensure_ascii=False),
        }, ensure_ascii=False)

        url = f"https://h5api.m.1688.com/h5/{API}/{API_VERSION}/"
        payload = {
            'jsv': JSV,
            'appKey': APP_KEY,
            't': t,
            'api': API,
            'v': API_VERSION,
            'type': 'originaljson',
            'dataType': 'json',
            'data': data_str,
        }

        try:
            self._post(url, payload, timeout=15)
        except Exception as e:
            print(f"[WARN] 初始化请求失败: {e}")

        self._token = self._get_token()
        self._last_init_time = now

        if self._token:
            print(f"[API] ✅ Token 获取成功: {self._token[:20]}...")
        else:
            print("[API] ❌ Token 获取失败")

        return self._token

    def call(self, params_data):
        """
        调用 mtop 接口
        :param params_data: dict, params 字段的内容
        :return: API 响应 dict
        """
        # 确保有 token
        if not self._token:
            self.init_session()
        if not self._token:
            raise RuntimeError("无法获取 mtop token")

        t = str(int(time.time() * 1000))

        # 构造 data 字符串
        data_str = json.dumps({
            'appId': APP_ID,
            'params': json.dumps(params_data, ensure_ascii=False),
        }, ensure_ascii=False)

        # 计算签名
        sign = calc_sign(self._token, t, APP_KEY, data_str)

        url = f"https://h5api.m.1688.com/h5/{API}/{API_VERSION}/"
        payload = {
            'jsv': JSV,
            'appKey': APP_KEY,
            't': t,
            'sign': sign,
            'api': API,
            'v': API_VERSION,
            'type': 'originaljson',
            'dataType': 'json',
            'data': data_str,
        }

        try:
            response_text = self._post(url, payload, timeout=30)
            if not response_text:
                raise RuntimeError("API 返回空响应")
            
            result = json.loads(response_text)

            # 检查是否 token 过期
            ret = result.get('ret', [])
            if any('FAIL_SYS_TOKEN_EMPTY' in r or 'FAIL_SYS_SESSION_EXPIRED' in r for r in ret):
                print("[API] Token 过期，重新初始化...")
                self.init_session(force=True)
                if self._token:
                    # 重试一次
                    return self.call(params_data)

            return result
        except json.JSONDecodeError as e:
            print(f"[API] JSON 解析失败: {e}")
            print(f"[API] 响应前 500 字符: {response_text[:500] if response_text else '空'}")
            raise
        except Exception as e:
            print(f"[API] 调用失败: {e}")
            raise

    def upload_image_base64(self, image_b64):
        """
        上传 base64 图片，获取 imageId
        :param image_b64: base64 编码的图片（不含 data:image/xxx;base64, 前缀）
        :return: imageId 字符串
        """
        print("[API] 上传图片...")
        print(f"[API] 图片 base64 长度: {len(image_b64)}")

        result = self.call({
            'method': 'uploadBase64WithRequest',
            'appName': APP_NAME,
            'searchScene': SEARCH_SCENE,
            'imageBase64': image_b64,
            'beginPage': 1,
            'pageSize': 60,
        })

        inner = result.get('data', {})
        code = inner.get('code', '')
        success = inner.get('success', False)
        inner_data = inner.get('data', {})
        image_id = inner_data.get('imageId', '')

        if success and image_id:
            print(f"[API] ✅ 上传成功，imageId: {image_id}")
            return image_id
        else:
            error = inner.get('errorMessage', '')
            ret = result.get('ret', [])
            print(f"[API] ❌ 上传失败: code={code}, error={error}, ret={ret}")
            print(f"[API] 完整响应: {json.dumps(result, ensure_ascii=False)[:500]}")
            raise RuntimeError(f"图片上传失败: {error or code}")

    def _compress_image(self, image_path, max_size_kb=400, max_dimension=800):
        """
        压缩图片到指定大小以内，避免1688 API的413错误
        :param image_path: 图片路径
        :param max_size_kb: 最大文件大小（KB），默认400KB
        :param max_dimension: 最大边长（像素），默认800
        :return: 压缩后的图片字节流
        """
        with open(image_path, 'rb') as f:
            img_data = f.read()

        original_size_kb = len(img_data) / 1024
        if original_size_kb <= max_size_kb:
            return img_data

        print(f"[API] 原图 {original_size_kb:.1f} KB 超过 {max_size_kb}KB 限制，开始压缩...")

        # 尝试使用 Pillow 压缩
        try:
            from io import BytesIO
            from PIL import Image

            img = Image.open(BytesIO(img_data))
            # 转换为 RGB（去除 alpha 通道）
            if img.mode in ('RGBA', 'P', 'LA'):
                img = img.convert('RGB')

            # 缩放到最大尺寸
            if img.width > max_dimension or img.height > max_dimension:
                ratio = min(max_dimension / img.width, max_dimension / img.height)
                new_size = (int(img.width * ratio), int(img.height * ratio))
                img = img.resize(new_size, Image.LANCZOS)
                print(f"[API] 缩放: {img.size[0]}x{img.size[1]}")

            # 逐步降低质量直到满足大小限制
            for quality in [85, 75, 65, 55, 45]:
                buf = BytesIO()
                img.save(buf, format='JPEG', quality=quality, optimize=True)
                compressed = buf.getvalue()
                if len(compressed) / 1024 <= max_size_kb:
                    print(f"[API] 压缩完成: {len(compressed)/1024:.1f} KB (quality={quality})")
                    return compressed

            # 如果最低质量仍然过大，进一步缩小尺寸
            img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
            buf = BytesIO()
            img.save(buf, format='JPEG', quality=50, optimize=True)
            compressed = buf.getvalue()
            print(f"[API] 二次压缩: {len(compressed)/1024:.1f} KB")
            return compressed

        except ImportError:
            print("[API] PIL 未安装，无法压缩图片，使用原图")
            return img_data
        except Exception as e:
            print(f"[API] 压缩失败: {e}，使用原图")
            return img_data

    def upload_image_file(self, image_path):
        """
        上传本地图片文件（自动压缩大图片）
        :param image_path: 图片文件路径
        :return: imageId 字符串
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"图片不存在: {image_path}")

        img_data = self._compress_image(image_path)
        img_b64 = base64.b64encode(img_data).decode('utf-8')
        return self.upload_image_base64(img_b64)

    def search_by_image_id(self, image_id, page=1, page_size=60):
        """
        用 imageId 搜索相似商品
        :param image_id: 图片ID（从上传接口获取）
        :param page: 页码
        :param page_size: 每页数量
        :return: 商品列表
        """
        print(f"[API] 搜索商品 (imageId={image_id}, page={page})...")

        result = self.call({
            'method': 'imageOfferSearchService',
            'imageId': image_id,
            'searchScene': SEARCH_SCENE,
            'beginPage': page,
            'pageSize': page_size,
            'appName': APP_NAME,
        })

        inner = result.get('data', {})
        code = inner.get('code', '')
        success = inner.get('success', False)

        if not success:
            error = inner.get('errorMessage', '')
            print(f"[API] ❌ 搜索失败: code={code}, error={error}")
            return []

        # 解析商品数据
        inner_data = inner.get('data', {})
        offer = inner_data.get('OFFER', {})
        items = offer.get('items', [])

        products = []
        for item in items:
            item_data = item.get('data', {})
            if item_data:
                product = self._extract_product(item_data)
                if product:
                    products.append(product)

        has_more = offer.get('hasMore', False)
        print(f"[API] ✅ 搜索成功，返回 {len(products)} 个商品 (hasMore={has_more})")

        return products

    def search_image(self, image_path, max_results=60):
        """
        完整的图搜流程：上传图片 + 搜索商品
        :param image_path: 本地图片路径
        :param max_results: 最大结果数
        :return: 商品列表
        """
        # 1. 上传图片
        image_id = self.upload_image_file(image_path)

        # 2. 搜索商品
        page_size = min(max_results, 60)
        products = self.search_by_image_id(image_id, page=1, page_size=page_size)

        return products

    def _extract_product(self, item_data):
        """从 API 返回的 item data 中提取商品信息"""
        if not isinstance(item_data, dict):
            return None

        product = {}

        # 商品ID
        offer_id = item_data.get('offerId', '')
        if offer_id:
            product['offer_id'] = str(offer_id)

        # 标题
        title = item_data.get('title', '')
        if title:
            product['title'] = str(title)

        # 相似度分数
        norm_score = item_data.get('normalizationScore')
        if norm_score is not None:
            try:
                product['similarity'] = float(norm_score)
                product['score_type'] = 'normalizationScore'
            except (ValueError, TypeError):
                pass

        # 商品图片
        img_url = item_data.get('offerPicUrl') or item_data.get('odPicUrl')
        if img_url:
            if img_url.startswith('//'):
                img_url = 'https:' + img_url
            product['image'] = img_url

        # 商品链接 - 优先使用 offerId 构造标准详情页URL，避免 linkUrl 跳转不正确
        if offer_id:
            product['url'] = f"https://detail.1688.com/offer/{offer_id}.html"
        else:
            link_url = item_data.get('linkUrl', '')
            if link_url:
                if link_url.startswith('//'):
                    link_url = 'https:' + link_url
                product['url'] = link_url

        # 店铺名
        shop_name = item_data.get('loginId') or item_data.get('companyName')
        if shop_name:
            product['shop'] = str(shop_name)
            # 构造店铺首页URL
            login_id = item_data.get('loginId', '')
            if login_id:
                product['shop_url'] = f"https://{login_id}.1688.com"
            else:
                member_id = item_data.get('memberId', '')
                if member_id:
                    product['shop_url'] = f"https://shop{member_id}.1688.com"
                elif offer_id:
                    product['shop_url'] = f"https://detail.1688.com/offer/{offer_id}.html"

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

        # 销量
        sale_quantity = item_data.get('saleQuantity', '')
        if sale_quantity:
            product['sales'] = str(sale_quantity)

        # 地区
        province = item_data.get('province', '')
        city = item_data.get('city', '')
        if province or city:
            product['location'] = f"{province}{city}"

        # 是否广告
        is_ad = item_data.get('isAd', False) or item_data.get('isP4P', False)
        product['is_ad'] = bool(is_ad)

        # 至少要有 offer_id 或 title 才算有效商品
        if product.get('offer_id') or product.get('title'):
            return product
        return None


# ==================== 单例模式 ====================

_api_client = None


def get_api_client():
    """获取 API 客户端单例"""
    global _api_client
    if _api_client is None:
        _api_client = MtopApiClient()
    return _api_client


def search_image_api(image_path, max_results=60):
    """
    便捷函数：使用 API 直连方式搜索图片
    """
    client = get_api_client()
    return client.search_image(image_path, max_results=max_results)


# ==================== 测试 ====================

if __name__ == "__main__":
    import sys

    test_image = r"C:\Users\Administrator\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\work-mode-projects\6a697364b2f633195cca7552\webapp\uploads\fe699669\71LJdJKuzYL._AC_SY679_.jpg"
    if len(sys.argv) > 1:
        test_image = sys.argv[1]

    print("=" * 60)
    print("1688 图搜 API 直连测试")
    print("=" * 60)

    try:
        results = search_image_api(test_image)

        print(f"\n共找到 {len(results)} 个商品\n")
        print("-" * 60)
        for i, p in enumerate(results[:10]):
            sim = p.get('similarity', 'N/A')
            title = p.get('title', '')[:40]
            price = p.get('price', '')
            shop = p.get('shop', '')[:15]
            is_ad = ' [广告]' if p.get('is_ad') else ''
            print(f"[{i+1}] {sim:>6} | {price:>8} | {title}")
            print(f"     {shop}{is_ad}")

    except Exception as e:
        print(f"测试失败: {e}")
        import traceback
        traceback.print_exc()
