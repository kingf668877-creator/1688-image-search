/* 图搜结果运费展示：仅使用图搜接口已经返回的字段，不发起额外运费查询。 */
(function () {
  'use strict';

  const FIELD_NAMES = [
    'freight', 'freightText', 'freight_text', 'shipping', 'shippingText',
    'shipping_text', 'postage', 'postageText', 'postage_text', 'deliveryFee',
    'delivery_fee', 'logisticsFee', 'logistics_fee', 'carriage', 'expressFee',
    'express_fee', 'transportFee', 'transport_fee', 'shipFee', 'ship_fee',
    'freeShipping', 'free_shipping', 'isFreeShipping', 'is_free_shipping'
  ];
  const freightByTitle = new Map();

  function text(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? '包邮' : '';
    if (typeof value === 'object') {
      return [value.text, value.desc, value.description, value.name, value.value]
        .map(text).find(Boolean) || '';
    }
    return String(value).trim();
  }

  function isUseful(value) {
    const valueText = text(value);
    return !!valueText && !/^(?:0|0\.0+|false|null|undefined|none|-)$/i.test(valueText) &&
      /包邮|免邮|运费|邮费|配送|快递|物流|¥|￥|元|free\s*shipping/i.test(valueText);
  }

  function getFreight(product) {
    if (!product || typeof product !== 'object') return '';
    const groups = [product, product.tradeInfo, product.trade_info, product.delivery,
      product.shippingInfo, product.shipping_info, product.logistics];
    for (const group of groups) {
      if (!group || typeof group !== 'object') continue;
      for (const field of FIELD_NAMES) {
        const value = group[field];
        if (value === true && /free/i.test(field)) return '包邮';
        if (isUseful(value)) return text(value);
      }
    }
    return '';
  }

  function rememberResults(payload) {
    const resultGroups = payload && payload.results;
    if (!resultGroups || typeof resultGroups !== 'object') return;
    Object.values(resultGroups).forEach(group => {
      const products = Array.isArray(group?.results) ? group.results : [];
      products.forEach(product => {
        const freight = getFreight(product);
        const title = String(product?.title || '').trim();
        if (title && freight) freightByTitle.set(title, freight);
      });
    });
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const response = await nativeFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (/\/api\/results\//.test(url)) {
        response.clone().json().then(rememberResults).catch(() => {});
      }
    } catch (error) { /* 不影响原图搜请求 */ }
    return response;
  };

  function attachToCard(card) {
    if (!card || card.querySelector('.product-freight')) return;
    const titleNode = card.querySelector('.product-title');
    const title = String(titleNode?.textContent || '').trim();
    const freight = freightByTitle.get(title);
    if (!freight) return;
    const target = card.querySelector('.product-body') || card;
    const line = document.createElement('div');
    line.className = 'product-freight';
    line.textContent = `运费：${freight}`;
    target.insertBefore(line, target.querySelector('.product-shop') || null);
  }

  function scan(root) {
    root.querySelectorAll('.product-card').forEach(attachToCard);
  }

  function observe(root) {
    if (!root) return;
    scan(root);
    new MutationObserver(() => scan(root)).observe(root, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '.product-freight{margin-top:6px;color:#e76500;font-size:12px;line-height:1.45;word-break:break-word}.product-freight:empty{display:none}';
    document.head.appendChild(style);
    observe(document.getElementById('resultList'));
    observe(document.getElementById('resultModalGrid'));
  });
})();
