#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1688 图搜批量寻源 - Web服务
Flask后端主程序
"""

import os
import json
import uuid
import threading
import time
import hashlib
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import urllib.request
import urllib.error
from flask import Flask, render_template, request, jsonify, send_from_directory, abort, Response
from werkzeug.utils import secure_filename

try:
    from flask_cors import CORS
    CORS_AVAILABLE = True
except ImportError:
    CORS_AVAILABLE = False

# 初始化Flask应用
app = Flask(__name__)

# 启用CORS（允许跨域请求，支持GitHub Pages前端调用本地后端）
if CORS_AVAILABLE:
    CORS(app, supports_credentials=True, resources={
        r"/api/*": {"origins": "*"},
        r"/uploads/*": {"origins": "*"},
        r"/img-proxy/*": {"origins": "*"},
    })
else:
    # 如果没有flask_cors，手动添加CORS头
    @app.after_request
    def add_cors_headers(response):
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        return response

# 配置
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.environ.get('UPLOAD_DIR', os.path.join(BASE_DIR, 'uploads'))
RESULT_DIR = os.environ.get('RESULT_DIR', os.path.join(BASE_DIR, 'results'))
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'}
# 不限制上传大小（用户需求：不限制数量和大小）
app.config['UPLOAD_FOLDER'] = UPLOAD_DIR
app.secret_key = os.environ.get('SECRET_KEY', '1688-image-search-secret-key')

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)

# 全局任务状态
tasks = {}


def allowed_file(filename):
    """检查文件扩展名"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def generate_task_id():
    """生成任务ID"""
    return str(uuid.uuid4())[:8]


def save_task_result(task_id, result_data):
    """保存任务结果到文件"""
    result_file = os.path.join(RESULT_DIR, f"{task_id}.json")
    with open(result_file, 'w', encoding='utf-8') as f:
        json.dump(result_data, f, ensure_ascii=False, indent=2)


