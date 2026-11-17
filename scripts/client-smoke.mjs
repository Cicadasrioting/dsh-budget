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
const BUNDLE = process.env.BUNDLE ?? join(HERE, '..', 'lib', 'client.js');
const BASE = (process.env.DSH_WEB_URL ?? '').replace(/\/$/, '');

// ---- 假 React：够了，只用到这几个 hook ----
let hookCursor = 0;
const resetHooks = () => {
  hookCursor = 0;
};
// 面板第一个 useState 是 data；第二遍渲染时把它播种成真 /status，用来验「有数据」的形态
let seedData = null;
// 页签状态也是 useState，按「初始值是 overview」认出来播种，用来验别的页签
let seedTab = null;
// 新建任务弹窗：useState 的初值是 'closed'，播种成 'open' 验弹窗形态
let seedDialog = false;
// 只有顶层渲染（面板本身）才允许把 /status 播进第一个 useState；子组件里不能播
let allowDataSeed = true;
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState: (init) => {
    hookCursor += 1;
    if (allowDataSeed && hookCursor === 1 && seedData !== null) return [seedData, () => {}];
    if (init === 'overview' && seedTab !== null) return [seedTab, () => {}];
    if (init === 'closed' && seedDialog) return ['open', () => {}];
    return [typeof init === 'function' ? init() : init, () => {}];
  },
  useRef: (init) => ({ current: init ?? null }),
  useEffect: () => {
    hookCursor += 1;
  },
  useCallback: (fn) => {
    hookCursor += 1;
    return fn;
  },
};
const JsxRuntime = { jsx: React.createElement, jsxs: React.createElement, Fragment: 'Fragment' };

