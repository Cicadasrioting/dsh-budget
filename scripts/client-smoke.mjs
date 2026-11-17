/**
 * 客户端束的自测：用假的 window.__ModuleLoader__ / require 加载 lib/client.js，
 * 断言它注册了侧栏行与主区页面，并把面板真正渲染一遍（走真宿主的 /status 路由）。
 * 跑法：DSH_WEB_URL=http://127.0.0.1:<端口> npm run smoke
 * 不设 DSH_WEB_URL 时只做静态检查，不去碰宿主。
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'lib', 'client.js');
const BASE = (process.env.DSH_WEB_URL ?? '').replace(/\/$/, '');

// ---- 假 React：够了，只用到这几个 hook ----
let hookCursor = 0;
const resetHooks = () => {
  hookCursor = 0;
};
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState: (init) => {
    hookCursor += 1;
    return [typeof init === 'function' ? init() : init, () => {}];
  },
  useEffect: () => {
    hookCursor += 1;
  },
  useCallback: (fn) => {
    hookCursor += 1;
    return fn;
  },
};
const JsxRuntime = { jsx: React.createElement, jsxs: React.createElement, Fragment: 'Fragment' };

// ---- 加载束 ----
let exported = null;
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      const require = (name) => {
        if (name === 'react') return React;
        if (name === 'react/jsx-runtime') return JsxRuntime;
        throw new Error('意外的 require：' + name);
      };
      exported = factory(require);
      console.log('bundle id =', id);
    },
  },
};
if (typeof globalThis.fetch !== 'function') throw new Error('需要 Node 18+ 的全局 fetch');
// 束里的 fetch 用相对路径，补成真宿主地址
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => realFetch(BASE + url, init);
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ set textContent(v) {}, id: '' }),
  head: { appendChild: () => {} },
  visibilityState: 'visible',
};

new Function('window', 'document', fs.readFileSync(BUNDLE, 'utf8'))(globalThis.window, globalThis.document);

if (exported === null) throw new Error('束没有被加载');
if (typeof exported.apply !== 'function') throw new Error('缺少 apply');
console.log('inject =', JSON.stringify(exported.inject));

// ---- 跑 apply，收集槽位注册 ----
const regs = [];
const ctx = {
  slots: {
    inject: (name, fn) => {
      fn();
      console.log('slot inject:', name);
    },
    register: (decl, component) => {
      regs.push({ decl, component });
      return { dispose() {} };
    },
  },
  get: () => undefined,
};
exported.apply(ctx);

const sidebar = regs.find((r) => r.decl.name === 'sidebar.panellist');
const main = regs.find((r) => r.decl.name === 'main');
if (!sidebar) throw new Error('没有注册 sidebar.panellist');
if (!main) throw new Error('没有注册 main');
if (main.decl.key !== sidebar.decl.id) throw new Error('主区 key 与侧栏 id 不一致：' + main.decl.key + ' vs ' + sidebar.decl.id);
console.log('sidebar id =', sidebar.decl.id, '| label =', sidebar.decl.label());
console.log('main key   =', main.decl.key);

// 图标能渲染
const icon = sidebar.component({ size: 16 });
if (icon === null || icon === undefined) throw new Error('图标组件没返回元素');

// 主区页面能渲染（props 由 inject() 提供）
const props = typeof main.decl.inject === 'function' ? main.decl.inject() : {};
resetHooks();
const page = main.component(props);
if (page === null || page === undefined) throw new Error('页面组件没返回元素');
console.log('page root =', page.type, '| children =', page.children.length);

// 设了 DSH_WEB_URL 才去打真宿主：容器/CI 里没有宿主，静态检查通过就算过
if (BASE) {
  const status = await realFetch(BASE + '/plugins/dsh-budget/status').then((r) => r.json());
  if (status?.ok !== true) throw new Error('/status 没返回 ok：' + JSON.stringify(status).slice(0, 120));
  console.log('status.plan.remaining =', status.plan.remaining, '| gate =', JSON.stringify(status.gate));
}
console.log('SMOKE OK');