def load_task_result(task_id):
    """从文件加载任务结果"""
    result_file = os.path.join(RESULT_DIR, f"{task_id}.json")
    if os.path.exists(result_file):
        try:
            with open(result_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[ERROR] 加载任务结果失败 {task_id}: {e}")
            return None
    return None


def run_search_task(task_id, image_files):
    """
    后台执行搜索任务
    :param task_id: 任务ID
    :param image_files: 图片文件路径列表
    """
    from search_engine import SearchEngine

    task = tasks.get(task_id)
    if not task:
        return

    engine = None
    try:
        task['status'] = 'initializing'
        task['message'] = '正在初始化...'
        search_start_time = time.time()

        # 创建搜索引擎实例（API 模式不需要初始化浏览器）
        engine = SearchEngine(headless=True)

        total = len(image_files)
        task['total'] = total
        task['current'] = 0
        task['status'] = 'searching'
        task['message'] = '开始搜索...'
        task['results'] = {}
        task['search_started_at'] = datetime.now().isoformat()

        def progress_callback(current, total, image_name, results_count):
            task['current'] = current
            task['message'] = f'正在搜索: {image_name} ({current}/{total})'
            # 实时保存进度
            save_task_result(task_id, {
                'task_id': task_id,
                'status': task['status'],
                'current': current,
                'total': total,
                'message': task['message'],
                'results': task['results'],
                'updated_at': datetime.now().isoformat(),
            })

        all_results = engine.batch_search(image_files, progress_callback=progress_callback)

        search_end_time = time.time()
        total_search_duration = round(search_end_time - search_start_time, 2)

        task['status'] = 'completed'
        task['message'] = f'搜索完成！共找到 {sum(r["result_count"] for r in all_results.values())} 个商品'
        task['results'] = all_results
        task['completed_at'] = datetime.now().isoformat()
        task['search_duration'] = total_search_duration

        # 保存最终结果
        save_task_result(task_id, {
            'task_id': task_id,
            'status': 'completed',
            'current': total,
            'total': total,
            'message': task['message'],
            'results': all_results,
            'completed_at': task['completed_at'],
            'created_at': task.get('created_at'),
            'search_started_at': task.get('search_started_at'),
            'search_duration': total_search_duration,
        })

        print(f"[任务完成] {task_id}")

    except Exception as e:
        print(f"[任务失败] {task_id}: {e}")
        import traceback
        traceback.print_exc()
        task['status'] = 'failed'
        task['message'] = f'搜索失败: {str(e)}'
        task['error'] = str(e)

        save_task_result(task_id, {
            'task_id': task_id,
            'status': 'failed',
            'message': task['message'],
            'error': str(e),
            'results': task.get('results', {}),
            'failed_at': datetime.now().isoformat(),
        })
    finally:
        # 关闭搜索引擎
        if engine:
            try:
                engine.close()
            except:
                pass


# ============ 路由 ============

@app.route('/')
def index():
    """首页"""
    return render_template('index.html')


@app.route('/api/health')
def health_check():
    """健康检查（用于部署平台检测服务状态）"""
    return jsonify({
        'status': 'ok',
        'service': '1688-image-search',
        'version': '2.0.0',
        'timestamp': datetime.now().isoformat(),
    })


@app.route('/api/upload', methods=['POST'])
def upload_images():
    """
    批量上传图片
    返回任务ID和已上传的图片列表
    """
    if 'files' not in request.files:
        return jsonify({'error': '没有上传文件'}), 400

    files = request.files.getlist('files')
    if not files or files[0].filename == '':
        return jsonify({'error': '没有选择文件'}), 400

    task_id = generate_task_id()
    task_upload_dir = os.path.join(UPLOAD_DIR, task_id)
    os.makedirs(task_upload_dir, exist_ok=True)

    uploaded_files = []
    failed_files = []

    for file in files:
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            # 处理重名
            base, ext = os.path.splitext(filename)
            counter = 1
            final_filename = filename
            while os.path.exists(os.path.join(task_upload_dir, final_filename)):
                final_filename = f"{base}_{counter}{ext}"
                counter += 1

            filepath = os.path.join(task_upload_dir, final_filename)
            file.save(filepath)
            uploaded_files.append({
                'name': final_filename,
                'path': filepath,
                'size': os.path.getsize(filepath),
                'url': f'/uploads/{task_id}/{final_filename}',
            })
        else:
            failed_files.append(file.filename if hasattr(file, 'filename') else 'unknown')

    # 初始化任务
    tasks[task_id] = {
        'task_id': task_id,
        'status': 'pending',
        'message': '图片上传完成，等待开始搜索',
        'uploaded_files': uploaded_files,
        'failed_files': failed_files,
        'created_at': datetime.now().isoformat(),
        'upload_dir': task_upload_dir,
    }

    # 保存初始状态
    save_task_result(task_id, tasks[task_id])

    return jsonify({
        'task_id': task_id,
        'status': 'pending',
        'uploaded_count': len(uploaded_files),
        'failed_count': len(failed_files),
        'uploaded_files': uploaded_files,
        'failed_files': failed_files,
        'message': f'成功上传 {len(uploaded_files)} 张图片' + (f'，失败 {len(failed_files)} 张' if failed_files else ''),
    })


@app.route('/api/upload_urls', methods=['POST'])
def upload_image_urls():
    """
    通过图片URL批量上传
    接收JSON: {"urls": ["url1", "url2", ...]}
    下载图片并入库，返回任务ID和已上传的图片列表
    """
    data = request.get_json(silent=True) or {}
    urls = data.get('urls') or []
    if not urls:
        return jsonify({'error': '没有提供URL列表'}), 400

    # 清洗URL列表
    clean_urls = []
    for u in urls:
        if isinstance(u, str):
            u = u.strip()
            if u:
                clean_urls.append(u)

    if not clean_urls:
        return jsonify({'error': 'URL列表为空'}), 400

    task_id = generate_task_id()
    task_upload_dir = os.path.join(UPLOAD_DIR, task_id)
    os.makedirs(task_upload_dir, exist_ok=True)

    uploaded_files = []
    failed_files = []

    # 允许的图片扩展名
    img_exts = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'}

    for i, url in enumerate(clean_urls):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                'Referer': url,
            })
            with urllib.request.urlopen(req, timeout=30) as response:
                img_data = response.read()

            # 从Content-Type或URL推断扩展名
            content_type = response.headers.get('Content-Type', '')
            ext = '.jpg'
            if 'png' in content_type:
                ext = '.png'
            elif 'webp' in content_type:
                ext = '.webp'
            elif 'gif' in content_type:
                ext = '.gif'
            elif 'bmp' in content_type:
                ext = '.bmp'
            else:
                # 从URL路径推断
                parsed = urlparse(url)
                path = parsed.path.lower()
                for e in img_exts:
                    if path.endswith(e):
                        ext = e
                        break

            filename = f"url_{i+1:04d}{ext}"
            filepath = os.path.join(task_upload_dir, filename)
            with open(filepath, 'wb') as f:
                f.write(img_data)

            uploaded_files.append({
                'name': filename,
                'path': filepath,
                'size': len(img_data),
                'url': f'/uploads/{task_id}/{filename}',
                'source_url': url,
            })
        except Exception as e:
            failed_files.append({'url': url, 'error': str(e)})

    # 初始化任务
    tasks[task_id] = {
        'task_id': task_id,
        'status': 'pending',
        'message': '图片URL下载完成，等待开始搜索',
        'uploaded_files': uploaded_files,
        'failed_files': failed_files,
        'created_at': datetime.now().isoformat(),
        'upload_dir': task_upload_dir,
    }

    save_task_result(task_id, tasks[task_id])

    return jsonify({
        'task_id': task_id,
        'status': 'pending',
        'uploaded_count': len(uploaded_files),
        'failed_count': len(failed_files),
        'uploaded_files': uploaded_files,
        'failed_files': failed_files,
        'message': f'成功下载 {len(uploaded_files)} 张图片' + (f'，失败 {len(failed_files)} 张' if failed_files else ''),
    })


