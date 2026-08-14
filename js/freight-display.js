/* 图搜结果运费展示：只使用接口已经返回的字段，不发起额外运费查询。 */
(function () {
  'use strict';

  const FIELD_NAMES = [
    'freight', 'freightText', 'freight_text', 'shipping', 'shippingText',
    'shipping_text', 'postage', 'postageText', 'postage_text', 'deliveryFee',
    'delivery_fee', 'logisticsFee', 'logistics_fee', 'carriage', 'expressFee',
    'express_fee', 'transportFee', 'transport_fee', 'shipFee', 'ship_fee',
    'freeShipping', 'free_shipping', 'isFreeShipping', 'is_free_shipping'
  ];

  function text(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? '包邮' : '';
    if (typeof value === 'object') {
      return [value.text, value.desc, value.description, value.name, value.value]
        .map(text)
        .find(Boolean) || '';
    }
    return String(value).trim();
  }

  function isUseful(value) {
    const valueText = text(value);
    if (!valueText || /^(?:0|0\.0+|false|null|undefined|none|-)$/i.test(valueText)) return false;
    return /包邮|免邮|运费|邮费|配送|快递|物流|¥|￥|元|free\s*shipping/i.test(valueText);
  }

  function getFreight(product) {
    if (!product || typeof product !== 'object') return '';
    for (const field of FIELD_NAMES) {
      const value = product[field];
      if (value === true && /free/i.test(field)) return '包邮';
      if (isUseful(value)) return text(value);
    }

    const nested = [product.tradeInfo, product.trade_info, product.delivery, product.shippingInfo, product.shipping_info, product.logistics];
    for (const group of nested) {
      if (!group || typeof group !== 'object') continue;
      for (const field of FIELD_NAMES) {
        const value = group[field];
        if (value === true && /free/i.test(field)) return '包邮';
        if (isUseful(value)) return text(value);
      }
    }
    return '';
  }

  function attachToCard(card, product) {
    if (!card || card.querySelector('.product-freight')) return;
    const freight = getFreight(product);
    if (!freight) return;

    const target = card.querySelector('.product-body') || card;
    const line = document.createElement('div');
    line.className = 'product-freight';
    line.textContent = `运费：${freight}`;
    target.appendChild(line);
  }

  function sourceProduct(card) {
    return card && (card._product || card.__product || card.dataset.product
      ? card._product || card.__product || JSON.parse(card.dataset.product)
      : null);
  }

  function scan(root) {
    root.querySelectorAll('.product-card').forEach(card => {
      try { attachToCard(card, sourceProduct(card)); } catch (error) { /* 忽略无效卡片数据 */ }
    });
  }

  function installStyle() {
    const style = document.createElement('style');
    style.textContent = '.product-freight{margin-top:6px;color:#e76500;font-size:12px;line-height:1.45;word-break:break-word}.product-freight:empty{display:none}';
    document.head.appendChild(style);
  }

  function observe() {
    const list = document.getElementById('resultList');
    const modal = document.getElementById('resultModalGrid');
    [list, modal].filter(Boolean).forEach(root => {
      scan(root);
      new MutationObserver(() => scan(root)).observe(root, { childList: true, subtree: true });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    installStyle();
    observe();
  });
})();