/** 在渲染树里按 className 找节点；all=true 时收集全部。 */
function findClass(node, className, all = false) {
  const hits = [];
  const walk = (n) => {
    if (n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    const own = n.props?.className;
    if (typeof own === 'string' && own.split(/\s+/).includes(className)) hits.push(n);
    // 假 React 不渲染组件：遇到函数组件就手动调一次，好钻进它的子树
    if (typeof n.type === 'function') {
      allowDataSeed = false;
      resetHooks();
      walk(n.type(n.props ?? {}));
      return;
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return all ? hits : (hits[0] ?? null);
}

/** 在渲染树里按按钮文字找节点（文本被拆成数组也算）。 */
function findClassWithText(root, text) {
  const walk = (n) => {
    if (n === null || typeof n !== 'object') return null;
    if (Array.isArray(n)) {
      for (const item of n) {
        const hit = walk(item);
        if (hit !== null) return hit;
      }
      return null;
    }
    if (typeof n.type === 'function') {
      allowDataSeed = false;
      resetHooks();
      return walk(n.type(n.props ?? {}));
    }
    const flat = [n.props?.children].concat(n.children ?? []).flat(9).map((c) => (typeof c === 'string' ? c : '')).join('');
    if (n.type === 'button' && flat.trim() === text) return n;
    for (const child of n.children ?? []) {
      const hit = walk(child);
      if (hit !== null) return hit;
    }
    return null;
  };
  return walk(root);
}

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
let styleText = '';
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ textContent: '', id: '' }),
  head: { appendChild: (node) => { styleText = String(node?.textContent ?? ''); } },
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
allowDataSeed = true;
const page = main.component(props);
if (page === null || page === undefined) throw new Error('页面组件没返回元素');
console.log('page root =', page.type, '| children =', page.children.length);

// 设了 DSH_WEB_URL 才去打真宿主：容器/CI 里没有宿主，静态检查通过就算过
if (BASE) {
  const status = await realFetch(BASE + '/plugins/dsh-budget/status').then((r) => r.json());
  if (status?.ok !== true) throw new Error('/status 没返回 ok：' + JSON.stringify(status).slice(0, 120));
  console.log('status.plan.remaining =', status.plan.remaining, '| gate =', JSON.stringify(status.gate));

  // 第二遍：把真数据播进 useState，看『账单』页签里的柱状图
  seedData = status;
  seedTab = 'overview';
  resetHooks();
  allowDataSeed = true;
  const billPage = main.component(props);
  const tabs = findClass(billPage, 'BGD_tab', true);
  if (tabs.length !== 3) throw new Error('页签数量不对：' + tabs.length);
  const chart = findClass(billPage, 'BGD_chart');
  if (chart === null) throw new Error('概览页签里没有柱状图（BGD_chart）');
  const bars = findClass(chart, 'BGD_chartBar', true);
  if (bars.length === 0) throw new Error('柱状图里一根柱子都没有');
  console.log('tabs =', tabs.length, '| chart bars =', bars.length, '| today cost =', status.billing?.todayCost);

  // 第三遍：抠搜模式页签 —— 峰谷徽标、并发、任务卡（含提问框和报告）
  const seeded = {
      ...status,
      cheap: {
          ...(status.cheap ?? {}),
          concurrency: 2,
          items: [
              {
                  id: 'fake-wait',
                  title: '等你拍板的那条',
                  prompt: '改一下队列的样式',
                  status: 'waiting',
                  rounds: 1,
                  maxRounds: 3,
                  sessionId: 'session-abcdef12',
                  question: '要不要顺手把 README 也改了？',
              },
              {
                  id: 'fake-done',
                  title: '跑完的那条',
                  prompt: '补一版测试',
                  status: 'done',
                  rounds: 2,
                  maxRounds: 3,
                  roundsLog: [{ round: 1, at: 1, text: '先补了单元测试' }, { round: 2, at: 2, text: '顺手跑了冒烟' }],
                  report: { rounds: 2, durationMs: 96_000, summary: '补了 6 条用例，冒烟通过。' },
              },
          ],
          counts: { queued: 0, running: 0, done: 1, failed: 0 },
      },
  };
  seedData = seeded;
  seedTab = 'stingy';
  resetHooks();
  allowDataSeed = true;
  const smartPage = main.component(props);
  const taskCards = findClass(smartPage, 'BGD_task', true);
  if (taskCards.length !== 2) throw new Error('任务卡数量不对：' + taskCards.length);
  if (findClass(smartPage, 'BGD_askBox') === null) throw new Error('waiting 的任务没有回话框');
  if (findClass(smartPage, 'BGD_report') === null) throw new Error('跑完的任务没有报告入口');

  // 新建任务改成弹窗：页签里应该只剩一个「+ 新建任务」按钮
  const openBtn = findClassWithText(smartPage, '+ 新建任务');
  if (openBtn === null) throw new Error('抠搜页签没有「+ 新建任务」按钮');
  if (typeof openBtn.props.onClick !== 'function') throw new Error('新建任务按钮没有 onClick');
  if (findClass(smartPage, 'BGD_dialog') !== null) throw new Error('弹窗没打开时就渲染了 dialog');
  if (!styleText.includes('.BGD_dialog::backdrop')) throw new Error('样式里没有透明遮罩规则（BGD_dialog::backdrop）');
  if (!styleText.includes('.BGD_tasks{display:grid')) throw new Error('队列没排成网格（BGD_tasks 还是旧的 flex）');
  console.log('task cards =', taskCards.length, '| concurrency =', seeded.cheap.concurrency, '| new-task button = ok');

  // 第四遍：弹窗打开的样子
  seedDialog = true;
  resetHooks();
  allowDataSeed = true;
  const modalPage = main.component(props);
  seedDialog = false;
  const mask = findClass(modalPage, 'BGD_dialog');
  if (mask === null) throw new Error('点了新建任务也看不到弹窗遮罩');
  const modal = findClass(mask, 'BGD_modal');
  if (modal === null) throw new Error('弹窗里没有 BGD_modal 主体');
  if (findClass(modalPage, 'BGD_textarea') === null) throw new Error('弹窗里没有任务内容输入框');
  console.log('modal = open | fields = ok');
}
console.log('SMOKE OK');