@app.route('/api/search/<task_id>', methods=['POST'])
def start_search(task_id):
    """
    开始搜索任务
    """
    task = tasks.get(task_id)
    if not task:
        # 尝试从文件加载
        task_data = load_task_result(task_id)
        if not task_data:
            return jsonify({'error': '任务不存在'}), 404
        task = task_data
        tasks[task_id] = task

    if task['status'] in ('searching', 'initializing'):
        return jsonify({'error': '任务正在进行中'}), 400

    uploaded_files = task.get('uploaded_files', [])
    if not uploaded_files:
        return jsonify({'error': '没有可搜索的图片'}), 400

    image_paths = [f['path'] for f in uploaded_files]

    # 更新任务状态
    task['status'] = 'queued'
    task['message'] = '任务已加入队列...'

    # 启动后台线程执行搜索
    thread = threading.Thread(
        target=run_search_task,
        args=(task_id, image_paths),
        daemon=True
    )
    thread.start()

    return jsonify({
        'task_id': task_id,
        'status': 'queued',
        'message': '任务已启动，正在初始化...',
    })


@app.route('/api/status/<task_id>', methods=['GET'])
def get_status(task_id):
    """
    获取任务状态和进度
    """
    task = tasks.get(task_id)

    # 如果内存中没有，尝试从文件加载
    if not task:
        task_data = load_task_result(task_id)
        if task_data:
            tasks[task_id] = task_data
            task = task_data

    if not task:
        return jsonify({'error': '任务不存在'}), 404

    return jsonify({
        'task_id': task_id,
        'status': task.get('status', 'unknown'),
        'message': task.get('message', ''),
        'current': task.get('current', 0),
        'total': task.get('total', 0),
        'progress': (task.get('current', 0) / task.get('total', 1) * 100) if task.get('total', 0) > 0 else 0,
        'results_count': sum(r.get('result_count', 0) for r in task.get('results', {}).values()) if task.get('results') else 0,
        'updated_at': task.get('updated_at', task.get('created_at', '')),
    })


@app.route('/api/results/<task_id>', methods=['GET'])
def get_results(task_id):
    """
    获取搜索结果
    """
    task = tasks.get(task_id)

    if not task:
        task_data = load_task_result(task_id)
        if task_data:
            tasks[task_id] = task_data
            task = task_data

    if not task:
        return jsonify({'error': '任务不存在'}), 404

    results = task.get('results', {})

    return jsonify({
        'task_id': task_id,
        'status': task.get('status', 'unknown'),
        'message': task.get('message', ''),
        'total_images': len(results),
        'total_products': sum(r.get('result_count', 0) for r in results.values()),
        'results': results,
        'completed_at': task.get('completed_at', ''),
        'search_duration': task.get('search_duration', 0),
        'search_started_at': task.get('search_started_at', ''),
    })


