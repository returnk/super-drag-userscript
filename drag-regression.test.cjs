const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const script = fs.readFileSync(`${__dirname}/super-drag.user.js`, 'utf8');
const engine = script.slice(script.indexOf('const DragEngine ='), script.indexOf('const DragEngine =') + script.slice(script.indexOf('const DragEngine =')).indexOf('})();') + 5);

function replay({ drop = false, cancel = false, rightClick = false, x = 421, y = 201, focus = true, frame = false, elapsed = 429, over = true, type = 'text', action = 'searchText', defined = true } = {}) {
    const handlers = {};
    let calls = 0;
    let now = 0;
    let layer = null;
    const deferred = [];
    const context = {
        window: {
            location: { hostname: 'example.com' }, innerWidth: 1000, innerHeight: 800,
            getSelection: () => ({ toString: () => type === 'text' ? 'test' : '' }),
            addEventListener: (name, handler) => { handlers[name] = handler; }
        },
        document: {
            activeElement: null,
            createElement: () => ({ style: { setProperty() {} }, remove() { layer = null; } }),
            documentElement: { appendChild(node) { layer = node; } },
            hasFocus: () => focus, elementFromPoint: () => ({ tagName: frame ? 'IFRAME' : 'DIV' })
        },
        Date: { now: () => now },
        setTimeout: callback => deferred.push(callback),
        cfg: { blacklist: '', Gesture: { distanceThreshold: 5, distanceSensitivity: 20 }, Drag: {}, [type]: defined ? { '9': { name: action, arg: [] } } : {} },
        HUD: { hide() {}, update() {} }, Toast: { show() {} },
        Actions: { [action]() { calls++; } }, recordMetric() {}, console
    };
    vm.createContext(context);
    vm.runInContext(`${engine}; DragEngine.init(); globalThis.cancelDrag = DragEngine.cancel;`, context);
    const target = type === 'image' ? { nodeName: 'IMG', src: 'https://example.com/image.png' } :
        type === 'link' ? { nodeName: 'A', closest: selector => selector === 'a, area' ? ({ href: 'https://example.com/', textContent: 'link' }) : null } : { nodeName: '#text' };
    handlers.dragstart({ target, clientX: 350, clientY: 135 });
    assert.equal(layer, null, 'dragstart must finish before adding the receiver');
    deferred.forEach(callback => callback());
    assert.ok(layer, 'drag receiver covers iframe during active drag');
    now = 48;
    handlers.drag({ clientX: 400, clientY: 183 });
    if (over) handlers.dragover({ clientX: 400, clientY: 183, preventDefault() {} });
    if (cancel) context.cancelDrag(); // Existing Escape listener calls this same method.
    if (rightClick) handlers.mousedown({ button: 2, preventDefault() {}, stopPropagation() {} });
    now = elapsed;
    if (drop) handlers.drop({ clientX: x, clientY: y, preventDefault() {} });
    handlers.dragend({ clientX: x, clientY: y });
    assert.equal(layer, null, 'drag receiver is removed after ending or cancelling');
    return calls;
}

test('native Escape ending without keydown or drop never searches', () => assert.equal(replay(), 0));
test('native Escape over player without keydown never searches', () => assert.equal(replay({ frame: true, elapsed: 980 }), 0));
test('normal drop executes once', () => assert.equal(replay({ drop: true }), 1));
test('release on receiver over player executes once', () => assert.equal(replay({ drop: true, frame: true, elapsed: 980, x: 553, y: 320 }), 1));
test('long drag on player receiver executes once', () => assert.equal(replay({ drop: true, frame: true, elapsed: 5000 }), 1));
test('copy action on receiver executes once', () => assert.equal(replay({ drop: true, action: 'copyText', frame: true }), 1));
test('link action on receiver executes once', () => assert.equal(replay({ drop: true, type: 'link', action: 'openLink', frame: true }), 1));
test('image action on receiver executes once', () => assert.equal(replay({ drop: true, type: 'image', action: 'copyImgURL', frame: true }), 1));
test('undefined gesture still does nothing', () => assert.equal(replay({ defined: false, frame: true }), 0));
for (const [name, options] of Object.entries({
    'Escape cancellation': { cancel: true }, 'right-click cancellation': { rightClick: true },
    'outside viewport': { x: 1001 }, 'invalid end coordinates': { x: 0, y: 0 },
    'lost focus': { focus: false }, 'cancel over iframe': { cancel: true, frame: true },
    'stale dragover': { elapsed: 2000 }, 'no dragover': { over: false }
})) test(`${name} does not search`, () => assert.equal(replay(options), 0));

const search = script.slice(script.indexOf('const SKRBT_PENDING_KEY'), script.indexOf('function consumeSkrbtPendingSearch'));
test('SkrBT opens immediately without a connection probe', () => {
    const opened = [];
    let pending;
    let probes = 0;
    const context = {
        URL, Date, console, Toast: { show() {} },
        GM_setValue: (key, value) => { pending = value; },
        GM_openInTab: (url, options) => opened.push({ url, options }),
        GM_xmlhttpRequest: () => { probes++; }
    };
    vm.createContext(context);
    vm.runInContext(search + ";queueSkrbtSearch('test', false, true);", context);
    assert.equal(probes, 0);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].url, 'https://skrbtso.cc/');
    assert.equal(opened[0].options.active, false);
    assert.equal(pending.query, 'test');
});

test('publication menu opens the publication page on click only', () => {
    const menus = new Map();
    const opened = [];
    const context = {
        GM_registerMenuCommand: (name, callback) => menus.set(name, callback),
        GM_openInTab: url => opened.push(url),
        Settings: { toggle() {} }, SKRBT_PUBLICATION_URL: 'https://btskr.net/'
    };
    vm.createContext(context);
    const start = script.indexOf("if (typeof GM_registerMenuCommand");
    vm.runInContext(script.slice(start, script.indexOf('GM_addStyle(', start)), context);
    assert.equal(opened.length, 0);
    assert.ok(menus.has('打开 SkrBT 发布页'));
    menus.get('打开 SkrBT 发布页')();
    assert.deepEqual(opened, ['https://btskr.net/']);
});
