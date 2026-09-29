// ==UserScript==
// @name         极简超级鼠标拖拽 (Super Drag v3.4 工业加固版)
// @namespace    http://tampermonkey.net/
// @version      3.5.0
// @description  鼠标左键拖拽选中文本、链接、图片快速搜索与打开。就地内联通知、域名严格匹配、智能协议补齐、防配置雪崩与全闭环抗抖手势（架构加固版）。
// @author       lyscop (Refactored) & Gemini Architecture
// @match        *://*/*
// @run-at       document-end
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @require      https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js
// ==/UserScript==

/* eslint no-multi-spaces: "off" */
/* global qrcode */

(function () {
    'use strict';

    // 幂等单例锁：防止脚本或扩展在单页面生命周期内重复实例化
    const LOCK_KEY = '__SUPER_DRAG_INITIALIZED__';
    if (window[LOCK_KEY]) return;
    window[LOCK_KEY] = true;

    // 顶层窗口隔离：阻断广告、追踪器及无意义的第三方微型 iframe 递归注入，杜绝内存击穿
    if (window.top !== window.self) return;

    try {
        const DEFAULT_CFG = {
            Gesture: {
                suppressionKey: "altKey",
                distanceThreshold: 5,
                distanceSensitivity: 20
            },
            Hinter: {
                fontSize: 22,
                funNotDefine: "(◔‸◔) 未定义动作"
            },
            Drag: {
                linktextAslink: true,
                dragInTextarea: false
            },
            blacklist: "figma.com\nprocesson.com\ncanva.com",
            directions: 8,
            language: "zh",
            text: {
                "1": { name: "searchText", arg: ["https://javdb.com/search?q=", false, true], alias: "JavDB" },
                "2": { name: "searchText", arg: ["https://www.google.com/search?q=", false, true], alias: "谷歌搜索" },
                "3": { name: "searchText", arg: ["https://missav.live/ja/search/", false, true], alias: "Miss" },
                "4": { name: "openInternal", arg: ["edge://settings/profiles", true, true], alias: "打开设置" },
                "6": { name: "searchText", arg: ["https://www.baidu.com/s?wd=", false, true], alias: "百度搜索" },
                "7": { name: "searchText", arg: ["https://supjav.com/zh/?s=", true, true], alias: "Supjav" },
                "8": { name: "showQRCode", arg: [], alias: "生成二维码" },
                "9": { name: "searchText", arg: ["https://javgiga.com/?s=", true, true], alias: "javgiga" }
            },
            link: {
                "2": { name: "copyLink", arg: [], alias: "复制链接" },
                "4": { name: "copyLinkText", arg: [], alias: "复制链接文字" },
                "6": { name: "openLink", arg: [false, true], alias: "打开链接" },
                "8": { name: "showQRCode", arg: [], alias: "手机扫码打开" }
            },
            image: {
                "1": { name: "copyImgURL", arg: [], alias: "复制图片直链" },
                "2": { name: "searchImg", arg: ["https://www.google.com/searchbyimage?image_url=%s", false, true], alias: "谷歌搜索图片" },
                "4": { name: "searchImg", arg: ["https://www.tineye.com/search?url=%s", false, true], alias: "动漫搜图" },
                "6": { name: "searchImg", arg: ["https://yandex.com/images/search?rpt=imageview&url=%s", false, true], alias: "Yandex搜图" },
                "8": { name: "openImgLink", arg: [true, true], alias: "打开图片链接" },
                "9": { name: "copyImgLink", arg: [], alias: "复制图片链接" },
                "46": { name: "saveImg", arg: [], alias: "保存图片" },
                "64": { name: "copyImg", arg: [], alias: "复制图片" }
            }
        };

        const PRESETS = [
            { name: "MissAV 搜索", url: "https://missav.live/ja/search/%s", alias: "Miss" },
            { name: "JavDB 番号", url: "https://javdb.com/search?q=%s", alias: "JavDB" },
            { name: "Supjav 搜索", url: "https://supjav.com/zh/?s=%s", alias: "Supjav" },
            { name: "JavGiga 搜索", url: "https://javgiga.com/?s=%s", alias: "JavGiga" },
            { name: "谷歌搜索", url: "https://www.google.com/search?q=%s", alias: "谷歌搜索" },
            { name: "百度搜索", url: "https://www.baidu.com/s?wd=%s", alias: "百度搜索" },
            { name: "必应 Bing", url: "https://www.bing.com/search?q=%s", alias: "Bing" },
            { name: "哔哩哔哩", url: "https://search.bilibili.com/all?keyword=%s", alias: "Bilibili" },
            { name: "GitHub 代码", url: "https://github.com/search?q=%s", alias: "GitHub" }
        ];

        function sanitizeConfig(config) {
            if (!config || typeof config !== 'object') return JSON.parse(JSON.stringify(DEFAULT_CFG));
            const merged = Object.assign({}, DEFAULT_CFG, config);
            merged.Gesture = Object.assign({}, DEFAULT_CFG.Gesture, config.Gesture || {});
            merged.Hinter = Object.assign({}, DEFAULT_CFG.Hinter, config.Hinter || {});
            merged.Drag = Object.assign({}, DEFAULT_CFG.Drag, config.Drag || {});
            merged.text = Object.assign({}, DEFAULT_CFG.text, config.text || {});
            merged.link = Object.assign({}, DEFAULT_CFG.link, config.link || {});
            merged.image = Object.assign({}, DEFAULT_CFG.image, config.image || {});

            ['text', 'link', 'image'].forEach(type => {
                if (!merged[type]) return;
                Object.keys(merged[type]).forEach(key => {
                    const item = merged[type][key];
                    if (item && Array.isArray(item.arg)) {
                        item.arg = item.arg.map(v => (v === 'ture' || v === 'true' ? true : v === 'false' ? false : v));
                    }
                });
            });
            return merged;
        }

        let cfg = sanitizeConfig(GM_getValue('cfg', DEFAULT_CFG));

        if (typeof GM_addValueChangeListener !== 'undefined') {
            GM_addValueChangeListener('cfg', (name, oldVal, newVal, remote) => {
                if (remote) cfg = sanitizeConfig(newVal);
            });
        }

        const DIR_DEGS = {
            '2': 0,
            '3': 45,
            '6': 90,
            '9': 135,
            '8': 180,
            '7': 225,
            '4': 270,
            '1': 315
        };

        const ARROW_NAMES = {
            '1': '左上', '2': '正上', '3': '右上',
            '4': '向左', '6': '向右',
            '7': '左下', '8': '正下', '9': '右下'
        };

        function getArrowSvg(dir, size = 26) {
            const deg = DIR_DEGS[dir] !== undefined ? DIR_DEGS[dir] : 0;
            return `<svg class="sd-arrow-icon" viewBox="0 0 24 24" width="${size}" height="${size}" style="transform: rotate(${deg}deg); display: inline-block; vertical-align: middle; flex-shrink: 0;" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"></line><polyline points="5 11 12 4 19 11"></polyline></svg>`;
        }

        function buildUrl(template, query) {
            const enc = encodeURIComponent(query);
            if (template.includes('U-R-L')) return template.replace(/U-R-L/g, enc);
            if (template.includes('%s')) return template.replace(/%s/g, enc);
            return template + enc;
        }

        function ensureProtocol(url) {
            if (!url) return '';
            const trimmed = url.trim();
            if (/^[a-zA-Z]+:\/\//.test(trimmed)) return trimmed;
            return 'https://' + trimmed;
        }

        function isLikelyURL(str) {
            if (!str) return false;
            const trimmed = str.trim();
            try {
                const u = new URL(trimmed);
                return u.protocol === 'http:' || u.protocol === 'https:';
            } catch (e) {
                return /^((https?:\/\/)?[\w-]+(\.[\w-]+)+\.?(:\d+)?(\/\S*)?)$/i.test(trimmed);
            }
        }

        const Actions = {
            searchText(arg, data) {
                const [baseUrl, active = true, insert = true] = arg;
                const raw = data.textSelection || '';
                const query = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
                const url = buildUrl(baseUrl, query);
                GM_openInTab(url, { active: Boolean(active), insert: Boolean(insert), setParent: true });
            },
            openInternal(arg) {
                const [url, active = true, insert = true] = arg;
                GM_openInTab(url, { active: Boolean(active), insert: Boolean(insert), setParent: true });
            },
            openLink(arg, data) {
                const [active = false, insert = true] = arg;
                const target = data.linkUrl || data.textSelection;
                if (target) {
                    GM_openInTab(ensureProtocol(target), { active: Boolean(active), insert: Boolean(insert), setParent: true });
                }
            },
            copyLink(arg, data) {
                const target = data.linkUrl || data.textSelection;
                if (target) {
                    GM_setClipboard(ensureProtocol(target), 'text');
                    Toast.show('已复制链接');
                }
            },
            copyLinkText(arg, data) {
                const target = data.linkText || data.textSelection;
                if (target) {
                    GM_setClipboard(target, 'text');
                    Toast.show('已复制链接文字');
                }
            },
            copyText(arg, data) {
                if (data.textSelection) {
                    GM_setClipboard(data.textSelection, 'text');
                    Toast.show('已复制选中文本');
                }
            },
            showQRCode(arg, data) {
                const content = data.linkUrl || data.textSelection || data.imgSrc;
                QRModal.show(content, 'page');
            },
            openImgURL(arg, data) {
                if (data.imgSrc) GM_openInTab(data.imgSrc, { active: true, insert: true, setParent: true });
            },
            copyImgURL(arg, data) {
                if (data.imgSrc) {
                    GM_setClipboard(data.imgSrc, 'text');
                    Toast.show('已复制图片直链');
                }
            },
            openImgLink(arg, data) {
                const target = data.linkUrl || data.imgSrc;
                if (target) GM_openInTab(ensureProtocol(target), { active: true, insert: true, setParent: true });
            },
            copyImgLink(arg, data) {
                const target = data.linkUrl || data.imgSrc;
                if (target) {
                    GM_setClipboard(ensureProtocol(target), 'text');
                    Toast.show('已复制图片源链接');
                }
            },
            searchImg(arg, data) {
                const [searchUrl, active = false, insert = true] = arg;
                if (data.imgSrc && searchUrl) {
                    const target = buildUrl(searchUrl, data.imgSrc);
                    GM_openInTab(target, { active: Boolean(active), insert: Boolean(insert), setParent: true });
                }
            },
            saveImg(arg, data) {
                if (!data.imgSrc) return;
                const d = new Date();
                const pad = n => String(n).padStart(2, '0');
                const timeStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
                const ext = (data.imgSrc.split('.').pop() || 'png').split(/[?#]/)[0];
                const filename = `image-${timeStr}.${ext.length <= 4 ? ext : 'png'}`;

                if (data.imgSrc.startsWith('data:') || data.imgSrc.startsWith('blob:')) {
                    const a = document.createElement('a');
                    a.href = data.imgSrc;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    Toast.show('图片已保存');
                    return;
                }

                GM_download({ url: data.imgSrc, name: filename });
                Toast.show('正在保存图片');
            },
            copyImg(arg, data) {
                if (!data.imgSrc) return;
                Toast.show('正在读取图片...');

                const handleBlob = async (blob) => {
                    try {
                        const bitmap = await createImageBitmap(blob);
                        const canvas = document.createElement('canvas');
                        canvas.width = bitmap.width;
                        canvas.height = bitmap.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(bitmap, 0, 0);
                        canvas.toBlob(async (pngBlob) => {
                            if (!pngBlob) throw new Error('Canvas 转码失败');
                            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
                            Toast.show('图片已复制到剪贴板');
                        }, 'image/png');
                    } catch (e) {
                        GM_setClipboard(data.imgSrc, 'text');
                        Toast.show('复制二进制失败，已回退复制链接');
                    }
                };

                if (data.imgSrc.startsWith('data:') || data.imgSrc.startsWith('blob:')) {
                    fetch(data.imgSrc).then(r => r.blob()).then(handleBlob).catch(() => {
                        GM_setClipboard(data.imgSrc, 'text');
                        Toast.show('已复制图片链接');
                    });
                    return;
                }

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: data.imgSrc,
                    responseType: 'blob',
                    onload: (res) => handleBlob(res.response),
                    onerror: () => Toast.show('图片请求失败')
                });
            }
        };

        function recordMetric(actionName) {
            if (!actionName) return;
            const metrics = GM_getValue('metrics_data', {});
            const now = new Date().toLocaleString();
            metrics[actionName] = metrics[actionName] || { name: actionName, times: 0, date: now };
            metrics[actionName].times += 1;
            metrics[actionName].date = now;
            GM_setValue('metrics_data', metrics);
        }

        const Toast = (function () {
            let el = null;
            let timer = null;
            function init() {
                if (el) return;
                el = document.createElement('div');
                el.id = 'superdrag-toast';
                document.documentElement.appendChild(el);
            }
            return {
                show(msg) {
                    init();
                    el.textContent = msg;
                    el.style.opacity = '1';
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        el.style.opacity = '0';
                    }, 2200);
                }
            };
        })();

        const HUD = (function () {
            let box = null;
            let arrowEl = null;
            let textEl = null;

            function init() {
                if (box) return;
                box = document.createElement('div');
                box.id = 'superdrag-hud';

                arrowEl = document.createElement('div');
                arrowEl.className = 'superdrag-hud-arrows';

                textEl = document.createElement('div');
                textEl.className = 'superdrag-hud-action';

                box.appendChild(arrowEl);
                box.appendChild(textEl);
                document.documentElement.appendChild(box);
            }

            return {
                update(directions, actionTitle) {
                    init();
                    arrowEl.innerHTML = directions.map(d => getArrowSvg(d, 28)).join('');
                    textEl.textContent = actionTitle || cfg.Hinter.funNotDefine;
                    box.style.display = 'flex';
                },
                hide() {
                    if (box) box.style.display = 'none';
                }
            };
        })();

        const QRModal = (function () {
            let modal = null;
            let bodyEl = null;
            let inputEl = null;
            let sourceTabs = null;
            let tipEl = null;
            let originalContent = '';
            let debounceTimer = null;
            const MAX_SAFE_LEN = 800;

            function setLocalTip(msg, isWarn = false) {
                if (!tipEl) return;
                tipEl.textContent = msg;
                tipEl.style.color = isWarn ? '#ef4444' : '#94a3b8';
            }

            function renderQR(text) {
                if (!text || !text.trim()) {
                    bodyEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:80px 0;">无内容可生成</div>';
                    return;
                }

                if (text.length > MAX_SAFE_LEN) {
                    bodyEl.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:45px 12px;line-height:1.6;text-align:center;">
                        <b>文本过大 (${text.length} 字)</b><br>已超出二维码安全承载上限 (${MAX_SAFE_LEN}字)<br>请删减文本以避免浏览器卡死
                    </div>`;
                    return;
                }

                try {
                    const qrLib = window.qrcode || (typeof qrcode !== 'undefined' ? qrcode : null);
                    if (qrLib) {
                        const qr = qrLib(0, 'M');
                        qr.addData(unescape(encodeURIComponent(text)));
                        qr.make();
                        bodyEl.innerHTML = qr.createSvgTag(4, 0);
                    } else {
                        const img = document.createElement('img');
                        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(text)}`;
                        bodyEl.innerHTML = '';
                        bodyEl.appendChild(img);
                    }
                } catch (e) {
                    bodyEl.innerHTML = '<div style="color:#ef4444;font-size:12px;padding:80px 0;">生成失败：编码超限</div>';
                }
            }

            async function getSafeClipboardContent() {
                if (navigator.clipboard && navigator.clipboard.read) {
                    try {
                        const items = await navigator.clipboard.read();
                        for (const item of items) {
                            if (item.types.some(t => t.startsWith('image/'))) {
                                return { isImage: true, text: '' };
                            }
                        }
                    } catch (e) {}
                }

                if (navigator.clipboard && navigator.clipboard.readText) {
                    try {
                        const text = await navigator.clipboard.readText();
                        return { isImage: false, text: text || '' };
                    } catch (e) {
                        throw new Error('权限受限');
                    }
                }
                return { isImage: false, text: '' };
            }

            function init() {
                if (modal) return;
                modal = document.createElement('div');
                modal.id = 'superdrag-qr-modal';
                modal.innerHTML = `
                    <div class="sd-qr-box">
                        <div class="sd-qr-header">
                            <span class="sd-qr-title">扫码流转中心</span>
                            <div class="sd-qr-pills">
                                <button class="sd-qr-pill active" data-src="page">🌐 当前网页</button>
                                <button class="sd-qr-pill" data-src="clip">📋 剪贴板</button>
                                <button class="sd-qr-pill" data-src="drag">选中文本</button>
                            </div>
                        </div>
                        <div class="sd-qr-render"></div>
                        <textarea class="sd-qr-input" rows="2" placeholder="可在此直接编辑文本实时更新二维码..."></textarea>
                        <div class="sd-qr-tip">按 ESC 或点击背景遮罩退出</div>
                    </div>
                `;
                document.documentElement.appendChild(modal);

                bodyEl = modal.querySelector('.sd-qr-render');
                inputEl = modal.querySelector('.sd-qr-input');
                sourceTabs = modal.querySelectorAll('.sd-qr-pill');
                tipEl = modal.querySelector('.sd-qr-tip');

                inputEl.addEventListener('input', () => {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        renderQR(inputEl.value);
                    }, 200);
                });

                sourceTabs.forEach(tab => {
                    tab.onclick = async () => {
                        sourceTabs.forEach(t => t.classList.remove('active'));
                        tab.classList.add('active');
                        const src = tab.dataset.src;

                        if (src === 'page') {
                            inputEl.value = window.location.href;
                            renderQR(window.location.href);
                            setLocalTip('已载入当前网页 URL');
                        } else if (src === 'clip') {
                            try {
                                const res = await getSafeClipboardContent();
                                if (res.isImage) {
                                    bodyEl.innerHTML = '<div style="color:#f59e0b;font-size:12px;padding:45px 12px;text-align:center;line-height:1.6;"><b>剪贴板中是图片</b><br>二维码仅支持传输纯文本或链接</div>';
                                    inputEl.value = '';
                                    setLocalTip('剪贴板中为图片，无法转为二维码', true);
                                    return;
                                }
                                inputEl.value = res.text;
                                renderQR(res.text);
                                setLocalTip('已成功读取剪贴板文本');
                            } catch (err) {
                                setLocalTip('读取剪贴板失败，请检查浏览器权限', true);
                            }
                        } else if (src === 'drag') {
                            inputEl.value = originalContent;
                            renderQR(originalContent);
                            setLocalTip('已恢复选中文本');
                        }
                    };
                });

                modal.onclick = (e) => {
                    if (e.target === modal) hide();
                };
            }

            function show(content, defaultSource = 'page') {
                init();
                originalContent = content || '';
                sourceTabs.forEach(t => t.classList.remove('active'));
                setLocalTip('按 ESC 或点击背景遮罩退出');

                const activeTab = modal.querySelector(`.sd-qr-pill[data-src="${defaultSource}"]`) || sourceTabs[0];
                activeTab.classList.add('active');

                if (defaultSource === 'page') {
                    inputEl.value = window.location.href;
                    renderQR(window.location.href);
                } else if (defaultSource === 'clip') {
                    getSafeClipboardContent().then(res => {
                        if (res.isImage) {
                            bodyEl.innerHTML = '<div style="color:#f59e0b;font-size:12px;padding:45px 12px;text-align:center;line-height:1.6;"><b>剪贴板中是图片</b><br>二维码仅支持传输纯文本或链接</div>';
                            inputEl.value = '';
                            setLocalTip('剪贴板中为图片内容', true);
                        } else {
                            inputEl.value = res.text || originalContent;
                            renderQR(inputEl.value);
                        }
                    }).catch(() => {
                        inputEl.value = originalContent;
                        renderQR(originalContent);
                    });
                } else {
                    inputEl.value = originalContent;
                    renderQR(originalContent);
                }

                modal.style.display = 'flex';
            }

            function hide() {
                if (modal) modal.style.display = 'none';
            }

            return {
                show,
                hide,
                isShowing() {
                    return modal && modal.style.display === 'flex';
                }
            };
        })();

        const DragEngine = (function () {
            let startPos = { x: 0, y: 0 };
            let lastPos = { x: 0, y: 0 };
            let directions = [];
            let dragType = null;
            let dragData = {};
            let isDragging = false;
            let hasDropped = false;
            let isCanceled = false;

            function isDomainBlocked() {
                if (!cfg.blacklist) return false;
                const host = window.location.hostname.toLowerCase();
                const list = cfg.blacklist.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);
                return list.some(item => host === item || host.endsWith('.' + item));
            }

            function getTargetData(target) {
                const data = {};
                const link = target.closest ? target.closest('a, area') : target.parentElement?.closest('a, area');
                if (link) {
                    data.linkUrl = link.href;
                    data.linkText = (link.textContent || '').trim();
                }
                if (target.nodeName === 'IMG') {
                    data.imgSrc = target.currentSrc || target.src;
                    data.imgAlt = target.alt || '';
                }

                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
                    const s = activeEl.selectionStart;
                    const end = activeEl.selectionEnd;
                    if (typeof s === 'number' && typeof end === 'number' && s !== end) {
                        data.textSelection = activeEl.value.substring(s, end);
                    }
                }

                if (!data.textSelection) {
                    data.textSelection = (window.getSelection() ? window.getSelection().toString() : '').trim();
                }

                return data;
            }

            function getDirection(x1, y1, x2, y2) {
                const dx = x2 - x1;
                const dy = y2 - y1;
                let deg = Math.atan2(dy, dx) * 180 / Math.PI;
                if (deg < 0) deg += 360;

                if (deg >= 337.5 || deg < 22.5) return '6';
                if (deg >= 22.5 && deg < 67.5) return '9';
                if (deg >= 67.5 && deg < 112.5) return '8';
                if (deg >= 112.5 && deg < 157.5) return '7';
                if (deg >= 157.5 && deg < 202.5) return '4';
                if (deg >= 202.5 && deg < 247.5) return '1';
                if (deg >= 247.5 && deg < 292.5) return '2';
                if (deg >= 292.5 && deg < 337.5) return '3';
                return '6';
            }

            function matchAction(type, dirs, curX, curY) {
                if (!cfg[type] || dirs.length === 0) return null;
                const fullCode = dirs.join('');

                if (cfg[type][fullCode]) return cfg[type][fullCode];

                if (dirs.length <= 2 && curX !== undefined && curY !== undefined) {
                    const totalDist = Math.hypot(curX - startPos.x, curY - startPos.y);
                    if (totalDist >= cfg.Gesture.distanceSensitivity) {
                        const overallDir = getDirection(startPos.x, startPos.y, curX, curY);
                        if (cfg[type][overallDir]) return cfg[type][overallDir];
                    }
                }

                return null;
            }

            function cancel() {
                if (!isDragging) return;
                isCanceled = true;
                hasDropped = false;
                isDragging = false;
                HUD.hide();
                Toast.show('已取消拖拽操作');
            }

            function handleDragStart(e) {
                if (isDomainBlocked()) return;
                if (cfg.Gesture.suppressionKey && e[cfg.Gesture.suppressionKey]) return;

                // 避让通道：跳过文件拖拽与上传控件交互，保证网盘/邮件上传不受干扰
                if (e.target && (e.target.type === 'file' || e.target.closest?.('input[type="file"]'))) return;
                if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) return;

                const activeEl = document.activeElement;
                const inInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
                if (!cfg.Drag.dragInTextarea && inInput) {
                    return;
                }

                dragData = getTargetData(e.target);

                if (dragData.textSelection && dragData.textSelection.length > 0) {
                    if (cfg.Drag.linktextAslink && isLikelyURL(dragData.textSelection)) {
                        dragType = 'link';
                        dragData.linkUrl = ensureProtocol(dragData.textSelection);
                    } else {
                        dragType = 'text';
                    }
                } else if (dragData.imgSrc) {
                    dragType = 'image';
                } else if (dragData.linkUrl) {
                    dragType = 'link';
                } else {
                    dragType = null;
                    return;
                }

                isDragging = true;
                hasDropped = false;
                isCanceled = false;
                directions = [];
                startPos = { x: e.clientX, y: e.clientY };
                lastPos = { x: e.clientX, y: e.clientY };
            }

            function handleDrag(e) {
                if (!isDragging || isCanceled) return;
                if (e.clientX === 0 && e.clientY === 0) return;

                const dist = Math.hypot(e.clientX - lastPos.x, e.clientY - lastPos.y);
                const totalDist = Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y);

                if (totalDist < cfg.Gesture.distanceThreshold) return;

                if (dist > cfg.Gesture.distanceSensitivity) {
                    const dir = getDirection(lastPos.x, lastPos.y, e.clientX, e.clientY);
                    const lastDir = directions[directions.length - 1];

                    if (lastDir !== dir && directions.length < 4) {
                        directions.push(dir);
                        const actionObj = matchAction(dragType, directions, e.clientX, e.clientY);
                        const actionName = actionObj ? (actionObj.alias || actionObj.name) : null;
                        HUD.update(directions, actionName);
                    }
                    lastPos = { x: e.clientX, y: e.clientY };
                }
            }

            function handleDragOver(e) {
                if (isDragging && !isCanceled) {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                }
            }

            function handleDrop(e) {
                if (isDragging && !isCanceled) {
                    e.preventDefault();
                    hasDropped = true;
                    lastPos = { x: e.clientX, y: e.clientY };
                }
            }

            function handleDragEnd() {
                if (!isDragging) return;
                HUD.hide();

                if (hasDropped && !isCanceled && directions.length > 0 && dragType) {
                    const actionObj = matchAction(dragType, directions, lastPos.x, lastPos.y);
                    if (actionObj && Actions[actionObj.name]) {
                        try {
                            Actions[actionObj.name](actionObj.arg, dragData);
                            recordMetric(actionObj.alias || actionObj.name);
                        } catch (err) {
                            console.error('[SuperDrag] 执行动作失败:', err);
                        }
                    }
                }

                isDragging = false;
                hasDropped = false;
                isCanceled = false;
                directions = [];
                dragType = null;
                dragData = {};
            }

            function handleMouseDown(e) {
                if (isDragging && e.button === 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    cancel();
                }
            }

            function handleContextMenu(e) {
                if (isDragging || isCanceled) {
                    e.preventDefault();
                }
            }

            return {
                init() {
                    window.addEventListener('dragstart', handleDragStart, true);
                    window.addEventListener('drag', handleDrag, true);
                    window.addEventListener('dragover', handleDragOver, true);
                    window.addEventListener('drop', handleDrop, true);
                    window.addEventListener('dragend', handleDragEnd, true);
                    window.addEventListener('mousedown', handleMouseDown, true);
                    window.addEventListener('contextmenu', handleContextMenu, true);
                },
                cancel,
                isDraggingState() {
                    return isDragging;
                }
            };
        })();

        const Settings = (function () {
            let hostEl = null;
            let shadow = null;
            let currentTab = 'text';
            let editingKey = null;

            const ACTION_TYPES = {
                text: [
                    { id: 'searchText', name: '搜索引擎 (URL)' },
                    { id: 'openInternal', name: '打开固定网址' },
                    { id: 'copyText', name: '复制文本' },
                    { id: 'showQRCode', name: '生成二维码' }
                ],
                link: [
                    { id: 'openLink', name: '打开链接' },
                    { id: 'copyLink', name: '复制链接' },
                    { id: 'copyLinkText', name: '复制链接文字' },
                    { id: 'showQRCode', name: '生成二维码' }
                ],
                image: [
                    { id: 'searchImg', name: '搜索图片 (URL)' },
                    { id: 'saveImg', name: '保存图片' },
                    { id: 'copyImg', name: '复制图片到剪贴板' },
                    { id: 'copyImgURL', name: '复制图片直链' },
                    { id: 'openImgLink', name: '打开图片源链接' },
                    { id: 'copyImgLink', name: '复制图片源链接' },
                    { id: 'showQRCode', name: '生成二维码' }
                ]
            };

            const ACTION_LABELS = {
                searchText: '搜索',
                openInternal: '打开内置网址',
                copyText: '复制文本',
                openLink: '打开网页链接',
                copyLink: '复制链接到剪贴板',
                copyLinkText: '复制链接标题文字',
                showQRCode: '生成二维码',
                searchImg: '以图搜图',
                saveImg: '下载保存图片',
                copyImg: '写入剪贴板图片二进制',
                copyImgURL: '复制图片直链',
                openImgLink: '在新标签页打开图片',
                copyImgLink: '复制图片源链接'
            };

            const SHADOW_CSS = `
                :host { all: initial; }
                .sd-mask {
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px);
                    z-index: 2147483646; display: flex; align-items: center; justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                .sd-modal {
                    background: #ffffff; width: 720px; max-width: 92vw; height: 620px; max-height: 88vh;
                    border-radius: 14px; box-shadow: 0 20px 40px rgba(0,0,0,0.25);
                    display: flex; flex-direction: column; overflow: hidden;
                }
                .sd-header {
                    padding: 14px 22px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
                    display: flex; justify-content: space-between; align-items: center;
                }
                .sd-header h2 { margin: 0; font-size: 17px; color: #0f172a; font-weight: 600; }
                .sd-close { font-size: 22px; color: #64748b; cursor: pointer; border: none; background: transparent; line-height: 1; }
                .sd-tabs { display: flex; background: #f1f5f9; padding: 0 16px; border-bottom: 1px solid #e2e8f0; }
                .sd-tab {
                    padding: 10px 18px; font-size: 13px; font-weight: 500; color: #64748b;
                    cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s;
                }
                .sd-tab.active { color: #2563eb; border-bottom-color: #2563eb; background: #ffffff; font-weight: 600; }
                .sd-body {
                    flex: 1; overflow-y: auto; padding: 18px 22px; scroll-behavior: smooth;
                    scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
                }
                .sd-body::-webkit-scrollbar { width: 6px; }
                .sd-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
                .sd-rule-list { display: flex; flex-direction: column; gap: 8px; }
                .sd-rule-card {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0;
                    border-radius: 8px; transition: border-color 0.2s;
                }
                .sd-rule-card:hover { border-color: #cbd5e1; }
                .sd-rule-info { display: flex; align-items: center; gap: 12px; }
                .sd-badge {
                    background: #eff6ff; color: #2563eb; font-weight: 700;
                    padding: 4px 10px; border-radius: 6px; border: 1px solid #bfdbfe;
                    min-width: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
                }
                .sd-rule-text b { font-size: 13px; color: #1e293b; display: flex; align-items: center; gap: 8px; }
                .sd-tag { font-size: 11px; padding: 1px 5px; border-radius: 4px; font-weight: normal; }
                .sd-tag.fg { background: #dcfce7; color: #166534; }
                .sd-tag.bg { background: #f1f5f9; color: #475569; }
                .sd-rule-text span { font-size: 12px; color: #64748b; max-width: 380px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
                .sd-rule-ops { display: flex; gap: 6px; }
                .btn {
                    padding: 5px 12px; font-size: 12px; font-weight: 500; border-radius: 6px;
                    cursor: pointer; border: 1px solid transparent; transition: all 0.15s;
                }
                .btn-primary { background: #2563eb; color: #ffffff; }
                .btn-primary:hover { background: #1d4ed8; }
                .btn-secondary { background: #ffffff; color: #475569; border-color: #cbd5e1; }
                .btn-secondary:hover { background: #f1f5f9; }
                .btn-danger { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }
                .btn-danger:hover { background: #fecaca; }
                .sd-editor-box {
                    background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin-bottom: 14px;
                    position: relative;
                }
                .sd-form-row { margin-bottom: 12px; }
                .sd-form-row label { display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 5px; }
                .sd-form-row input, .sd-form-row select, .sd-form-row textarea {
                    width: 100%; padding: 7px 10px; font-size: 12px; border: 1px solid #cbd5e1;
                    border-radius: 6px; box-sizing: border-box; outline: none;
                }
                .sd-form-row input:focus, .sd-form-row select:focus, .sd-form-row textarea:focus { border-color: #2563eb; }
                .sd-compass {
                    display: grid; grid-template-columns: repeat(3, 44px); gap: 5px; margin-top: 6px;
                }
                .sd-dir-btn {
                    height: 40px; display: flex; align-items: center; justify-content: center;
                    background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px;
                    cursor: pointer; color: #334155; transition: all 0.1s;
                }
                .sd-dir-btn:hover { background: #e2e8f0; }
                .sd-dir-btn.in-path { background: #dbeafe !important; color: #1d4ed8 !important; border-color: #93c5fd !important; }
                .sd-dir-btn.is-last { background: #2563eb !important; color: #ffffff !important; border-color: #2563eb !important; box-shadow: 0 0 0 2px rgba(37,99,235,0.25); }
                .sd-switches { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
                .sd-switch-item { display: flex; align-items: center; justify-content: space-between; max-width: 400px; }
                .sd-switch-info { display: flex; flex-direction: column; }
                .sd-switch-label { font-size: 12px; color: #1e293b; font-weight: 600; }
                .sd-switch-desc { font-size: 11px; color: #64748b; margin-top: 1px; }
                .switch {
                    position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0;
                }
                .switch input { opacity: 0; width: 0; height: 0; }
                .slider {
                    position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
                    background-color: #cbd5e1; transition: .2s; border-radius: 22px;
                }
                .slider:before {
                    position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px;
                    background-color: white; transition: .2s; border-radius: 50%;
                }
                input:checked + .slider { background-color: #2563eb; }
                input:checked + .slider:before { transform: translateX(18px); }
                .sd-inline-alert {
                    padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 12px;
                    display: none; align-items: center; gap: 6px; transition: all 0.2s;
                }
                .sd-inline-alert.error { background: #fee2e2; color: #b91c1c; border: 1px solid #f87171; display: flex; }
                .sd-inline-alert.warning { background: #fef3c7; color: #b45309; border: 1px solid #fcd34d; display: flex; }
                .sd-inline-alert.success { background: #dcfce7; color: #15803d; border: 1px solid #86efac; display: flex; }
            `;

            function init() {
                if (hostEl) return;
                hostEl = document.createElement('div');
                hostEl.id = 'superdrag-shadow-host';
                document.documentElement.appendChild(hostEl);
                shadow = hostEl.attachShadow({ mode: 'open' });

                const style = document.createElement('style');
                style.textContent = SHADOW_CSS;
                shadow.appendChild(style);

                const mask = document.createElement('div');
                mask.className = 'sd-mask';
                mask.style.display = 'none';
                mask.innerHTML = `
                    <div class="sd-modal">
                        <div class="sd-header">
                            <h2>超级拖拽设置中心</h2>
                            <button class="sd-close">&times;</button>
                        </div>
                        <div class="sd-tabs">
                            <div class="sd-tab active" data-tab="text">文本拖拽</div>
                            <div class="sd-tab" data-tab="link">链接拖拽</div>
                            <div class="sd-tab" data-tab="image">图片拖拽</div>
                            <div class="sd-tab" data-tab="general">高级与通用</div>
                        </div>
                        <div class="sd-body"></div>
                    </div>
                `;
                shadow.appendChild(mask);

                mask.querySelector('.sd-close').onclick = () => hide();
                mask.onclick = (e) => { if (e.target === mask) hide(); };

                mask.querySelectorAll('.sd-tab').forEach(tab => {
                    tab.onclick = () => {
                        mask.querySelectorAll('.sd-tab').forEach(t => t.classList.remove('active'));
                        tab.classList.add('active');
                        currentTab = tab.dataset.tab;
                        editingKey = null;
                        renderBody();
                    };
                });
            }

            function renderBody() {
                const body = shadow.querySelector('.sd-body');
                body.innerHTML = '';

                if (currentTab === 'general') {
                    renderGeneralTab(body);
                    return;
                }

                const isEditing = editingKey !== null;
                if (isEditing) {
                    renderEditor(body);
                } else {
                    renderRuleList(body);
                }
            }

            function renderRuleList(container) {
                const rules = cfg[currentTab] || {};
                const listWrap = document.createElement('div');
                listWrap.className = 'sd-rule-list';
                const addBar = document.createElement('div');
                addBar.style.marginBottom = '10px';
                addBar.innerHTML = `<button class="btn btn-primary" id="sd-add-btn">➕ 添加新规则</button>`;
                container.appendChild(addBar);
                addBar.querySelector('#sd-add-btn').onclick = () => {
                    editingKey = '__NEW__';
                    renderBody();
                };

                Object.keys(rules).forEach(key => {
                    const rule = rules[key];
                    const card = document.createElement('div');
                    card.className = 'sd-rule-card';

                    const arrowDisplay = key.split('').map(k => getArrowSvg(k, 16)).join('');
                    let detailText = '';

                    if (Array.isArray(rule.arg) && rule.arg[0] && typeof rule.arg[0] === 'string') {
                        detailText = rule.arg[0];
                    } else {
                        detailText = `动作: ${ACTION_LABELS[rule.name] || rule.name}`;
                    }

                    const isFg = Array.isArray(rule.arg) ? Boolean(rule.arg[1]) : false;
                    const fgBadge = ['searchText', 'openLink', 'openInternal', 'searchImg'].includes(rule.name)
                        ? `<span class="sd-tag ${isFg ? 'fg' : 'bg'}">${isFg ? '前台' : '后台'}</span>`
                        : '';

                    card.innerHTML = `
                        <div class="sd-rule-info">
                            <div class="sd-badge">${arrowDisplay}</div>
                            <div class="sd-rule-text">
                                <b>${rule.alias || rule.name} ${fgBadge}</b>
                                <span>${detailText}</span>
                            </div>
                        </div>
                        <div class="sd-rule-ops">
                            <button class="btn btn-secondary sd-edit-btn">编辑</button>
                            <button class="btn btn-danger sd-del-btn">删除</button>
                        </div>
                    `;

                    card.querySelector('.sd-edit-btn').onclick = () => {
                        editingKey = key;
                        renderBody();
                    };

                    card.querySelector('.sd-del-btn').onclick = () => {
                        delete cfg[currentTab][key];
                        GM_setValue('cfg', cfg);
                        renderBody();
                    };

                    listWrap.appendChild(card);
                });

                container.appendChild(listWrap);
            }

            function renderEditor(container) {
                const isNew = editingKey === '__NEW__';
                const ruleData = !isNew ? cfg[currentTab][editingKey] : {
                    name: currentTab === 'text' ? 'searchText' : (currentTab === 'link' ? 'openLink' : 'searchImg'),
                    alias: '',
                    arg: currentTab === 'text' ? ['', false, true] : []
                };

                let chosenDirection = isNew ? '3' : editingKey;
                let overwriteConfirmed = false;
                const editorBox = document.createElement('div');
                editorBox.className = 'sd-editor-box';

                const actionOpts = ACTION_TYPES[currentTab].map(act =>
                    `<option value="${act.id}" ${ruleData.name === act.id ? 'selected' : ''}>${act.name}</option>`
                ).join('');

                const presetOpts = PRESETS.map(p =>
                    `<option value="${p.url}" data-alias="${p.alias}">${p.name}</option>`
                ).join('');

                const showUrlField = ['searchText', 'openInternal', 'searchImg'].includes(ruleData.name);
                const currentUrl = Array.isArray(ruleData.arg) && typeof ruleData.arg[0] === 'string' ? ruleData.arg[0] : '';
                const isForeground = Array.isArray(ruleData.arg) ? Boolean(ruleData.arg[1]) : false;
                const isRightSide = Array.isArray(ruleData.arg) ? (ruleData.arg[2] !== false) : true;

                editorBox.innerHTML = `
                    <div class="sd-inline-alert" id="sd-editor-alert"></div>
                    <h3 style="margin:0 0 14px 0;font-size:15px;color:#0f172a;">${isNew ? '添加新规则' : '编辑规则'}</h3>
                    <div class="sd-form-row">
                        <label>拖拽方向 (再次点击末笔高亮键可反选撤销)：</label>
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                            <span id="sd-dir-desc" style="font-weight:700;color:#2563eb;font-size:14px;display:flex;align-items:center;gap:4px;"></span>
                            <div style="display:flex;gap:5px;flex-shrink:0;">
                                <button class="btn btn-secondary" id="sd-undo-dir" style="padding:3px 8px;">⌫ 回退</button>
                                <button class="btn btn-secondary" id="sd-clear-dir" style="padding:3px 8px;">清空重设</button>
                            </div>
                        </div>
                        <div class="sd-compass">
                            <button class="sd-dir-btn" data-d="1">${getArrowSvg('1', 18)}</button>
                            <button class="sd-dir-btn" data-d="2">${getArrowSvg('2', 18)}</button>
                            <button class="sd-dir-btn" data-d="3">${getArrowSvg('3', 18)}</button>
                            <button class="sd-dir-btn" data-d="4">${getArrowSvg('4', 18)}</button>
                            <button class="sd-dir-btn" style="background:#e2e8f0;" disabled>·</button>
                            <button class="sd-dir-btn" data-d="6">${getArrowSvg('6', 18)}</button>
                            <button class="sd-dir-btn" data-d="7">${getArrowSvg('7', 18)}</button>
                            <button class="sd-dir-btn" data-d="8">${getArrowSvg('8', 18)}</button>
                            <button class="sd-dir-btn" data-d="9">${getArrowSvg('9', 18)}</button>
                        </div>
                    </div>
                    <div class="sd-form-row">
                        <label>动作类型：</label>
                        <select id="sd-action-type">${actionOpts}</select>
                    </div>
                    ${currentTab === 'text' ? `
                    <div class="sd-form-row" id="sd-preset-row">
                        <label>从常用模板快速套用：</label>
                        <select id="sd-preset-select">
                            <option value="">-- 选择模板自动填充名称与地址 --</option>
                            ${presetOpts}
                        </select>
                    </div>` : ''}
                    <div class="sd-form-row">
                        <label>规则别名 (提示面板显示的名称)：</label>
                        <input type="text" id="sd-alias" value="${ruleData.alias || ''}" placeholder="例如: Miss / 谷歌搜索">
                    </div>
                    <div class="sd-form-row" id="sd-url-row" style="${showUrlField ? '' : 'display:none;'}">
                        <label>目标 URL 模板 (%s 自动替换关键词)：</label>
                        <input type="text" id="sd-url-template" value="${currentUrl}" placeholder="https://example.com/search?q=%s">
                    </div>
                    <div class="sd-form-row" id="sd-tab-options" style="${showUrlField || ruleData.name === 'openLink' ? '' : 'display:none;'}">
                        <label>标签页偏好：</label>
                        <div class="sd-switches">
                            <div class="sd-switch-item">
                                <div class="sd-switch-info">
                                    <span class="sd-switch-label">前台激活新标签页</span>
                                    <span class="sd-switch-desc">开启：立刻切换过去；关闭：后台静默打开</span>
                                </div>
                                <label class="switch">
                                    <input type="checkbox" id="sd-fg-check" ${isForeground ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>
                            <div class="sd-switch-item">
                                <div class="sd-switch-info">
                                    <span class="sd-switch-label">紧邻当前标签右侧打开</span>
                                    <span class="sd-switch-desc">开启：插入在右侧；关闭：排到标签栏最末尾</span>
                                </div>
                                <label class="switch">
                                    <input type="checkbox" id="sd-next-check" ${isRightSide ? 'checked' : ''}>
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:20px;">
                        <button class="btn btn-primary" id="sd-save-rule">保存规则</button>
                        <button class="btn btn-secondary" id="sd-cancel-rule">取消</button>
                    </div>
                `;

                const dirDesc = editorBox.querySelector('#sd-dir-desc');
                const alertBox = editorBox.querySelector('#sd-editor-alert');

                function showInlineAlert(msg, type = 'error') {
                    alertBox.textContent = msg;
                    alertBox.className = `sd-inline-alert ${type}`;
                    container.scrollTo({ top: 0, behavior: 'smooth' });
                    clearTimeout(alertBox._timer);
                    alertBox._timer = setTimeout(() => {
                        alertBox.className = 'sd-inline-alert';
                    }, 3500);
                }

                function updateCompassHighlight() {
                    const arr = chosenDirection.split('').filter(Boolean);
                    const lastStroke = arr[arr.length - 1];
                    const svgs = arr.map(d => getArrowSvg(d, 16)).join('');
                    const names = arr.map(d => ARROW_NAMES[d] || d).join(' + ');
                    dirDesc.innerHTML = arr.length > 0 ? `${svgs} <span>${names} (${chosenDirection})</span>` : '请点选方向';

                    editorBox.querySelectorAll('.sd-dir-btn').forEach(btn => {
                        const d = btn.dataset.d;
                        btn.classList.remove('in-path', 'is-last');
                        if (d === lastStroke) {
                            btn.classList.add('is-last');
                        } else if (arr.includes(d)) {
                            btn.classList.add('in-path');
                        }
                    });
                    overwriteConfirmed = false;
                }
                updateCompassHighlight();

                editorBox.querySelectorAll('.sd-dir-btn').forEach(btn => {
                    btn.onclick = () => {
                        const d = btn.dataset.d;
                        if (!d) return;

                        if (chosenDirection.endsWith(d)) {
                            chosenDirection = chosenDirection.slice(0, -1);
                        } else {
                            if (chosenDirection.length >= 4) {
                                showInlineAlert('手势最多支持 4 段组合，请勿继续追加');
                                return;
                            }
                            chosenDirection += d;
                        }
                        updateCompassHighlight();
                    };
                });

                editorBox.querySelector('#sd-undo-dir').onclick = () => {
                    if (chosenDirection.length > 0) {
                        chosenDirection = chosenDirection.slice(0, -1);
                        updateCompassHighlight();
                    }
                };

                editorBox.querySelector('#sd-clear-dir').onclick = () => {
                    chosenDirection = '';
                    updateCompassHighlight();
                };

                const presetSelect = editorBox.querySelector('#sd-preset-select');
                if (presetSelect) {
                    presetSelect.onchange = () => {
                        const val = presetSelect.value;
                        if (!val) return;
                        const opt = presetSelect.selectedOptions[0];
                        editorBox.querySelector('#sd-url-template').value = val;
                        editorBox.querySelector('#sd-alias').value = opt.dataset.alias;
                    };
                }

                const actionSelect = editorBox.querySelector('#sd-action-type');
                actionSelect.onchange = () => {
                    const actName = actionSelect.value;
                    const needUrl = ['searchText', 'openInternal', 'searchImg'].includes(actName);
                    editorBox.querySelector('#sd-url-row').style.display = needUrl ? 'block' : 'none';
                    editorBox.querySelector('#sd-tab-options').style.display = (needUrl || actName === 'openLink') ? 'block' : 'none';
                    const pRow = editorBox.querySelector('#sd-preset-row');
                    if (pRow) pRow.style.display = actName === 'searchText' ? 'block' : 'none';
                };

                editorBox.querySelector('#sd-cancel-rule').onclick = () => {
                    editingKey = null;
                    renderBody();
                };

                editorBox.querySelector('#sd-save-rule').onclick = () => {
                    const finalDir = chosenDirection.trim();
                    if (!finalDir) {
                        showInlineAlert('请至少点击罗盘选择一个拖拽方向！');
                        return;
                    }

                    const existing = cfg[currentTab][finalDir];
                    if (existing && (!editingKey || editingKey !== finalDir) && !overwriteConfirmed) {
                        overwriteConfirmed = true;
                        showInlineAlert(`方向已关联规则 [${existing.alias || finalDir}]，再次点击“保存”确认覆盖`, 'warning');
                        return;
                    }

                    const act = actionSelect.value;
                    const alias = editorBox.querySelector('#sd-alias').value.trim() || act;
                    const url = editorBox.querySelector('#sd-url-template').value.trim();
                    const fg = editorBox.querySelector('#sd-fg-check').checked;
                    const next = editorBox.querySelector('#sd-next-check').checked;

                    const newRule = { name: act, alias: alias, arg: [] };
                    if (['searchText', 'openInternal', 'searchImg'].includes(act)) {
                        newRule.arg = [url, fg, next];
                    } else if (act === 'openLink') {
                        newRule.arg = [fg, next];
                    }

                    if (!isNew && editingKey !== finalDir) {
                        delete cfg[currentTab][editingKey];
                    }
                    cfg[currentTab][finalDir] = newRule;
                    GM_setValue('cfg', cfg);
                    editingKey = null;
                    renderBody();
                };

                container.appendChild(editorBox);
            }

            function renderGeneralTab(container) {
                const metrics = GM_getValue('metrics_data', {});
                const metricList = Object.keys(metrics)
                    .map(k => `<li><b>${metrics[k].name}</b>: ${metrics[k].times}次 (最后触发: ${metrics[k].date})</li>`)
                    .join('') || '<li>暂无数据</li>';

                const wrap = document.createElement('div');
                wrap.innerHTML = `
                    <div class="sd-inline-alert" id="sd-gen-alert"></div>
                    <div class="sd-editor-box">
                        <h3 style="margin:0 0 12px 0;font-size:14px;color:#0f172a;">手势控制与灵敏度</h3>
                        <div class="sd-form-row">
                            <label>手势临时抑制键：</label>
                            <select id="sd-gen-sup">
                                <option value="" ${cfg.Gesture.suppressionKey === '' ? 'selected' : ''}>无</option>
                                <option value="altKey" ${cfg.Gesture.suppressionKey === 'altKey' ? 'selected' : ''}>Alt 键</option>
                                <option value="ctrlKey" ${cfg.Gesture.suppressionKey === 'ctrlKey' ? 'selected' : ''}>Ctrl 键</option>
                                <option value="shiftKey" ${cfg.Gesture.suppressionKey === 'shiftKey' ? 'selected' : ''}>Shift 键</option>
                            </select>
                        </div>
                        <div class="sd-form-row">
                            <label>识别灵敏度阈值 (px)：</label>
                            <input type="number" id="sd-gen-sens" value="${cfg.Gesture.distanceSensitivity}">
                        </div>
                        <div class="sd-form-row">
                            <label>输入框与高级拖拽行为：</label>
                            <div class="sd-switches">
                                <div class="sd-switch-item">
                                    <div class="sd-switch-info">
                                        <span class="sd-switch-label">输入框内允许手势拖拽</span>
                                        <span class="sd-switch-desc">关闭：输入框内选词拖拽保留给网页光标调整，不触发手势</span>
                                    </div>
                                    <label class="switch">
                                        <input type="checkbox" id="sd-drag-textarea" ${cfg.Drag.dragInTextarea ? 'checked' : ''}>
                                        <span class="slider"></span>
                                    </label>
                                </div>
                                <div class="sd-switch-item">
                                    <div class="sd-switch-info">
                                        <span class="sd-switch-label">选中文本若为网址则转为链接动作</span>
                                        <span class="sd-switch-desc">开启：划选 www.abc.com 直接按链接手势打开</span>
                                    </div>
                                    <label class="switch">
                                        <input type="checkbox" id="sd-link-as-link" ${cfg.Drag.linktextAslink ? 'checked' : ''}>
                                        <span class="slider"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div class="sd-form-row" style="margin-top:14px;">
                            <label>禁用本脚本的域名黑名单 (每行一个，严格后缀匹配，例如 bilibili.com)：</label>
                            <textarea id="sd-gen-black" rows="3" style="font-family:monospace;font-size:12px;">${cfg.blacklist || ''}</textarea>
                        </div>
                        <button class="btn btn-primary" id="sd-save-general">保存基础参数</button>
                    </div>
                    <div class="sd-editor-box">
                        <h3 style="margin:0 0 6px 0;font-size:14px;color:#0f172a;">高频统计 (Metrics)</h3>
                        <ul style="font-size:12px;color:#475569;margin:0;padding-left:18px;max-height:90px;overflow-y:auto;">
                            ${metricList}
                        </ul>
                    </div>
                    <div class="sd-editor-box">
                        <h3 style="margin:0 0 6px 0;font-size:14px;color:#0f172a;">配置导入与备份 (JSON)</h3>
                        <textarea id="sd-json-raw" style="width:100%;height:70px;font-family:monospace;font-size:11px;box-sizing:border-box;padding:6px;border:1px solid #cbd5e1;border-radius:6px;"></textarea>
                        <div style="display:flex;gap:8px;margin-top:6px;">
                            <button class="btn btn-secondary" id="sd-apply-json">从 JSON 覆盖</button>
                            <button class="btn btn-danger" id="sd-reset-def">重置为出厂默认</button>
                        </div>
                    </div>
                `;

                const alertBox = wrap.querySelector('#sd-gen-alert');
                function showGenAlert(msg, type = 'success') {
                    alertBox.textContent = msg;
                    alertBox.className = `sd-inline-alert ${type}`;
                    container.scrollTo({ top: 0, behavior: 'smooth' });
                    clearTimeout(alertBox._timer);
                    alertBox._timer = setTimeout(() => {
                        alertBox.className = 'sd-inline-alert';
                    }, 3500);
                }

                wrap.querySelector('#sd-json-raw').value = JSON.stringify(cfg, null, 2);

                wrap.querySelector('#sd-save-general').onclick = () => {
                    cfg.Gesture.suppressionKey = wrap.querySelector('#sd-gen-sup').value;
                    cfg.Gesture.distanceSensitivity = parseInt(wrap.querySelector('#sd-gen-sens').value, 10) || 20;
                    cfg.Drag.dragInTextarea = wrap.querySelector('#sd-drag-textarea').checked;
                    cfg.Drag.linktextAslink = wrap.querySelector('#sd-link-as-link').checked;
                    cfg.blacklist = wrap.querySelector('#sd-gen-black').value;
                    GM_setValue('cfg', cfg);
                    showGenAlert('基础参数已成功保存');
                };

                wrap.querySelector('#sd-apply-json').onclick = () => {
                    try {
                        const parsed = JSON.parse(wrap.querySelector('#sd-json-raw').value);
                        cfg = sanitizeConfig(parsed);
                        GM_setValue('cfg', cfg);
                        showGenAlert('配置导入成功，已全量更新');
                        renderBody();
                    } catch (e) {
                        showGenAlert('JSON 格式解析失败: ' + e.message, 'error');
                    }
                };

                wrap.querySelector('#sd-reset-def').onclick = () => {
                    cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
                    GM_deleteValue('cfg');
                    showGenAlert('已恢复出厂默认配置');
                    renderBody();
                };

                container.appendChild(wrap);
            }

            function show() {
                init();
                shadow.querySelector('.sd-mask').style.display = 'flex';
                renderBody();
            }

            function hide() {
                if (shadow) shadow.querySelector('.sd-mask').style.display = 'none';
            }

            return {
                show,
                hide,
                toggle() {
                    init();
                    const m = shadow.querySelector('.sd-mask');
                    if (m.style.display === 'flex') hide();
                    else show();
                }
            };
        })();

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.keyCode === 27) {
                if (QRModal.isShowing()) {
                    QRModal.hide();
                } else if (DragEngine.isDraggingState()) {
                    DragEngine.cancel();
                } else {
                    Settings.hide();
                }
            } else if (e.altKey && (e.key === 'y' || e.key === 'Y' || e.keyCode === 89)) {
                e.preventDefault();
                Settings.toggle();
            }
        }, true);

        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand('拖拽扩展设置中心', () => Settings.toggle());
        }

        GM_addStyle(`
            #superdrag-hud {
                all: initial;
                position: fixed !important;
                top: 50% !important;
                left: 50% !important;
                transform: translate(-50%, -50%) !important;
                background: rgba(30, 41, 59, 0.88) !important;
                backdrop-filter: blur(10px) !important;
                color: #ffffff !important;
                padding: 16px 28px !important;
                border-radius: 14px !important;
                box-shadow: 0 14px 34px rgba(0, 0, 0, 0.35) !important;
                display: none;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                pointer-events: none !important;
                z-index: 2147483647 !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            }
            .superdrag-hud-arrows {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
                color: #38bdf8 !important;
                filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.6)) !important;
                margin-bottom: 4px !important;
            }
            .superdrag-hud-action {
                font-size: 16px !important;
                font-weight: 600 !important;
                margin-top: 4px !important;
                white-space: nowrap !important;
                letter-spacing: 0.5px !important;
            }
            #superdrag-toast {
                all: initial;
                position: fixed !important;
                top: 24px !important;
                right: 24px !important;
                background: rgba(15, 23, 42, 0.9) !important;
                backdrop-filter: blur(6px) !important;
                color: #ffffff !important;
                padding: 10px 18px !important;
                border-radius: 8px !important;
                font-size: 13px !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25) !important;
                opacity: 0;
                transition: opacity 0.2s ease-in-out !important;
                pointer-events: none !important;
                z-index: 2147483647 !important;
                max-width: 320px !important;
                word-break: break-all !important;
            }
            #superdrag-qr-modal {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                background: rgba(15, 23, 42, 0.72) !important;
                backdrop-filter: blur(6px) !important;
                z-index: 2147483647 !important;
                display: none;
                align-items: center !important;
                justify-content: center !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            }
            .sd-qr-box {
                background: #ffffff !important;
                padding: 20px 24px !important;
                border-radius: 16px !important;
                box-shadow: 0 24px 48px rgba(0,0,0,0.35) !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                width: 340px !important;
                box-sizing: border-box !important;
            }
            .sd-qr-header {
                width: 100% !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                gap: 10px !important;
                margin-bottom: 12px !important;
            }
            .sd-qr-title {
                font-size: 16px !important;
                font-weight: 700 !important;
                color: #0f172a !important;
            }
            .sd-qr-pills {
                display: flex !important;
                background: #f1f5f9 !important;
                padding: 3px !important;
                border-radius: 20px !important;
                gap: 4px !important;
                width: 100% !important;
                justify-content: space-between !important;
            }
            .sd-qr-pill {
                flex: 1 !important;
                padding: 5px 0 !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                border: none !important;
                background: transparent !important;
                color: #64748b !important;
                border-radius: 16px !important;
                cursor: pointer !important;
                transition: all 0.15s !important;
                text-align: center !important;
            }
            .sd-qr-pill.active {
                background: #ffffff !important;
                color: #2563eb !important;
                box-shadow: 0 1px 4px rgba(0,0,0,0.1) !important;
            }
            .sd-qr-render {
                background: #ffffff !important;
                padding: 10px !important;
                border: 1px solid #e2e8f0 !important;
                border-radius: 10px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 240px !important;
                height: 240px !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
            }
            .sd-qr-render svg, .sd-qr-render img {
                width: 100% !important;
                height: 100% !important;
                max-width: 220px !important;
                max-height: 220px !important;
                object-fit: contain !important;
                display: block !important;
            }
            .sd-qr-input {
                margin-top: 12px !important;
                width: 100% !important;
                font-size: 12px !important;
                color: #334155 !important;
                padding: 8px 10px !important;
                border: 1px solid #cbd5e1 !important;
                border-radius: 8px !important;
                outline: none !important;
                box-sizing: border-box !important;
                resize: vertical !important;
                font-family: inherit !important;
            }
            .sd-qr-input:focus {
                border-color: #2563eb !important;
            }
            .sd-qr-tip {
                margin-top: 8px !important;
                font-size: 11px !important;
                color: #94a3b8 !important;
                cursor: pointer !important;
            }
        `);

        DragEngine.init();
    } catch (err) {
        console.warn('[SuperDrag] 脚本运行异常静默容错:', err);
    }
})();