@app.route('/api/tasks', methods=['GET'])
def list_tasks():
    """获取所有任务列表"""
    task_list = []
    for task_id, task in tasks.items():
        task_list.append({
            'task_id': task_id,
            'status': task.get('status', 'unknown'),
            'message': task.get('message', ''),
            'created_at': task.get('created_at', ''),
        })
    # 也从结果目录加载
    for filename in os.listdir(RESULT_DIR):
        if filename.endswith('.json'):
            tid = filename.replace('.json', '')
            if tid not in tasks:
                task_data = load_task_result(tid)
                if task_data:
                    task_list.append({
                        'task_id': tid,
                        'status': task_data.get('status', 'unknown'),
                        'message': task_data.get('message', ''),
                        'created_at': task_data.get('created_at', ''),
                    })

    task_list.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    return jsonify({'tasks': task_list[:20]})


@app.route('/api/debug/api-test', methods=['GET'])
def debug_api_test():
    """
    调试端点：测试 API 直连是否正常工作
    返回 API 初始化、token 获取、上传、搜索的详细信息
    """
    debug_info = {
        'api_module_available': False,
        'token': None,
        'token_error': None,
        'upload_success': False,
        'upload_error': None,
        'search_success': False,
        'search_count': 0,
        'search_error': None,
        'test_image_id': None,
    }
    
    try:
        from search_api import get_api_client
        debug_info['api_module_available'] = True
        
        client = get_api_client()
        
        # 测试 token 获取
        try:
            token = client.init_session(force=True)
            debug_info['token'] = token[:20] + '...' if token else None
        except Exception as e:
            debug_info['token_error'] = str(e)
            return jsonify(debug_info)
        
        # 测试上传（用一张小的测试图）
        try:
            # 生成一个 1x1 的测试图片 base64
            import base64
            # 1x1 白色 JPEG 的 base64
            tiny_b64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA1P/2Q=='
            image_id = client.upload_image_base64(tiny_b64)
            debug_info['upload_success'] = True
            debug_info['test_image_id'] = image_id
            
            # 测试搜索
            try:
                products = client.search_by_image_id(image_id, page=1, page_size=5)
                debug_info['search_success'] = True
                debug_info['search_count'] = len(products)
            except Exception as e:
                debug_info['search_error'] = str(e)
                
        except Exception as e:
            debug_info['upload_error'] = str(e)
    
    except Exception as e:
        debug_info['api_module_error'] = str(e)
    
    return jsonify(debug_info)


@app.route('/uploads/<task_id>/<filename>')
def serve_upload(task_id, filename):
    """提供上传的图片访问"""
    upload_dir = os.path.join(UPLOAD_DIR, task_id)
    if not os.path.exists(os.path.join(upload_dir, filename)):
        abort(404)
    return send_from_directory(upload_dir, filename)


# 图片代理缓存目录
IMG_CACHE_DIR = os.path.join(BASE_DIR, 'img_cache')
os.makedirs(IMG_CACHE_DIR, exist_ok=True)

# 允许代理的域名白名单
ALLOWED_IMG_DOMAINS = [
    'alicdn.com',
    'alibaba.com',
    '1688.com',
    'taobaocdn.com',
    'tbcdn.cn',
]

@app.route('/img-proxy')
def img_proxy():
    """
    图片代理接口 - 解决1688图片防盗链问题
    用法: /img-proxy?url=<图片URL>
    """
    img_url = request.args.get('url', '')
    if not img_url:
        abort(400, '缺少 url 参数')
    
    # 安全检查：只允许代理白名单域名的图片
    try:
        parsed = urlparse(img_url)
        domain = parsed.netloc.lower()
        allowed = any(domain.endswith(d) or domain == d for d in ALLOWED_IMG_DOMAINS)
        if not allowed:
            abort(403, '不允许代理此域名的图片')
    except Exception:
        abort(400, 'URL 格式错误')
    
    # 计算缓存文件名
    url_hash = hashlib.md5(img_url.encode('utf-8')).hexdigest()
    ext = os.path.splitext(parsed.path)[1] or '.jpg'
    cache_file = os.path.join(IMG_CACHE_DIR, url_hash + ext)
    
    # 如果缓存存在，直接返回
    if os.path.exists(cache_file):
        with open(cache_file, 'rb') as f:
            data = f.read()
        return Response(data, mimetype=f'image/{ext[1:] if ext else "jpeg"}')
    
    # 否则请求远程图片
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.1688.com/',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
        }
        req = urllib.request.Request(img_url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=15)
        
        if resp.status != 200:
            abort(404, f'图片加载失败: {resp.status}')
        
        content_type = resp.headers.get('Content-Type', 'image/jpeg')
        data = resp.read()
        
        # 保存缓存
        try:
            with open(cache_file, 'wb') as f:
                f.write(data)
        except Exception:
            pass  # 缓存失败不影响返回
        
        return Response(data, mimetype=content_type)
    
    except urllib.error.URLError as e:
        abort(502, f'图片请求失败: {str(e)}')


@app.route('/result/<task_id>')
def result_page(task_id):
    """结果页面"""
    return render_template('result.html', task_id=task_id)


# ============ 错误处理 ============

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': '文件太大，最大支持50MB'}), 413


@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': '页面不存在'}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': '服务器内部错误'}), 500


if __name__ == '__main__':
    import ssl
    import threading

    print("=" * 60)
    print("  1688 图搜批量寻源系统")
    print("=" * 60)
    print(f"  上传目录: {UPLOAD_DIR}")
    print(f"  结果目录: {RESULT_DIR}")
    print("  HTTP 地址: http://localhost:5000")
    print("  HTTPS地址: https://localhost:5443")
    print("=" * 60)
    print("  💡 GitHub Pages 访问请使用 HTTPS 地址")
    print("  🔐 首次使用 HTTPS 需要在浏览器中信任证书")
    print('     访问 https://localhost:5443 并点击"高级"->"继续访问"')
    print("=" * 60)

    # 生成自签名证书（用于 HTTPS）
    cert_file = os.path.join(BASE_DIR, 'ssl_cert.pem')
    key_file = os.path.join(BASE_DIR, 'ssl_key.pem')

    if not os.path.exists(cert_file) or not os.path.exists(key_file):
        print("\n📝 生成自签名证书...")
        try:
            from cryptography import x509
            from cryptography.x509.oid import NameOID
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import rsa
            import datetime

            # 生成私钥
            key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=2048,
            )

            # 生成证书
            subject = issuer = x509.Name([
                x509.NameAttribute(NameOID.COMMON_NAME, u"localhost"),
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"1688 Image Search"),
            ])

            cert = x509.CertificateBuilder().subject_name(
                subject
            ).issuer_name(
                issuer
            ).public_key(
                key.public_key()
            ).serial_number(
                x509.random_serial_number()
            ).not_valid_before(
                datetime.datetime.utcnow()
            ).not_valid_after(
                datetime.datetime.utcnow() + datetime.timedelta(days=3650)
            ).add_extension(
                x509.SubjectAlternativeName([
                    x509.DNSName(u"localhost"),
                    x509.DNSName(u"127.0.0.1"),
                ]),
                critical=False,
            ).sign(key, hashes.SHA256())

            # 保存证书
            with open(cert_file, "wb") as f:
                f.write(cert.public_bytes(serialization.Encoding.PEM))
            with open(key_file, "wb") as f:
                f.write(key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.TraditionalOpenSSL,
                    encryption_algorithm=serialization.NoEncryption(),
                ))
            print("✅ 证书生成成功")
        except ImportError:
            print("⚠️  cryptography 库未安装，使用 OpenSSL 生成...")
            try:
                import subprocess
                subprocess.run([
                    'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
                    '-keyout', key_file, '-out', cert_file,
                    '-days', '3650', '-nodes',
                    '-subj', '/CN=localhost/O=1688 Image Search'
                ], check=True, capture_output=True)
                print("✅ 证书生成成功")
            except Exception as e:
                print(f"❌ 证书生成失败: {e}")
                print("   将只启动 HTTP 服务")
                cert_file = None
                key_file = None
        except Exception as e:
            print(f"❌ 证书生成失败: {e}")
            cert_file = None
            key_file = None

    # 启动 HTTP 服务（主线程）
    def run_http():
        app.run(
            host='0.0.0.0',
            port=5000,
            debug=False,
            threaded=True,
        )

    # 启动 HTTPS 服务（单独线程）
    def run_https():
        if cert_file and key_file:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert_file, key_file)
            app.run(
                host='0.0.0.0',
                port=5443,
                debug=False,
                threaded=True,
                ssl_context=context,
            )

    # 启动 HTTPS 线程
    if cert_file and key_file:
        https_thread = threading.Thread(target=run_https, daemon=True)
        https_thread.start()
        print("\n✅ HTTPS 服务已启动: https://localhost:5443")

    # 主线程运行 HTTP
    run_http()
